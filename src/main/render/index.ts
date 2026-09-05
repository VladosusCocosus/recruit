/**
 * Markdown -> PDF, through a hidden BrowserWindow and `webContents.printToPDF()`.
 *
 * The page carries text lifted from a job description. It is loaded as a `data:` URL into
 * a sandboxed window with no preload, no node integration, a deny-all window-open handler,
 * a navigation block and a `default-src 'none'` CSP.
 *
 * The window is never registered with `@main/ipc/bridge`, so no app event reaches it, and
 * it is destroyed in a `finally` on every path.
 */
import { BrowserWindow } from 'electron'
import { renderMarkdownToHtml } from '@shared/markdown'

/** Cap on each of the two steps that can hang: the load and the print. */
const STEP_TIMEOUT_MS = 15_000

const PAGE_WIDTH_PX = 816
const PAGE_HEIGHT_PX = 1056

const MARGIN_INCHES = 0.6

const PDF_OPTIONS: Electron.PrintToPDFOptions = {
  pageSize: 'Letter',
  printBackground: true,
  preferCSSPageSize: false,
  margins: {
    top: MARGIN_INCHES,
    bottom: MARGIN_INCHES,
    left: MARGIN_INCHES,
    right: MARGIN_INCHES
  }
}

const PRINT_CSS = `
@page { size: Letter; margin: ${MARGIN_INCHES}in; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  margin: 0;
  background: #ffffff;
  color: #111111;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
    Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.34;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: break-word;
}

h1, h2, h3, h4, h5, h6 {
  margin: 0;
  font-weight: 600;
  break-after: avoid;
  page-break-after: avoid;
}

h1 { font-size: 18pt; letter-spacing: -0.01em; line-height: 1.15; }
h2 {
  margin-top: 13pt;
  padding-bottom: 2pt;
  border-bottom: 0.5pt solid #b8b8bd;
  font-size: 11pt;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
h3 { margin-top: 9pt; font-size: 10.5pt; }
h4, h5, h6 { margin-top: 8pt; font-size: 10pt; }

h1 + p, h2 + p, h3 + p, h1 + ul, h2 + ul, h3 + ul { margin-top: 4pt; }

.markdown > :first-child { margin-top: 0; }

p { margin: 4pt 0 0; }

ul, ol { margin: 4pt 0 0; padding-left: 14pt; }
li { margin: 0 0 2pt; break-inside: avoid; page-break-inside: avoid; }
li > ul, li > ol { margin-top: 2pt; }

strong { font-weight: 600; }
em { font-style: italic; }

a { color: inherit; text-decoration: none; }

code {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 9.5pt;
}
pre {
  margin: 5pt 0 0;
  padding: 5pt 6pt;
  background: #f4f4f6;
  border-radius: 3pt;
  font-size: 9pt;
  white-space: pre-wrap;
  break-inside: avoid;
  page-break-inside: avoid;
}

blockquote {
  margin: 5pt 0 0;
  padding-left: 8pt;
  border-left: 1.5pt solid #d0d0d5;
  color: #3c3c43;
}

hr { margin: 9pt 0; border: 0; border-top: 0.5pt solid #c8c8cd; }

table { width: 100%; border-collapse: collapse; margin-top: 5pt; font-size: 10pt; }
th, td { padding: 2pt 4pt; text-align: left; vertical-align: top; }
th { font-weight: 600; border-bottom: 0.5pt solid #c8c8cd; }

img { max-width: 100%; }
`

/** Wraps an HTML fragment in a self-contained print document. No network references. */
function printDocument(fragment: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />`,
    '<title>Resume</title>',
    `<style>${PRINT_CSS}</style>`,
    '</head>',
    `<body>${fragment}</body>`,
    '</html>'
  ].join('\n')
}

async function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Rendering the resume timed out after ${STEP_TIMEOUT_MS} ms ${what}.`)),
      STEP_TIMEOUT_MS
    )
  })
  try {
    return await Promise.race([work, expiry])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function harden(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
}

/**
 * Renders `markdown` to a PDF buffer.
 *
 * Rejects when the document fails to load, when either step exceeds STEP_TIMEOUT_MS, or
 * when printing fails.
 */
export async function renderResumePdf(markdown: string): Promise<Buffer> {
  const html = printDocument(renderMarkdownToHtml(markdown))

  const win = new BrowserWindow({
    show: false,
    width: PAGE_WIDTH_PX,
    height: PAGE_HEIGHT_PX,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      webviewTag: false,
      backgroundThrottling: false
    }
  })

  try {
    harden(win)
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    await withTimeout(win.loadURL(url), 'loading the document')
    return await withTimeout(win.webContents.printToPDF(PDF_OPTIONS), 'printing the document')
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
