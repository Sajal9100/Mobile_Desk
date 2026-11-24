// SPIKE-ONLY (Milestone 1). THROWAWAY.
// The spike must never log SDP bodies, ICE candidates, TURN credentials or tunnel URLs (brief section 6).
// Call sites log fixed strings and numbers only. This is a safety net for error text, not a licence
// to log free-form data: error messages from sockets and WebRTC can embed URLs.

const URL_LIKE = /\b(?:wss?|https?|turns?|stuns?):[^\s'",)]+/gi;

export function redact(text: string): string {
  return text.replace(URL_LIKE, '<url>').slice(0, 160);
}

export function describeError(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${redact(e.message)}`;
  }
  if (typeof e === 'object' && e !== null) {
    // react-native-webrtc rejects with a plain MediaStreamError-like object (for example when the user
    // cancels the capture consent dialog: name/code NotAllowedError), not an Error instance.
    const o = e as { name?: unknown; code?: unknown; message?: unknown };
    const label = typeof o.name === 'string' ? o.name : typeof o.code === 'string' ? o.code : 'object';
    const message = typeof o.message === 'string' ? redact(o.message) : '';
    return message === '' ? label : `${label}: ${message}`;
  }
  return `non-Error thrown: ${redact(String(e))}`;
}
