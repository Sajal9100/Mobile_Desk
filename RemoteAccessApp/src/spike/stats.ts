// SPIKE-ONLY (Milestone 1). THROWAWAY.
// Turns an RTCStatsReport (a Map of stat objects) into one evidence line. Only a WHITELIST of numeric
// and enum fields is read. Never read or print address, ip, port, url, usernameFragment or anything
// that identifies a network or a TURN server.
import type { Role } from './types';

type Stat = Record<string, unknown>;

export type StatsSample = {
  role: Role;
  fps: number | null;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  rttMs: number | null;
  local: string | null;
  remote: string | null;
  codec: string | null;
  implementation: string | null;
  limitation: string | null;
  framesDropped: number | null;
  freezeCount: number | null;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Rate of a monotonically increasing counter between two polls, using the local clock. */
export class RateTracker {
  private prev: { t: number; value: number } | null = null;

  /** Returns units per second, or null on the first sample or if the counter went backwards. */
  update(value: number | null, nowMs: number): number | null {
    if (value === null) {
      return null;
    }
    const p = this.prev;
    this.prev = { t: nowMs, value };
    if (p === null || nowMs <= p.t || value < p.value) {
      return null;
    }
    return ((value - p.value) * 1000) / (nowMs - p.t);
  }
}

function describeCandidate(c: Stat | undefined): string | null {
  if (c === undefined) {
    return null;
  }
  const type = str(c.candidateType) ?? '?';
  const protocol = str(c.protocol) ?? '?';
  const network = str(c.networkType);
  return `${type}/${protocol}${network !== null ? ` ${network}` : ''}`;
}

const isVideo = (s: Stat) => s.kind === 'video' || s.mediaType === 'video';

export function parseStats(
  report: Map<unknown, unknown>,
  role: Role,
  bytes: RateTracker,
  frames: RateTracker,
  nowMs: number,
): StatsSample {
  const all: Stat[] = [];
  report.forEach((v) => {
    if (typeof v === 'object' && v !== null) {
      all.push(v as Stat);
    }
  });
  const byId = new Map<string, Stat>();
  all.forEach((s) => byId.set(String(s.id), s));

  const rtpType = role === 'viewer' ? 'inbound-rtp' : 'outbound-rtp';
  const rtp = all.find((s) => s.type === rtpType && isVideo(s));

  const byteCounter = role === 'viewer' ? num(rtp?.bytesReceived) : num(rtp?.bytesSent);
  const frameCounter = role === 'viewer' ? num(rtp?.framesDecoded) : num(rtp?.framesEncoded);
  const bytesPerSecond = bytes.update(byteCounter ?? null, nowMs);
  const framesPerSecondFromCounter = frames.update(frameCounter ?? null, nowMs);

  const transport = all.find((s) => s.type === 'transport' && str(s.selectedCandidatePairId) !== null);
  let pair = transport !== undefined ? byId.get(String(transport.selectedCandidatePairId)) : undefined;
  if (pair === undefined) {
    pair = all.find(
      (s) =>
        s.type === 'candidate-pair' && (s.selected === true || (s.nominated === true && s.state === 'succeeded')),
    );
  }

  const rttSeconds = num(pair?.currentRoundTripTime);
  const codecId = str(rtp?.codecId);
  const codec = codecId !== null ? str(byId.get(codecId)?.mimeType) : null;

  return {
    role,
    fps: num(rtp?.framesPerSecond) ?? framesPerSecondFromCounter,
    width: num(rtp?.frameWidth),
    height: num(rtp?.frameHeight),
    bitrateKbps: bytesPerSecond !== null ? (bytesPerSecond * 8) / 1000 : null,
    rttMs: rttSeconds !== null ? rttSeconds * 1000 : null,
    local: describeCandidate(pair !== undefined ? byId.get(String(pair.localCandidateId)) : undefined),
    remote: describeCandidate(pair !== undefined ? byId.get(String(pair.remoteCandidateId)) : undefined),
    codec,
    implementation: str(role === 'viewer' ? rtp?.decoderImplementation : rtp?.encoderImplementation),
    limitation: role === 'sharer' ? str(rtp?.qualityLimitationReason) : null,
    framesDropped: num(rtp?.framesDropped),
    freezeCount: num(rtp?.freezeCount),
  };
}

const f1 = (v: number | null) => (v === null ? '-' : v.toFixed(1));
const f0 = (v: number | null) => (v === null ? '-' : String(Math.round(v)));

/** One compact evidence line; contains only numbers and enum strings, safe to log. */
export function formatSample(s: StatsSample): string {
  const size = s.width !== null && s.height !== null ? `${s.width}x${s.height}` : '-';
  const parts = [
    s.role === 'viewer' ? 'RECV' : 'SEND',
    `fps=${f1(s.fps)}`,
    `size=${size}`,
    `kbps=${f0(s.bitrateKbps)}`,
    `rtt=${f0(s.rttMs)}ms`,
    `local=${s.local ?? '-'}`,
    `remote=${s.remote ?? '-'}`,
    `codec=${s.codec ?? '-'}`,
    `impl=${s.implementation ?? '-'}`,
  ];
  if (s.role === 'sharer') {
    parts.push(`limit=${s.limitation ?? '-'}`);
  } else {
    parts.push(`dropped=${f0(s.framesDropped)}`, `freezes=${f0(s.freezeCount)}`);
  }
  return parts.join(' ');
}
