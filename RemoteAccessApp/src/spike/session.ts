// SPIKE-ONLY (Milestone 1). THROWAWAY: deleted after the M1 report.
// One side of a screen-share: either the sharer (captures + offers) or the viewer (answers + renders).
// Logging rule: log fixed strings, enums and numbers only. Never SDP, ICE candidates, URLs, credentials.
import { PermissionsAndroid, Platform } from 'react-native';
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import { describeError } from './redact';
import { detach } from './util';
import type { Signaling, SignalingFactory, SignalingState } from './signaling';
import { RateTracker, formatSample, parseStats } from './stats';
import type { IceCandidateInit, Role, SessionCallbacks, SignalMessage, SpikeConfig } from './types';

type IceServer = { urls: string | string[]; username?: string; credential?: string };

const STATS_INTERVAL_MS = 2000;
const DISCONNECT_GRACE_MS = 3000;

/** TURN entry with credentials, plus a STUN entry on the same host so 'all' policy can gather srflx. */
export function buildIceServers(cfg: SpikeConfig): IceServer[] {
  const urls = cfg.turnUrls.split(/[\s,]+/).filter((u) => /^turns?:/i.test(u));
  if (urls.length === 0) {
    return [];
  }
  const servers: IceServer[] = [{ urls, username: cfg.turnUser, credential: cfg.turnCredential }];
  const plainTurn = urls.find((u) => /^turn:/i.test(u));
  if (plainTurn !== undefined) {
    servers.push({ urls: `stun:${plainTurn.slice('turn:'.length).split('?')[0]}` });
  }
  return servers;
}

export class SpikeSession {
  private pc: RTCPeerConnection | null = null;
  private signaling: Signaling | null = null;
  private local: MediaStream | null = null;
  private pendingRemoteCandidates: IceCandidateInit[] = [];
  private peers = 0;
  private signalingOpen = false;
  private done = false;
  private negotiating = false;
  private owesOffer = false;
  private lostAt: number | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly bytes = new RateTracker();
  private readonly frames = new RateTracker();

  constructor(
    private readonly role: Role,
    private readonly cfg: SpikeConfig,
    private readonly cb: SessionCallbacks,
    private readonly makeSignaling: SignalingFactory,
  ) {}

  async start(): Promise<void> {
    try {
      if (this.role === 'sharer') {
        await this.startCapture();
        if (this.done) {
          return; // Stop was pressed while the system consent dialog was open.
        }
      }
      this.cb.status('connecting to signaling');
      this.signaling = this.makeSignaling({
        onMessage: (m) => detach(this.onSignal(m)),
        onState: (s) => this.onSignalingState(s),
      });
      this.statsTimer = setInterval(() => detach(this.pollStats()), STATS_INTERVAL_MS);
    } catch (e) {
      this.cb.log(`start failed: ${describeError(e)}`);
      this.stop('start-failed');
    }
  }

