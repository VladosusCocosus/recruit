/**
 * `AgentRepo` implemented over `@main/db`.
 *
 * src/main/agent/** deliberately imports nothing from src/main/db — this file IS the seam.
 * Every mismatch between the two module's shapes is absorbed here, not in either module.
 *
 * The two properties that matter and are structural rather than checked:
 *  - there is no live-mutation method on AgentRepo at all, so no MCP tool can reach
 *    items/timeline_events/item_messages. `insertProposal` is the only write.
 *  - `isMessageAllowed` is the read gate the bridge consults before get_message.
 */
import type { AgentRepo } from '@main/agent'
import * as db from '@main/db'

/** Cap on what `search_items` hands the model in one call. */
const SEARCH_LIMIT = 50

export function createAgentRepo(): AgentRepo {
  return {
    // ── per-run READ ALLOWLIST ───────────────────────────────────────────────
    isMessageAllowed: (runId, messageId) => db.isMessageAllowed(runId, messageId),

    listRunMessages: (runId) => db.listMessagesByIds(db.listRunMessageIds(runId)),

    getMessage: (messageId) => db.getMessage(messageId),

    // ── tracker reads ────────────────────────────────────────────────────────
    listItems: (query) => db.listItems(query),

    // AgentRepo.getItem is documented as "item + its timeline" -> ItemDetail.
    // db.getItem returns a bare Item; getItemWithTimeline is the ItemDetail one.
    getItem: (itemId) => db.getItemWithTimeline(itemId),

    // db.searchItems returns the narrower ItemDigest[]; the MCP layer projects
    // ItemSummary fields (workMode, eventCount, nextEvent, …), so go through listItems.
    searchItems: (query) => db.listItems({ query, includeArchived: true, limit: SEARCH_LIMIT }),

    // ── the only write ───────────────────────────────────────────────────────
    insertProposal: (input) =>
      db.insertProposal({
        runId: input.runId,
        kind: input.kind,
        ref: input.ref,
        targetItemId: input.targetItemId,
        targetEventId: input.targetEventId,
        payload: input.payload,
        confidence: input.confidence,
        rationale: input.rationale
      }),

    countRunProposals: (runId) => db.countProposalsByRun(runId),

    // ── run rows ─────────────────────────────────────────────────────────────
    createRun: (input) => {
      const run = db.createRun({ kind: input.kind, model: input.model })
      return { id: run.id, startedAt: run.startedAt }
    },

    /**
     * db.createRun can take the argv up front, but the runner writes it in a second
     * step because argv embeds the run-scoped bearer token, which cannot exist until
     * the run row does. There is no db.setRunCommand, so write the column directly.
     * The runner passes an ALREADY-REDACTED argv ("Bearer ***").
     */
    setRunCommand: (runId, command) => {
      db.execute(
        'UPDATE agent_runs SET command_json = ? WHERE id = ?',
        JSON.stringify(command),
        runId
      )
    },

    attachRunMessages: (runId, messageIds) => db.setRunAllowlist(runId, messageIds),

    finishRun: (runId, patch) => {
      db.finishRun(runId, {
        finishedAt: patch.finishedAt,
        sessionId: patch.sessionId,
        exitCode: patch.exitCode,
        isError: patch.isError,
        errorText: patch.errorText,
        durationMs: patch.durationMs,
        costUsd: patch.costUsd,
        // agent calls it rawEnvelope; the db patch calls it envelope.
        envelope: patch.rawEnvelope
      })
    }
  }
}
