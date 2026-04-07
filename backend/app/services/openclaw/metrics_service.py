"""Gateway metrics and resource collection service."""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db import crud
from app.models.gateways import Gateway
from app.services.openclaw.db_service import OpenClawDBService
from app.services.openclaw.gateway_rpc import openclaw_call, GatewayConfig
from app.services.openclaw.gateway_resolver import gateway_client_config

logger = get_logger(__name__)


class GatewayMetricsService(OpenClawDBService):
    """Service for collecting and providing gateway runtime metrics."""

    async def get_gateway_status(
        self,
        gateway_id: UUID,
        organization_id: UUID,
    ) -> dict[str, Any]:
        """Fetch real-time status/metrics from the gateway."""
        gateway = await crud.get_by_id(self.session, Gateway, gateway_id)
        if not gateway or gateway.organization_id != organization_id:
            return {"error": "Gateway not found"}

        config: GatewayConfig = gateway_client_config(gateway)
        try:
            # 'status' provides runtime info, tasks, and session counts.
            # 'usage.status' or 'usage.cost' provides token usage.
            status_data = await openclaw_call("status", config=config)
            usage_data = await openclaw_call("usage.status", config=config)
            
            return {
                "runtime": status_data,
                "usage": usage_data,
            }
        except Exception as e:
            logger.error("gateway.metrics.fetch_failed gateway_id=%s error=%s", gateway_id, str(e))
            return {"error": str(e)}

    async def get_agent_metrics(
        self,
        agent_id: str,
        gateway_id: UUID,
        organization_id: UUID,
    ) -> dict[str, Any]:
        """Fetch metrics scoped to a specific agent."""
        # For now, we extract agent-specific data from the global status
        status = await self.get_gateway_status(gateway_id, organization_id)
        if "error" in status:
            return status
        
        runtime = status.get("runtime", {})
        usage = status.get("usage", {})
        
        # Filter usage and tasks for this agent
        agent_usage = {}
        if isinstance(usage, dict) and "byAgent" in usage:
            agent_usage = usage["byAgent"].get(agent_id, {})
        
        agent_heartbeat = {}
        if isinstance(runtime, dict) and "heartbeat" in runtime:
            hb_list = runtime["heartbeat"].get("agents", [])
            agent_heartbeat = next((h for h in hb_list if h["agentId"] == agent_id), {})

        return {
            "usage": agent_usage,
            "heartbeat": agent_heartbeat,
        }
