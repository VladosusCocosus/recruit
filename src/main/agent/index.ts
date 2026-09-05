/**
 * The agent bridge. Wire it up in src/main/index.ts:
 *
 *   const runner = createAgentRunner({
 *     repo,                                     // your AgentRepo impl
 *     onToolCall: (e) => broadcast('runUpdate', runner.getActiveRun()!),
 *     onRunUpdate: (u) => broadcast('runUpdate', u),
 *     model: settings.model,
 *     enrichmentEnabled: settings.enrichmentEnabled
 *   })
 *
 *   handle('startRun', async (input) => { ... runner.spawnTriageRun(ids) ... })
 *   handle('stopRun', async (runId) => runner.cancelRun(runId))
 *   handle('getActiveRun', async () => runner.getActiveRun())
 *   app.on('before-quit', () => void runner.dispose())
 */
export type {
  AgentDeps,
  AgentRepo,
  AgentToolCallEvent,
  Awaitable,
  CreatedRun,
  CreateRunInput,
  FinishRunPatch,
  InsertProposalInput
} from './deps'
export { createMcpServer, type McpBridge } from './mcpServer'
export {
  adapterFor,
  buildClaudeArgv,
  buildCodexArgv,
  claudeAdapter,
  codexAdapter,
  codexPrompt,
  CODEX_TOKEN_ENV_VAR,
  EMPTY_MCP_CONFIG,
  findClaudeBin,
  findCodexBin,
  NO_TOOLS,
  parseCodexEvents,
  parseEnvelope,
  RUN_KIND_POLICY,
  WEB_TOOLS,
  type AgentEngineAdapter,
  type CommandInput,
  type EngineCommand,
  type EngineOutput,
  type McpTarget,
  type RunKindPolicy
} from './engines'
export {
  classifyAgentError,
  createAgentRunner,
  looksLikeAuthFailure,
  MAX_PROMPT_BYTES,
  redactArgv,
  type AgentRunner,
  type AgentRunResult,
  type RunOptions,
  type StartedRun
} from './runner'
export {
  ENRICH_SYSTEM_PROMPT,
  enrichTaskPrompt,
  TAILOR_SYSTEM_PROMPT,
  tailorTaskPrompt,
  TRIAGE_SYSTEM_PROMPT,
  triageTaskPrompt
} from './prompts'
export { MCP_SERVER_NAME, TRACKER_ALLOWED_TOOLS, TRACKER_TOOL_NAMES } from './schemas'
