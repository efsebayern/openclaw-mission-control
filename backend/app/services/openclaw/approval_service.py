"""Service for handling gateway approval requests and user responses."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import HTTPException, status
from sqlmodel import col

from app.core.logging import get_logger
from app.core.time import utcnow
from app.db import crud
from app.models.agents import Agent
from app.models.approvals import Approval
from app.models.boards import Board
from app.services.openclaw.db_service import OpenClawDBService
from app.services.openclaw.gateway_dispatch import GatewayDispatchService

logger = get_logger(__name__)


class GatewayApprovalService(OpenClawDBService):
    """Orchestrates the resolution of pending agent approvals via the gateway."""

    async def resolve_approval(
        self,
        approval_id: UUID,
        decision: Literal["approved", "rejected"],
        organization_id: UUID,
    ) -> Approval:
        """Resolve a pending approval and notify the agent via the gateway."""
        approval = await crud.get_by_id(self.session, Approval, approval_id)
        if not approval:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found")

        board = await crud.get_by_id(self.session, Board, approval.board_id)
        if not board or board.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        if approval.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, 
                detail=f"Approval is already {approval.status}"
            )

        # Update DB state
        approval.status = decision
        approval.resolved_at = utcnow()
        await crud.save(self.session, approval)

        # Notify the lead agent (or the agent that requested it)
        agent = None
        if approval.agent_id:
            agent = await crud.get_by_id(self.session, Agent, approval.agent_id)
        
        if not agent:
            # Fallback to board lead
            agent = await self.session.exec(
                Agent.query()
                .where(Agent.board_id == board.id)
                .where(col(Agent.is_board_lead).is_(True))
            ).first()

        if agent and agent.openclaw_session_id:
            dispatch = GatewayDispatchService(self.session)
            config = await dispatch.optional_gateway_config_for_board(board)
            if config:
                message = self._build_resolution_message(approval, decision)
                await dispatch.try_send_agent_message(
                    session_key=agent.openclaw_session_id,
                    config=config,
                    agent_name=agent.name,
                    message=message,
                )

        return approval

    def _build_resolution_message(
        self, 
        approval: Approval, 
        decision: Literal["approved", "rejected"]
    ) -> str:
        verb = "APPROVED" if decision == "approved" else "REJECTED"
        return (
            f"USER {verb} REQUEST\n"
            f"Approval ID: {approval.id}\n"
            f"Action Type: {approval.action_type}\n"
            f"The user has manually {decision} this action via Mission Control Dashboard."
        )
