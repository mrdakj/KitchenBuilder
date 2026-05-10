// Plays the placement SFX copied from the reference editor project
// (public/audio/item_place.mp3). WebAudio path is preferred — decoded once
// into an AudioBuffer, then each play is a fresh BufferSource that starts
// immediately with no decode/seek latency. HTMLAudioElement is the
// fallback for the rare browsers without WebAudio. The very first
// playPlaceSound() call doubles as the unlock gesture (autoplay policies
// require a user-initiated event), so subsequent placements layer cleanly.

let ctx: AudioContext | null = null
let buffer: AudioBuffer | null = null
let bufferLoading = false
let fallbackEl: HTMLAudioElement | null = null

const URL_PATH = '/audio/item_place.mp3'
const VOLUME = 0.6

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  return ctx
}

function ensureBuffer() {
  if (buffer || bufferLoading) return
  const c = getCtx()
  if (!c) return
  bufferLoading = true
  fetch(URL_PATH)
    .then((r) => r.arrayBuffer())
    .then((buf) => c.decodeAudioData(buf))
    .then((decoded) => {
      buffer = decoded
      bufferLoading = false
    })
    .catch(() => {
      bufferLoading = false
    })
}

function getFallback(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!fallbackEl) {
    fallbackEl = new Audio(URL_PATH)
    fallbackEl.preload = 'auto'
    fallbackEl.volume = VOLUME
  }
  return fallbackEl
}

// Kick off the decode immediately at module load so by the time the user
// places anything the buffer is ready. Safe to call repeatedly.
ensureBuffer()

export function playPlaceSound() {
  const c = getCtx()
  if (c && buffer) {
    if (c.state === 'suspended') c.resume().catch(() => {})
    const src = c.createBufferSource()
    src.buffer = buffer
    const gain = c.createGain()
    gain.gain.value = VOLUME
    src.connect(gain).connect(c.destination)
    src.start(0)
    return
  }
  // WebAudio not ready (still decoding, or unsupported) — fall back to
  // the HTMLAudioElement path so the first click still gets a sound.
  ensureBuffer()
  const base = getFallback()
  if (!base) return
  const inst = base.cloneNode(true) as HTMLAudioElement
  inst.volume = VOLUME
  inst.play().catch(() => {
    // Browsers block playback before any user interaction has occurred.
    // The very first placement IS a user click, so this rejection should
    // only happen for synthetic invocations.
  })
}
