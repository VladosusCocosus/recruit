/**
 * Copy plain text to the system clipboard.
 *
 * The async Clipboard API needs a secure context, and in production the renderer is
 * loaded from `file://` rather than a server. Chromium does treat file: as potentially
 * trustworthy, so `navigator.clipboard` is normally there — but "normally" is not a
 * guarantee to hang a menu item on, and the failure mode is silent. Hence the fallback:
 * a throwaway textarea and the old synchronous copy command, which works everywhere and
 * needs no permission.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopy(text)
  }
}

function legacyCopy(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  // Off screen rather than hidden: `display: none` and `visibility: hidden` elements
  // cannot be selected, which is the entire mechanism this relies on.
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.top = '-1000px'
  field.style.opacity = '0'
  document.body.appendChild(field)
  try {
    field.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}
