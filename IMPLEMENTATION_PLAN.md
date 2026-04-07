# Implementation Plan: Mission Control - Ultimate Dashboard Extensions

This plan outlines the steps to upgrade Mission Control from a configuration inventory to a real-time observability and control cockpit.

## Phase 1: Live Log Streaming (Observability)
**Goal:** View real-time agent thought processes and tool outputs directly in the dashboard.

### Backend Tasks:
1.  **SSE Log Streamer:**
    - Update `app.services.openclaw.gateway_rpc` to support subscribing to gateway event streams (websockets).
    - Create a new API endpoint `GET /api/v1/agents/{agent_id}/logs/stream` using `EventSourceResponse` (SSE).
    - Implement a background task that proxies gateway events to the connected web clients.
2.  **Log Persistence (Lightweight):**
    - Optionally store the last 100 log lines in Redis/Memory for instant "scroll-back" when opening the agent detail page.

### Frontend Tasks:
1.  **Log Console Component:**
    - Create a terminal-like component (`LogConsole.tsx`) using `xterm.js` or a styled pre-tag.
    - Implement auto-scroll and basic severity filtering (INFO, WARN, ERROR, THINK).
2.  **Agent Detail Integration:**
    - Add a "Live Logs" tab to the Agent details view.

---

## Phase 2: Human-in-the-Loop (Interactive Debugging)
**Goal:** Respond to agent approval requests or questions directly from the UI.

### Backend Tasks:
1.  **Inbox/Approval Service:**
    - Create `app.services.openclaw.approval_service.py` to track pending gateway approvals.
    - Implement `POST /api/v1/approvals/{id}/resolve` to send `/approve` or `/reject` back to the gateway.
2.  **Push Notifications:**
    - Use existing SSE infrastructure to notify the UI when a new approval is requested.

### Frontend Tasks:
1.  **Global Inbox:**
    - Add a notification bell or "Action Required" sidebar item showing pending approvals.
2.  **Approval Dialogs:**
    - Build a UI component that shows the command/text requiring approval and provides "Approve/Reject" buttons.

---

## Phase 3: Resource & Cost Monitoring
**Goal:** Monitor CPU/RAM of the gateway host and track token usage/costs per agent.

### Backend Tasks:
1.  **Gateway Metrics Collector:**
    - Implement a background worker that calls `node.status` (if available) or system metrics on the gateway host.
    - Store historical metrics in the DB for time-series charts.
2.  **Token Tracking:**
    - Parse gateway usage metadata from RPC responses and aggregate costs based on model pricing templates.
    - Endpoint: `GET /api/v1/metrics/costs?agent_id=...`

### Frontend Tasks:
1.  **Metrics Dashboard:**
    - Add "System Health" and "Cost Analysis" charts to the main dashboard page using `recharts` or `tremor`.
2.  **Agent Cost Badge:**
    - Display estimated lifetime cost/token usage on the agent card.

---

## Status: Phase 1 & 3 Complete, Phase 2 in Progress
- [x] Phase 1: Live Log Streaming (SSE Backend + Console UI)
- [ ] Phase 2: Human-in-the-Loop (Inbox/Approval Service)
- [x] Phase 3: Resource & Cost Monitoring (Metrics Service + UI Cards)
- **Step 1:** Implement Phase 1 Backend (SSE Streamer).
- **Step 2:** Implement Phase 1 Frontend (Log Console).
- **Step 3:** Commit and deploy Phase 1.
- **Repeat for Phase 2 and 3.**
- **Status Reporting:** Update `IMPLEMENTATION_PLAN.md` after every major task.
