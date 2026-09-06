/**
 * The document file seam: reading a resume in from a text file, and handing a resume or a
 * cover letter back out as a PDF.
 *
 * Two paths out, for two kinds of document:
 *
 *   ON DEMAND — a library resume that was never sent. It is markdown in the database and
 *   nothing else; `@main/render` builds a PDF each time, and it lands in a temp file the
 *   OS opens or wherever the user saves it.
 *
 *   STORED — the resume and the cover letter an application was actually sent with. Those
 *   renders live under `userData/documents`, and the database holds their paths, so what
 *   was sent stays byte-for-byte what is on file.
 *
 * Nothing here takes a path from the renderer. The on-demand entry points take a `Resume`
 * and the stored ones take a path the database gave the handler — the same rule
 * `revealDatabase` follows.
 */
import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import {
  RESUME_MAX_BYTES,
  RESUME_TEXT_EXTENSIONS,
  type Resume,
  type ResumeInput
} from '@shared/types'
import { renderDocumentPdf } from '@main/render'

/** Filename without its extension, trimmed, falling back to the whole name. */
function labelFor(filename: string): string {
  const stem = basename(filename, extname(filename)).trim()
  return stem.length > 0 ? stem : filename
}

/** A label reduced to something usable as a filename. */
function filenameFor(label: string): string {
  const cleaned = label
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()
  return cleaned.length > 0 ? cleaned : 'Resume'
}

/**
 * The markdown of a resume. Throws on a row carried over from the file library, which
 * holds no text to render.
 */
function contentOf(resume: Resume): string {
  if (resume.contentMd === null) {
    throw new Error(
      `"${resume.label}" is a record of a file that is no longer stored, so there is nothing to render.`
    )
  }
  return resume.contentMd
}

/**
 * Opens the file picker and reads a text file as resume markdown. Null when the user
 * cancels. Presented as a sheet on the focused window.
 *
 * Throws when the file is over RESUME_MAX_BYTES or holds no text.
 */
export async function pickResumeText(): Promise<ResumeInput | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Import a resume',
    buttonLabel: 'Import',
    properties: ['openFile'],
    filters: [
      { name: 'Text', extensions: [...RESUME_TEXT_EXTENSIONS] },
      { name: 'All files', extensions: ['*'] }
    ]
  }

  const parent = BrowserWindow.getFocusedWindow()
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)

  const [chosen] = result.filePaths
  if (result.canceled || !chosen) return null

  const bytes = readFileSync(chosen)
  if (bytes.byteLength > RESUME_MAX_BYTES) {
    const kb = Math.round(RESUME_MAX_BYTES / 1024)
    throw new Error(`That file is larger than ${kb} KB. A resume is text, not a document.`)
  }

  const contentMd = bytes.toString('utf8').replace(/\r\n?/g, '\n')
  if (contentMd.trim().length === 0) throw new Error('That file has no text in it.')

  return { label: labelFor(basename(chosen)), contentMd }
}

/** The chosen path, or null when the user cancels. Presented as a sheet on the focused window. */
async function askWhereToSave(options: Electron.SaveDialogOptions): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow()
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** Renders a resume to a temp PDF and opens it in the OS default application. */
export async function openResumePdf(resume: Resume): Promise<void> {
  const pdf = await renderDocumentPdf(contentOf(resume))
  const dir = mkdtempSync(join(tmpdir(), 'recruit-resume-'))
  const path = join(dir, `${filenameFor(resume.label)}.pdf`)
  writeFileSync(path, pdf, { mode: 0o600 })

  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}

/**
 * Renders a resume to PDF and saves it where the user chooses. Returns the path, or null
 * when the user cancels.
 */
export async function saveResumePdf(resume: Resume): Promise<string | null> {
  const pdf = await renderDocumentPdf(contentOf(resume))

  const path = await askWhereToSave({
    title: 'Save resume as PDF',
    buttonLabel: 'Save',
    defaultPath: `${filenameFor(resume.label)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })

  if (!path) return null
  writeFileSync(path, pdf)
  return path
}

/* ────────────────────────────────────────────────────────────────────────────
 * stored documents — the renders an application was actually sent
 * ──────────────────────────────────────────────────────────────────────────── */

/** `userData/documents`, created on first use. */
function documentsDir(): string {
  const dir = join(app.getPath('userData'), 'documents')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Writes a rendered PDF under `userData/documents` and returns its absolute path.
 *
 * The write is atomic: a temp file in the same directory, renamed into place. The
 * filename is `name` plus a random suffix, so two applications to the same company get
 * two files.
 */
export function storeDocumentPdf(pdf: Buffer, name: string): string {
  const dir = documentsDir()
  const stem = `${filenameFor(name)} ${randomBytes(6).toString('hex')}`
  const path = join(dir, `${stem}.pdf`)
  const temp = join(dir, `.${stem}.pdf.part`)

  try {
    writeFileSync(temp, pdf, { mode: 0o600 })
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  return path
}

/** The path, or a clear error naming the file that is gone. */
function requireStored(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`That PDF is no longer on disk: ${path}`)
  }
  return path
}

/** Opens a stored PDF in the OS default application. */
export async function openStoredPdf(path: string): Promise<void> {
  const error = await shell.openPath(requireStored(path))
  if (error) throw new Error(error)
}

/** Shows a stored PDF in Finder. */
export function revealStoredPdf(path: string): void {
  shell.showItemInFolder(requireStored(path))
}

/**
 * Copies a stored PDF to where the user chooses. Returns the new path, or null when the
 * user cancels.
 */
export async function saveStoredPdfAs(path: string, defaultName: string): Promise<string | null> {
  requireStored(path)

  const target = await askWhereToSave({
    title: 'Save a copy as PDF',
    buttonLabel: 'Save',
    defaultPath: `${filenameFor(defaultName)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })

  if (!target) return null
  copyFileSync(path, target)
  return target
}
