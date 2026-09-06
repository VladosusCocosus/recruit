/**
 * Markdown -> PDF, through a hidden BrowserWindow and `webContents.printToPDF()`. One
 * page style for both documents an application is sent: the resume and the cover letter.
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

:root {
  --sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica,
    Arial, sans-serif;
}

body {
  margin: 0;
  background: #ffffff;
  color: #1a1a1c;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  font-size: 10.5pt;
  line-height: 1.44;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: break-word;
  orphans: 2;
  widows: 2;
}

h1, h2, h3, h4 {
  margin: 0;
  font-weight: 600;
  break-after: avoid;
  page-break-after: avoid;
}

h1 { font-size: 22pt; letter-spacing: -0.005em; line-height: 1.12; }
h2 {
  margin-top: 18pt;
  padding-bottom: 3pt;
  border-bottom: 0.75pt solid #26262c;
  font-family: var(--sans);
  font-size: 8.25pt;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: #3a3a42;
}
h3 { margin-top: 12pt; font-size: 11pt; }
h4 { margin-top: 8pt; font-size: 10pt; }
h2 + h3 { margin-top: 7pt; }

h1 + p, h2 + p, h1 + ul, h2 + ul, h3 + ul { margin-top: 5pt; }

/** The contact line: the paragraph directly under the name. */
.markdown > h1 + p {
  margin-top: 6pt;
  font-family: var(--sans);
  font-size: 9.5pt;
  letter-spacing: 0.015em;
  color: #4c4c55;
}

/** A role's meta line: the paragraph between its heading and its bullets. */
h3 + p {
  margin-top: 2pt;
  break-after: avoid;
  page-break-after: avoid;
}
h3 + p em {
  font-family: var(--sans);
  font-style: normal;
  font-size: 8.75pt;
  letter-spacing: 0.015em;
  color: #6a6a74;
}
h3 + p + ul { margin-top: 5pt; }

.markdown > :first-child { margin-top: 0; }

p { margin: 5pt 0 0; }

ul, ol { margin: 5pt 0 0; padding-left: 13pt; }
li { margin: 0 0 3.5pt; break-inside: avoid; page-break-inside: avoid; }
li::marker { color: #9a9aa2; }
li > ul, li > ol { margin-top: 2.5pt; }

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

hr { margin: 10pt 0; border: 0; border-top: 0.5pt solid #c8c8cd; }
`

/** Wraps an HTML fragment in a self-contained print document. No network references. */
function printDocument(fragment: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />`,
    '<title>Document</title>',
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
      () =>
        reject(new Error(`Rendering the document timed out after ${STEP_TIMEOUT_MS} ms ${what}.`)),
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
export async function renderDocumentPdf(markdown: string): Promise<Buffer> {
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
