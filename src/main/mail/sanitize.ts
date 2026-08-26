/**
 * Sanitize email bodies for the reader.
 *
 * Email HTML is hostile input. This runs in MAIN, before anything reaches the renderer, and
 * is the only path by which message HTML enters the UI. There is no CSP fallback behind it
 * (see the scaffold note) — remote-image blocking is enforced here, not by the browser.
 *
 * What it guarantees:
 *  - no script / iframe / object / embed / form / meta, and no event handlers
 *  - no <style> blocks: the reader renders into the app's own DOM, so a leaked stylesheet
 *    could restyle the app itself. Inline styles survive, filtered to a safe property list.
 *  - no url() in inline styles, so CSS cannot smuggle a tracking fetch past image blocking
 *  - remote <img> src moved to data-blocked-src unless the user opts in per message.
 *    cid: images that mailparser already inlined as data: URIs keep working either way.
 */

import sanitizeHtml from 'sanitize-html'
import type { SanitizedBody } from '@shared/types'

/** Attribute the renderer reads when the user clicks "load images". */
export const BLOCKED_SRC_ATTR = 'data-blocked-src'

/** Marks images we neutralized, so the reader can style the placeholder. */
export const BLOCKED_IMAGE_CLASS = 'blocked-remote-image'

/** Anything not on this list is dropped from inline styles. No positioning, no url(). */
const SAFE_STYLE_PROPERTIES: Record<string, RegExp[]> = {}
for (const property of [
  'color',
  'background-color',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-align',
  'text-decoration',
  'line-height',
  'letter-spacing',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'border-collapse',
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
  'vertical-align',
  'display',
  'white-space',
  'word-break',
  'overflow-wrap'
]) {
  // Reject anything containing url(, expression( or a semicolon-smuggled second declaration.
  SAFE_STYLE_PROPERTIES[property] = [/^(?!.*(?:url\(|expression|javascript:|@import))[^;{}]*$/i]
}

/** true for http(s) and protocol-relative srcs — the ones that leak a read receipt. */
function isRemoteUrl(value: string): boolean {
  const url = value.trim()
  return /^https?:\/\//i.test(url) || url.startsWith('//')
}

interface SanitizeState {
  blocked: number
  hadRemote: boolean
}

function buildOptions(allowRemoteImages: boolean, state: SanitizeState): sanitizeHtml.IOptions {
  return {
    allowedTags: [
      'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup',
      'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strike',
      'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', BLOCKED_SRC_ATTR, 'class'],
      font: ['color', 'face', 'size'],
      table: ['width', 'align', 'border', 'cellpadding', 'cellspacing', 'bgcolor'],
      td: ['width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'bgcolor'],
      th: ['width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'bgcolor'],
      tr: ['align', 'valign', 'bgcolor'],
      col: ['width', 'span'],
      colgroup: ['width', 'span'],
      div: ['align'],
      p: ['align'],
      '*': ['style', 'dir', 'lang']
    },
    allowedStyles: { '*': SAFE_STYLE_PROPERTIES },
    // http(s)/mailto/tel for links; data: is needed for the cid: images mailparser inlined.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    // Drop the CONTENTS of these too, not just the tags — otherwise CSS text and script
    // bodies end up rendered as visible copy.
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'title'],
    disallowedTagsMode: 'discard',
    transformTags: {
      // Mail links always leave the app; main's setWindowOpenHandler routes them to the OS.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' }
      }),
      img: (tagName, attribs) => {
        const src = attribs['src'] ?? ''
        // srcset/loading/referrerpolicy are dropped by allowedAttributes already; a remote
        // src is the only channel left, so it is the only one we have to gate.
        if (!src || !isRemoteUrl(src)) return { tagName, attribs }

        state.hadRemote = true
        if (allowRemoteImages) return { tagName, attribs }

        state.blocked += 1
        const { src: _dropped, ...rest } = attribs
        return {
          tagName,
          attribs: {
            ...rest,
            [BLOCKED_SRC_ATTR]: src,
            alt: attribs['alt'] ?? '',
            class: [attribs['class'], BLOCKED_IMAGE_CLASS].filter(Boolean).join(' ')
          }
        }
      }
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Sanitize a message body for display.
 *
 * Pass the HTML body when there is one, otherwise the plaintext body — plaintext is escaped
 * and wrapped so it keeps its line breaks. `allowRemoteImages` is the per-message opt-in
 * behind the reader's "load images" bar.
 */
export function sanitizeMessageBody(
  body: { html?: string | null; text?: string | null },
  allowRemoteImages: boolean
): SanitizedBody {
  const state: SanitizeState = { blocked: 0, hadRemote: false }

  let html: string
  if (body.html && body.html.trim().length > 0) {
    html = sanitizeHtml(body.html, buildOptions(allowRemoteImages, state))
  } else if (body.text && body.text.trim().length > 0) {
    // Inline style rather than a class: the reader's stylesheet belongs to another module.
    html = `<div style="white-space:pre-wrap;word-break:break-word">${escapeHtml(body.text)}</div>`
  } else {
    html = ''
  }

  return {
    html,
    hadRemoteImages: state.hadRemote,
    blockedImageCount: state.blocked,
    remoteImagesAllowed: allowRemoteImages
  }
}

/**
 * Sanitize an arbitrary HTML fragment with the same rules but no image accounting.
 * Handy for agent-written description_md rendered to HTML.
 */
export function sanitizeFragment(html: string): string {
  const state: SanitizeState = { blocked: 0, hadRemote: false }
  return sanitizeHtml(html, buildOptions(false, state))
}
