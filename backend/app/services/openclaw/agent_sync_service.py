"""Agent synchronization service for importing agents from OpenClaw Gateway."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlmodel import select

from app.core.logging import get_logger
from app.core.time import utcnow
from app.db import crud
from app.models.agents import Agent
from app.models.boards import Board
from app.models.gateways import Gateway
from app.models.organizations import Organization
from app.services.openclaw.db_service import OpenClawDBService
from app.services.openclaw.gateway_rpc import openclaw_call, GatewayConfig
from app.services.openclaw.gateway_resolver import gateway_client_config

logger = get_logger(__name__)
SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    slug = SLUG_RE.sub("-", value.lower()).strip("-")
    return slug or f"imported-{uuid4().hex[:8]}"


class AgentSyncService(OpenClawDBService):
    """Service for synchronizing agents from OpenClaw Gateway to Mission Control DB."""

    async def sync_agents_from_gateway(
        self,
        gateway_id: UUID,
        organization: Organization,
    ) -> list[Agent]:
        """Fetches agents from the specified gateway and synchronizes them into the DB.

        Returns the list of synchronized agents.
        """
        gateway = await crud.get_by_id(self.session, Gateway, gateway_id)
        if not gateway:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Gateway not found"
            )
        if gateway.organization_id != organization.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Access to gateway denied"
            )

        gateway_config: GatewayConfig = gateway_client_config(gateway)
        gateway_agents_raw: dict[str, Any] = await openclaw_call(
            "agents.list", config=gateway_config
        )
        gateway_agents_data: list[dict[str, Any]] = gateway_agents_raw.get("agents", [])

        # Get existing agents managed by this gateway in Mission Control
        existing_mc_agents = await self.session.exec(
            select(Agent).where(Agent.gateway_id == gateway_id)
        )
        existing_mc_agents_map = {
            a.openclaw_session_id: a for a in existing_mc_agents.all()
        }

        # For now, create a default board if none exists.
        # This is a temporary solution for agents without a board_id from gateway.
        default_board = await self._get_or_create_default_board(organization.id, gateway.id)

        synchronized_agents: list[Agent] = []
        for agent_data in gateway_agents_data:
            openclaw_session_id = agent_data.get("id")
            if not openclaw_session_id:
                logger.warning(
                    "Skipping agent from gateway %s with missing 'id': %s",
                    gateway_id,
                    agent_data,
                )
                continue

            existing_agent = existing_mc_agents_map.get(openclaw_session_id)

            if existing_agent:
                # Update existing agent
                update_data = self._map_gateway_agent_to_mc_update(
                    agent_data, default_board.id
                )
                existing_agent.sqlmodel_update(update_data)
                existing_agent.updated_at = utcnow()
                self.session.add(existing_agent)
                synchronized_agents.append(existing_agent)
            else:
                # Create new agent
                create_data = self._map_gateway_agent_to_mc_create(
                    agent_data, gateway_id, default_board.id
                )
                new_agent = Agent(**create_data)
                self.session.add(new_agent)
                synchronized_agents.append(new_agent)

        await self.session.commit()
        for agent in synchronized_agents:
            await self.session.refresh(agent)
        
        logger.info(
            "Synchronized %d agents from gateway %s (org_id=%s)",
            len(synchronized_agents),
            gateway_id,
            organization.id,
        )
        return synchronized_agents

    async def _get_or_create_default_board(self, organization_id: UUID, gateway_id: UUID) -> Board:
        """Gets or creates a default board for imported agents."""
        # Check for an existing 'Imported Agents' board for this organization and gateway
        existing_board = (
            await self.session.exec(
                select(Board).where(
                    Board.organization_id == organization_id,
                    Board.gateway_id == gateway_id,
                    Board.name == "Imported Agents",
                )
            )
        ).first()

        if existing_board:
            return existing_board
        
        # If no default board exists, create one
        new_board = Board(
            name="Imported Agents",
            slug=_slugify(f"imported-agents-{gateway_id}"),
            description="Default board for agents synchronized from OpenClaw Gateway.",
            organization_id=organization_id,
            gateway_id=gateway_id,
            board_type="goal",
        )
        self.session.add(new_board)
        await self.session.commit()
        await self.session.refresh(new_board)
        logger.info(
            "Created default board 'Imported Agents' (board_id=%s) for organization %s and gateway %s",
            new_board.id,
            organization_id,
            gateway_id,
        )
        return new_board


    def _map_gateway_agent_to_mc_create(
        self,
        agent_data: dict[str, Any],
        gateway_id: UUID,
        board_id: UUID,
    ) -> dict[str, Any]:
        """Maps raw gateway agent data to Mission Control Agent create data."""
        return {
            "name": agent_data.get("name") or agent_data["id"],
            "openclaw_session_id": agent_data["id"],
            "gateway_id": gateway_id,
            "board_id": board_id,  # Assign to default board
            "status": "active",  # Assume active if retrieved
            "heartbeat_config": agent_data.get("heartbeat_config"),
            "identity_profile": agent_data.get("identity", {}),
            "identity_template": agent_data.get("identity", {}).get("template"),
            "soul_template": agent_data.get("soul_template"),
            "last_seen_at": utcnow(),
        }

    def _map_gateway_agent_to_mc_update(
        self,
        agent_data: dict[str, Any],
        board_id: UUID,
    ) -> dict[str, Any]:
        """Maps raw gateway agent data to Mission Control Agent update data."""
        return {
            "name": agent_data.get("name") or agent_data["id"],
            "board_id": board_id,
            "status": "active",
            "heartbeat_config": agent_data.get("heartbeat_config"),
            "identity_profile": agent_data.get("identity", {}),
            "identity_template": agent_data.get("identity", {}).get("template"),
            "soul_template": agent_data.get("soul_template"),
            "last_seen_at": utcnow(),
        }
