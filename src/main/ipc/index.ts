/**
 * The integration layer. `src/main/index.ts` only ever talks to this barrel.
 *
 *   const services = createServices()
 *   registerIpcHandlers(services)
 *   await services.mail.startAll()
 *   ...
 *   await services.dispose()
 */
export { broadcast, handle } from './bridge'
export { createServices, type AppServices } from './services'
export { registerIpcHandlers } from './handlers'
export { createAgentRepo } from './agentRepo'
export { createMailService, persistSyncedMessage, type MailService } from './mail'
export { deleteAccountWithSecrets, saveAccountWithSecrets } from './accounts'
