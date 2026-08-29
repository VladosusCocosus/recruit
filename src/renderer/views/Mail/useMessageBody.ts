/**
 * Loads one message plus its sanitized body.
 *
 * Remote images are a per-message decision. The default comes from AppSettings
 * (blockRemoteImages, true out of the box); "Load remote images" overrides it for the open
 * message only, and the override is keyed by message id so selecting the next message drops
 * back to the safe default without an extra render or a reset effect.
 *
 * The sanitizing happens in MAIN — getMessageHtml(id, allow) is the only path by which
 * message HTML reaches the renderer, and blocking is enforced there, not by CSP.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message, SanitizedBody } from '@shared/types'

export interface UseMessageBodyResult {
  message: Message | null
  /** The fetch settled and main had no such row — a stale deep link, or a deleted message. */
  notFound: boolean
  body: SanitizedBody | null
  loading: boolean
  error: string | null
  allowRemoteImages: boolean
  loadRemoteImages: () => void
}

export function useMessageBody(
  messageId: number | null,
  blockRemoteImagesByDefault: boolean
): UseMessageBodyResult {
  const [message, setMessage] = useState<Message | null>(null)
  const [body, setBody] = useState<SanitizedBody | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState<{ id: number; allow: boolean } | null>(null)

  const ticketRef = useRef(0)
  const loadedIdRef = useRef<number | null>(null)

  const allowRemoteImages =
    messageId != null && override?.id === messageId ? override.allow : !blockRemoteImagesByDefault

  useEffect(() => {
    if (messageId == null) {
      ticketRef.current += 1
      loadedIdRef.current = null
      setMessage(null)
      setBody(null)
      setLoading(false)
      setNotFound(false)
      setError(null)
      return
    }

    const ticket = ticketRef.current + 1
    ticketRef.current = ticket

    // Re-fetching only because the user hit "load images"? Keep the header on screen.
    if (loadedIdRef.current !== messageId) {
      setMessage(null)
      setBody(null)
    }
    setLoading(true)
    setNotFound(false)
    setError(null)

    Promise.all([
      window.recruit.getMessage(messageId),
      window.recruit.getMessageHtml(messageId, allowRemoteImages)
    ])
      .then(([loaded, sanitized]) => {
        if (ticketRef.current !== ticket) return
        loadedIdRef.current = messageId
        setMessage(loaded)
        setBody(sanitized)
        setNotFound(loaded == null)
      })
      .catch((e: unknown) => {
        if (ticketRef.current !== ticket) return
        setError(e instanceof Error ? e.message : String(e))
        setMessage(null)
        setBody(null)
      })
      .finally(() => {
        if (ticketRef.current === ticket) setLoading(false)
      })
  }, [messageId, allowRemoteImages])

  const loadRemoteImages = useCallback(() => {
    if (messageId != null) setOverride({ id: messageId, allow: true })
  }, [messageId])

  return { message, body, notFound, loading, error, allowRemoteImages, loadRemoteImages }
}
