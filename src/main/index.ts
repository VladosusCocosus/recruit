import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import * as db from '@main/db'
import { getSettings, setSettingsPath } from '@main/settings'
import { setFallbackStorePath } from '@main/keychain'
import { createServices, registerIpcHandlers, type AppServices } from '@main/ipc'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let services: AppServices | null = null
let shuttingDown = false

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Recruit',
    // Native macOS chrome. The renderer toolbar must leave ~78px of left padding
    // clear for the traffic lights.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f6f6f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // false so the preload bundle can use CJS require(). contextIsolation +
      // nodeIntegration:false still keep the renderer off node entirely.
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // The renderer never navigates itself, and mail links never open in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

/**
 * Startup order matters:
 *   userData paths -> SQLite (migrations + seed) -> services -> IPC -> window -> sync.
 * No IPC handler may run before the DB is open, and the window must not exist before
 * its handlers are registered.
 */
function boot(): void {
  app.setName('Recruit')

  const userData = app.getPath('userData')
  setSettingsPath(join(userData, 'settings.json'))
  setFallbackStorePath(join(userData, 'secrets.enc.json'))

  db.openDatabase({ path: join(userData, 'recruit.db') })

  const settings = getSettings()
  nativeTheme.themeSource = settings.theme

  services = createServices()
  registerIpcHandlers(services)

  mainWindow = createWindow()

  // Background mail sync: backfill, then IDLE + poll. Never blocks the window.
  void services.mail.startAll().catch((error: unknown) => {
    console.error('[main] mail sync failed to start:', error)
  })
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await services?.dispose()
  } catch (error) {
    console.error('[main] service shutdown error:', error)
  }
  services = null
  try {
    db.checkpoint()
    db.closeDatabase()
  } catch (error) {
    console.error('[main] database shutdown error:', error)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    try {
      boot()
    } catch (error) {
      // A failed migration or an unwritable userData dir would otherwise leave the app
      // running with no window and no explanation.
      const message = error instanceof Error ? error.message : String(error)
      console.error('[main] startup failed:', error)
      dialog.showErrorBox('Recruit could not start', message)
      app.exit(1)
      return
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Killing an in-flight agent child and closing the MCP listener is async, so hold the
  // quit for one pass and then let it through.
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    void shutdown().finally(() => app.quit())
  })
}