  /**
   * Correct stop: release the stream. In react-native-webrtc, MediaStreamTrack.stop() only sets
   * enabled=false; the native capturer, MediaProjection and foreground service are released by
   * track.release() / stream.release(). Order mirrors plan 6.2: capture first, then the session.
   */
  stop(reason: string): void {
    if (this.done) {
      return;
    }
    this.done = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
    }
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
    }
    if (this.local !== null) {
      try {
        this.local.release();
      } catch (e) {
        this.cb.log(`stream release failed: ${describeError(e)}`);
      }
      this.local = null;
    }
    try {
      this.pc?.close();
    } catch (e) {
      this.cb.log(`pc close failed: ${describeError(e)}`);
    }
    this.pc = null;
    this.signaling?.close();
    this.signaling = null;
    this.cb.remoteStream(null);
    this.cb.status(`stopped (${reason})`);
    this.cb.log(`stopped: ${reason}`);
    this.cb.ended(reason);
  }

  /** Test hook for trap "stop() semantics": the naive stop. Leaves capture, MediaProjection and the FGS alive. */
  stopTracksOnlyForTest(): void {
    this.local?.getTracks().forEach((t) => t.stop());
    this.cb.log('naive stop: track.stop() only (nothing released)');
  }

  // ---- sharer: capture --------------------------------------------------------------------

  private async startCapture(): Promise<void> {
    if (Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33) {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      this.cb.log(`POST_NOTIFICATIONS: ${result}`);
    }
    this.cb.status('waiting for capture consent');
    // getDisplayMedia shows the system consent dialog, THEN the library starts its mediaProjection
    // foreground service, THEN creates the MediaProjection (see docs/SPIKE_FINDINGS.md, T1).
    const stream = await mediaDevices.getDisplayMedia({
      android: { createConfigForDefaultDisplay: this.cfg.entireScreenOnly },
    });
    if (this.done) {
      stream.release();
      return;
    }
    this.local = stream;
    const track = stream.getVideoTracks()[0];
    if (track === undefined) {
      throw new Error('getDisplayMedia returned no video track');
    }
    const s = track.getSettings();
    this.cb.log(`capture started ${s.width ?? '?'}x${s.height ?? '?'}@${s.frameRate ?? '?'}`);
    track.addEventListener('ended', () => {
      this.cb.log('capture track ended (revoked by the system or the user)');
      this.stop('capture-ended');
    });
  }

  // ---- signaling -------------------------------------------------------------------------

  private onSignalingState(s: SignalingState): void {
    this.signalingOpen = s === 'open';
    this.cb.log(`signaling: ${s}`);
    if (s === 'reconnecting') {
      this.peers = 0; // unknown until we have re-joined and the relay tells us
    }
    if (s === 'open') {
      this.cb.status('signaling open, waiting for the other phone');
    }
  }

  private async onSignal(m: SignalMessage): Promise<void> {
    try {
      switch (m.type) {
        case 'peers':
          this.peers = m.count;
          this.cb.log(`peers: ${m.count}`);
          this.maybeOffer();
          break;
        case 'peer-left':
          this.peers = Math.max(0, this.peers - 1);
          this.cb.log('other phone left the room');
          break;
        case 'full':
          this.cb.log('room is full');
          this.stop('room-full');
          break;
        case 'offer':
          if (this.role === 'viewer') {
            await this.onOffer(m.sdp);
          }
          break;
        case 'answer':
          if (this.role === 'sharer') {
            await this.onAnswer(m.sdp);
          }
          break;
        case 'ice':
          await this.onRemoteCandidate(m.candidate);
          break;
      }
    } catch (e) {
      this.cb.log(`handling ${m.type} failed: ${describeError(e)}`);
    }
  }

  // ---- peer connection -------------------------------------------------------------------

  private async createPc(): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(this.cfg),
      iceTransportPolicy: this.cfg.relayOnly ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;

    pc.addEventListener('icecandidate', (e) => {
      const c = e.candidate;
      if (c) {
        this.signaling?.send({
          type: 'ice',
          candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null },
        });
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => this.onIceState(pc));
    pc.addEventListener('connectionstatechange', () => this.cb.log(`pc: ${pc.connectionState}`));
    pc.addEventListener('track', (e) => {
      this.cb.log(`track received (${e.track?.kind ?? 'unknown'})`);
      const stream = e.streams[0] ?? (e.track ? new MediaStream([e.track]) : null);
      if (stream !== null) {
        this.cb.remoteStream(stream);
      }
    });

    if (this.role === 'sharer' && this.local !== null) {
      // Tracks must be added BEFORE createOffer, otherwise the offer has no video m-line (trap T5).
      for (const t of this.local.getTracks()) {
        pc.addTrack(t, this.local);
      }
      await this.tuneSender(pc);
    }
    return pc;
  }

  private async tuneSender(pc: RTCPeerConnection): Promise<void> {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender === undefined) {
      this.cb.log('no video sender to tune');
      return;
    }
    try {
      const params = sender.getParameters();
      params.degradationPreference = 'maintain-resolution';
      const enc = params.encodings[0];
      if (enc !== undefined) {
        if (this.cfg.maxBitrateKbps !== null) {
          enc.maxBitrate = this.cfg.maxBitrateKbps * 1000;
        }
        if (this.cfg.maxFps !== null) {
          enc.maxFramerate = this.cfg.maxFps;
        }
      }
      await sender.setParameters(params);
      this.cb.log(`sender tuned: degradation=${sender.getParameters().degradationPreference ?? 'unset'}`);
    } catch (e) {
      this.cb.log(`sender tuning failed: ${describeError(e)}`);
    }
  }

  private onIceState(pc: RTCPeerConnection): void {
    const s = pc.iceConnectionState;
    this.cb.log(`ice: ${s}`);
    this.cb.status(`ice ${s}`);
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (s === 'connected' || s === 'completed') {
      if (this.lostAt !== null) {
        this.cb.log(`recovered after ${Date.now() - this.lostAt} ms`);
        this.lostAt = null;
      }
      return;
    }
    if (s === 'disconnected' || s === 'failed') {
      this.lostAt ??= Date.now();
      if (this.role === 'sharer') {
        this.restartTimer = setTimeout(
          () => {
            const state = pc.iceConnectionState;
            if (this.done || this.pc !== pc || state === 'connected' || state === 'completed') {
              return;
            }
            this.cb.log('ICE restart needed');
            this.owesOffer = true;
            this.maybeOffer();
          },
          s === 'failed' ? 0 : DISCONNECT_GRACE_MS,
        );
      }
    }
  }

  // ---- negotiation -----------------------------------------------------------------------

  private maybeOffer(): void {
    if (this.role !== 'sharer' || this.done || !this.signalingOpen || this.peers < 2 || this.local === null) {
      return;
    }
    if (this.pc === null) {
      detach(this.makeOffer(false));
    } else if (this.owesOffer) {
      detach(this.makeOffer(true));
    }
  }

  private async makeOffer(iceRestart: boolean): Promise<void> {
    if (this.negotiating) {
      return; // duplicate 'peers' message while an offer is in flight
    }
    this.negotiating = true;
    this.owesOffer = false;
    try {
      const pc = this.pc ?? (await this.createPc());
      const offer = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(offer);
      const sdp = pc.localDescription?.sdp;
      if (sdp) {
        this.signaling?.send({ type: 'offer', sdp });
      }
      this.cb.log(iceRestart ? 'offer sent (ICE restart)' : 'offer sent');
      this.cb.status('negotiating');
    } catch (e) {
      this.cb.log(`offer failed: ${describeError(e)}`);
    } finally {
      this.negotiating = false;
    }
  }

  private async onOffer(sdp: string): Promise<void> {
    const pc = this.pc ?? (await this.createPc());
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    await this.flushRemoteCandidates(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const out = pc.localDescription?.sdp;
    if (out) {
      this.signaling?.send({ type: 'answer', sdp: out });
    }
    this.cb.log('answer sent');
    this.cb.status('negotiating');
  }

  private async onAnswer(sdp: string): Promise<void> {
    const pc = this.pc;
    if (pc === null) {
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    await this.flushRemoteCandidates(pc);
    this.cb.log('answer applied');
  }

  private async onRemoteCandidate(c: IceCandidateInit): Promise<void> {
    const pc = this.pc;
    if (pc === null || pc.remoteDescription === null) {
      this.pendingRemoteCandidates.push(c); // arrived before the offer/answer: hold until it is applied
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(c));
  }

  private async flushRemoteCandidates(pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingRemoteCandidates;
    this.pendingRemoteCandidates = [];
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    }
  }

  // ---- evidence --------------------------------------------------------------------------

  private async pollStats(): Promise<void> {
    const pc = this.pc;
    if (pc === null || this.done) {
      return;
    }
    try {
      const report = (await pc.getStats()) as unknown as Map<unknown, unknown>;
      const sample = parseStats(report, this.role, this.bytes, this.frames, Date.now());
      this.cb.stats(formatSample(sample));
    } catch (e) {
      this.cb.stats(`stats error: ${describeError(e)}`);
    }
  }
}
