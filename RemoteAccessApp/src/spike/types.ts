// SPIKE-ONLY (Milestone 1). THROWAWAY: deleted after the M1 report.

export type Role = 'sharer' | 'viewer';

/** Typed by hand and validated at runtime in signaling.ts. Never log these payloads. */
export type IceCandidateInit = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
};

export type SignalMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: IceCandidateInit }
  | { type: 'peers'; count: number }
  | { type: 'peer-left' }
  | { type: 'full' };

export type SpikeConfig = {
  signalingUrl: string;
  room: string;
  /** One or more comma-separated turn:/turns: URLs. Empty = no ICE servers (host candidates only). */
  turnUrls: string;
  turnUser: string;
  turnCredential: string;
  relayOnly: boolean;
  /** Android 14+: ask the system to offer "entire screen" only (no single-app sharing). */
  entireScreenOnly: boolean;
  maxBitrateKbps: number | null;
  maxFps: number | null;
};

export type SessionCallbacks = {
  log: (text: string) => void;
  status: (text: string) => void;
  remoteStream: (stream: unknown) => void;
  stats: (text: string) => void;
  /** Fired once when the session has stopped itself (for example capture revoked by the system). */
  ended: (reason: string) => void;
};
