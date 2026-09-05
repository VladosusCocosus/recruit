/**
 * The resume store: the only module that touches `userData/resumes`.
 *
 * Files are COPIED in rather than referenced, so a resume renamed or moved on disk later
 * still resolves to what was actually sent. The copy is named by content hash, which is
 * also the dedupe key in the `resumes` table.
 *
 * Nothing here takes a path from the renderer. `open` and `reveal` take a resume id and
 * resolve the path against the database, the same rule `revealDatabase` follows.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, app, dialog, shell } from 'electron'
import {
  RESUME_EXTENSIONS,
  RESUME_MASTER_EXTENSIONS,
  RESUME_MASTER_MAX_BYTES,
  RESUME_MAX_BYTES,
  type Resume,
  type ResumeMasterInput
} from '@shared/types'
import * as db from '@main/db'

const DIRECTORY = 'resumes'

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pages': 'application/x-iwork-pages-sffpages'
}

export function resumesDir(): string {
  const dir = join(app.getPath('userData'), DIRECTORY)
  mkdirSync(dir, { recursive: true })
  return dir
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Filename without its extension, trimmed, falling back to the whole name. */
function labelFor(filename: string): string {
  const stem = basename(filename, extname(filename)).trim()
  return stem.length > 0 ? stem : filename
}

/** What an entry point may vary about the row a stored file gets. */
interface StoreOptions {
  /** Overrides the label derived from the filename. */
  label?: string
  makeDefault?: boolean
  /** The resume master this file was rendered from. Null for an uploaded file. */
  derivedFromMasterId?: number | null
}

/**
 * Copies `sourcePath` into the store and records it. Reuses the existing row when the same
 * bytes are already stored.
 *
 * Throws when the file is missing or over RESUME_MAX_BYTES.
 */
function storeFile(sourcePath: string, options: StoreOptions = {}): Resume {
  if (!existsSync(sourcePath)) throw new Error(`No such file: ${sourcePath}`)

  const bytes = readFileSync(sourcePath)
  if (bytes.byteLength > RESUME_MAX_BYTES) {
    const mb = Math.round(RESUME_MAX_BYTES / (1024 * 1024))
    throw new Error(`That file is larger than ${mb} MB.`)
  }

  const filename = basename(sourcePath)
  const extension = extname(filename).toLowerCase()
  const hash = sha256(bytes)
  const target = join(resumesDir(), `${hash}${extension}`)

  if (!existsSync(target)) {
    const tmp = `${target}.tmp`
    writeFileSync(tmp, bytes, { mode: 0o600 })
    renameSync(tmp, target)
  }

  const input: db.ResumeFileInput = {
    label: options.label?.trim() || labelFor(filename),
    filename,
    diskPath: target,
    mimeType: MIME_BY_EXTENSION[extension] ?? null,
    size: bytes.byteLength,
    sha256: hash,
    derivedFromMasterId: options.derivedFromMasterId ?? null
  }

  return db.createResume(input, options.makeDefault ?? false)
}

/** The file-dialog entry point into the store. */
export function storeResumeFile(sourcePath: string, makeDefault = false): Resume {
  return storeFile(sourcePath, { makeDefault })
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
 * Files a rendered PDF as a resume: hashed, copied and deduped exactly like an uploaded
 * file, carrying `label` and the master it came from. The temp file is removed either way.
 */
export function storeRenderedResume(
  pdf: Buffer,
  label: string,
  derivedFromMasterId: number
): Resume {
  const dir = mkdtempSync(join(tmpdir(), 'recruit-resume-'))
  const path = join(dir, `${filenameFor(label)}.pdf`)
  try {
    writeFileSync(path, pdf, { mode: 0o600 })
    return storeFile(path, { label, derivedFromMasterId })
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* a stray temp file is not worth failing the call */
    }
  }
}

/**
 * Opens the file picker and stores the chosen file. Null when the user cancels.
 * Presented as a sheet on the focused window.
 */
export async function pickResumeFile(makeDefault = false): Promise<Resume | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a resume',
    buttonLabel: 'Use this resume',
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: [...RESUME_EXTENSIONS] },
      { name: 'All files', extensions: ['*'] }
    ]
  }

  const parent = BrowserWindow.getFocusedWindow()
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)

  const [chosen] = result.filePaths
  if (result.canceled || !chosen) return null
  return storeResumeFile(chosen, makeDefault)
}

/**
 * Opens the file picker and reads a text file as master-resume markdown. Null when the
 * user cancels. Nothing is copied into the store: a master lives in the database.
 *
 * Throws when the file is over RESUME_MASTER_MAX_BYTES or holds no text.
 */
export async function pickResumeMasterText(): Promise<ResumeMasterInput | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Import a resume',
    buttonLabel: 'Import',
    properties: ['openFile'],
    filters: [
      { name: 'Text', extensions: [...RESUME_MASTER_EXTENSIONS] },
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
  if (bytes.byteLength > RESUME_MASTER_MAX_BYTES) {
    const kb = Math.round(RESUME_MASTER_MAX_BYTES / 1024)
    throw new Error(`That file is larger than ${kb} KB. A resume is text, not a document.`)
  }

  const contentMd = bytes.toString('utf8').replace(/\r\n?/g, '\n')
  if (contentMd.trim().length === 0) throw new Error('That file has no text in it.')

  return { label: labelFor(basename(chosen)), contentMd }
}

function pathOf(resumeId: number): string {
  const path = db.resumePath(resumeId)
  if (!path) throw new Error(`Resume ${resumeId} not found`)
  if (!existsSync(path)) throw new Error('That resume file is missing from disk.')
  return path
}

/** Opens a stored resume in the OS default application. */
export async function openResume(resumeId: number): Promise<void> {
  const error = await shell.openPath(pathOf(resumeId))
  if (error) throw new Error(error)
}

/** Shows a stored resume in Finder. */
export function revealResume(resumeId: number): void {
  shell.showItemInFolder(pathOf(resumeId))
}

/**
 * Archives a resume and deletes its file when no item points at it. A resume still in use
 * keeps its bytes — the items referencing it are a record of what was sent.
 */
export function archiveResume(resumeId: number): void {
  const resume = db.getResume(resumeId)
  if (!resume) return
  const path = db.resumePath(resumeId)
  db.archiveResume(resumeId)
  if (resume.usageCount === 0 && path && existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      /* the row is archived either way; a stray file is not worth failing the call */
    }
  }
}
