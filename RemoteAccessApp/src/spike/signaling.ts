// SPIKE-ONLY (Milestone 1). THROWAWAY.
import type { IceCandidateInit, SignalMessage } from './types';

export type SignalingState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface Signaling {
  send(msg: SignalMessage): void;
  close(): void;
}

export type SignalingHandlers = {
  onMessage: (msg: SignalMessage) => void;
  onState: (state: SignalingState) => void;
};

export type SignalingFactory = (handlers: SignalingHandlers) => Signaling;

const HEARTBEAT_MS = 5000;
const MAX_RETRY_DELAY_MS = 5000;

function isCandidateInit(v: unknown): v is IceCandidateInit {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const c = v as Record<string, unknown>;
  return (
    typeof c.candidate === 'string' &&
    (typeof c.sdpMid === 'string' || c.sdpMid === null) &&
    (typeof c.sdpMLineIndex === 'number' || c.sdpMLineIndex === null)
  );
}

/** Returns null for anything that is not a well-formed message of a known type (heartbeats included). */
export function parseSignal(data: unknown): SignalMessage | null {
  if (typeof data !== 'string') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const m = parsed as Record<string, unknown>;
  switch (m.type) {
    case 'offer':
      return typeof m.sdp === 'string' ? { type: 'offer', sdp: m.sdp } : null;
    case 'answer':
      return typeof m.sdp === 'string' ? { type: 'answer', sdp: m.sdp } : null;
    case 'ice':
      return isCandidateInit(m.candidate) ? { type: 'ice', candidate: m.candidate } : null;
    case 'peers':
      return typeof m.count === 'number' ? { type: 'peers', count: m.count } : null;
    case 'peer-left':
      return { type: 'peer-left' };
    case 'full':
      return { type: 'full' };
    default:
      return null;
  }
}

/**
 * WebSocket client for the throwaway relay. Joins `room` on every (re)connect and reconnects with
 * backoff, because row 7 of the test matrix switches networks mid-session. An application-level
 * heartbeat makes a dead socket fail fast (a Wi-Fi to mobile switch otherwise leaves it hanging).
 */
export function connectSignaling(url: string, room: string, handlers: SignalingHandlers): Signaling {
  let ws: WebSocket | null = null;
  let closedByUs = false;
  let attempt = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const stopHeartbeat = () => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const open = () => {
    handlers.onState(attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      attempt = 0;
      socket.send(JSON.stringify({ type: 'join', room }));
      handlers.onState('open');
      stopHeartbeat();
      heartbeat = setInterval(() => {
        try {
          socket.send('{"type":"hb"}');
        } catch {
          // A failed write is followed by onclose, which schedules the reconnect.
        }
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (ev) => {
      const msg = parseSignal(ev.data);
      if (msg) {
        handlers.onMessage(msg);
      }
    };

    socket.onerror = () => {
      // Deliberately empty: the error text can contain the URL. onclose always follows.
    };

    socket.onclose = () => {
      if (ws !== socket) {
        return;
      }
      stopHeartbeat();
      if (closedByUs) {
        return;
      }
      attempt += 1;
      handlers.onState('reconnecting');
      retry = setTimeout(open, Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt));
    };
  };

  open();

  return {
    send: (msg) => {
      if (ws !== null && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    },
    close: () => {
      closedByUs = true;
      stopHeartbeat();
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
      ws?.close();
      handlers.onState('closed');
    },
  };
}

/**
 * In-process stand-in for the relay, used by the single-device loopback self-test. Mirrors the
 * server's behaviour: when the second end joins, both ends receive {peers: 2}.
 */
export function createMemorySignalingPair(): [SignalingFactory, SignalingFactory] {
  type End = { handlers: SignalingHandlers | null; closed: boolean };
  const a: End = { handlers: null, closed: false };
  const b: End = { handlers: null, closed: false };

  const make =
    (self: End, other: End): SignalingFactory =>
    (handlers) => {
      self.handlers = handlers;
      // Decided synchronously so exactly one end (the second to join) triggers the "2" broadcast.
      const peer = other.handlers;
      Promise.resolve().then(() => {
        handlers.onState('open');
        if (peer !== null) {
          handlers.onMessage({ type: 'peers', count: 2 });
          peer.onMessage({ type: 'peers', count: 2 });
        } else {
          handlers.onMessage({ type: 'peers', count: 1 });
        }
      });
      return {
        send: (msg) => {
          if (!self.closed) {
            const target = other.handlers;
            Promise.resolve().then(() => target?.onMessage(msg));
          }
        },
        close: () => {
          self.closed = true;
          const target = other.handlers;
          Promise.resolve().then(() => target?.onMessage({ type: 'peer-left' }));
        },
      };
    };

  return [make(a, b), make(b, a)];
}
