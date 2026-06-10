# `src/orchestration/` — L3 MCP + Event-Driven CEP

> **Status:** scaffold (empty). No business logic yet. Interface reference lives in
> `planning/code-templates/agent_orchestrator.ts` and `mcp_tool.ts`.

**What lives here:** the MCP server/client, the **event bus**, the **CEP pattern matcher**, the **event
router**, the **Context Aggregator** (fuses geofence + patient state before any SLM call), and the four named
agents (**caregiver / patient-state / coordinator / safety-reviewer**). This is where the SLM is *called*,
not where it *runs*.

**Orchestrator-mediated subagent I/O:** subagents never read/write directly; the orchestrator assembles their
inputs and decides what to do with their outputs (emit / persist / surface for HITL / trigger notification).
This single chokepoint is what makes the system HIPAA-auditable.

**Ordering reminder:** in ST-01/ST-02 the orchestrator invokes the SLM **only after** the caregiver provides
ground-truth; ST-03 short-circuits the orchestrator on the emergency fast path (SLM "Explain" runs on demand).

**Primary owner:** Ethan. Jay owns the coordinator/alert path.
