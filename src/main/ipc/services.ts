/**
 * The composition root. Everything stateful in the main process is built here, in
 * dependency order, and torn down in reverse.
 *
 * There is exactly ONE database writer: the MCP server runs inside this process (not a
 * child), so the agent's proposal writes go through the same better-sqlite3 handle as the
 * IPC handlers.
 */
import { createAgentRunner, type AgentRunner } from '@main/agent'
import { getSettings, resolveAgentBinary } from '@main/settings'
import type { AgentEngine } from '@shared/types'
import { createAgentRepo } from './agentRepo'
import { broadcast } from './bridge'
import { createMailService, type MailService } from './mail'

export interface AppServices {
  mail: MailService
  runner: AgentRunner
  dispose(): Promise<void>
}

export function createServices(): AppServices {
  const mail = createMailService()

  const runner = createAgentRunner({
    repo: createAgentRepo(),

    // The runner folds every tool call into the run's AgentRunUpdate and republishes it,
    // so the toolbar's live "current tool call" text arrives via runUpdate below. This
    // hook is just for the main-process log.
    onToolCall: (event) => {
      if (event.phase === 'error') {
        console.warn(`[agent] run ${event.runId} ${event.tool} failed: ${event.error ?? ''}`)
      }
    },

    onRunUpdate: (update) => broadcast('runUpdate', update),

    // Getters, not values: Settings can change the engine / model / enrichment toggle /
    // CLI path while the app is running, and the runner reads these at spawn time.
    get engine(): AgentEngine {
      return getSettings().agentEngine
    },
    get agentBin(): string | undefined {
      const resolved = resolveAgentBinary(getSettings().agentEngine)
      return resolved.available ? resolved.path : undefined
    },
    get model(): string {
      return getSettings().model
    },
    get enrichmentEnabled(): boolean {
      return getSettings().enrichmentEnabled
    }
  })

  return {
    mail,
    runner,
    async dispose() {
      // Agent first: it holds child processes and an HTTP listener.
      await runner.dispose().catch(() => undefined)
      await mail.dispose().catch(() => undefined)
    }
  }
}
