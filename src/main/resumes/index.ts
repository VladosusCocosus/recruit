/**
 * The resume file seam: reading a resume in from a text file, and handing one back out
 * as a PDF.
 *
 * A resume is markdown in the database. Nothing is kept on disk: `@main/render` builds a
 * PDF on demand, and it lands in a temp file the OS opens or wherever the user saves it.
 *
 * Nothing here takes a path from the renderer. The PDF entry points take a `Resume`, and
 * the handler resolves the id — the same rule `revealDatabase` follows.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import {
  RESUME_MAX_BYTES,
  RESUME_TEXT_EXTENSIONS,
  type Resume,
  type ResumeInput
} from '@shared/types'
import { renderResumePdf } from '@main/render'

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

/** Renders a resume to a temp PDF and opens it in the OS default application. */
export async function openResumePdf(resume: Resume): Promise<void> {
  const pdf = await renderResumePdf(contentOf(resume))
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
  const pdf = await renderResumePdf(contentOf(resume))

  const options: Electron.SaveDialogOptions = {
    title: 'Save resume as PDF',
    buttonLabel: 'Save',
    defaultPath: `${filenameFor(resume.label)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }

  const parent = BrowserWindow.getFocusedWindow()
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, pdf)
  return result.filePath
}
