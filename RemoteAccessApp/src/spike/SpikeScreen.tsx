// SPIKE-ONLY (Milestone 1). THROWAWAY: deleted after the M1 report. No design system, on purpose.
// Nothing typed here is persisted: TURN credentials and tunnel URLs live in React state only.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import type { MediaStream } from 'react-native-webrtc';
import { describeError, redact } from './redact';
import { detach } from './util';
import { SpikeSession } from './session';
import { connectSignaling, createMemorySignalingPair } from './signaling';
import type { Role, SessionCallbacks, SpikeConfig } from './types';

type Mode = Role | 'loopback';

type Probe = {
  startServiceBeforeConsent(): Promise<string>;
  setSecure(enabled: boolean): Promise<boolean>;
};
const probe = NativeModules.SpikeProbe as Probe | undefined;

// Evidence for T3 (New Architecture interop): mirror JS console.warn/error to logcat, redacted, then
// pass through so LogBox still sees them. Installed once when this module first loads.
for (const level of ['warn', 'error'] as const) {
  const original = console[level];
  console[level] = (...args: unknown[]) => {
    console.log(`[spike-${level}] ${redact(args.map((a) => String(a)).join(' '))}`);
    original(...args);
  };
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2'];

function validateSignalingUrl(url: string): string | null {
  const m = /^(wss?):\/\/([^/:?#]+)/i.exec(url.trim());
  if (m === null) {
    return 'Signaling URL must start with wss:// (ws:// is accepted for localhost only).';
  }
  if (m[1].toLowerCase() === 'ws' && !LOCAL_HOSTS.includes(m[2].toLowerCase())) {
    return 'Cleartext ws:// is only allowed for localhost / 10.0.2.2. Use the wss:// tunnel URL.';
  }
  return null;
}

const positiveInt = (s: string): number | null => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const clock = () => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

type Props = { onClose: () => void };

export default function SpikeScreen({ onClose }: Props) {
  const insets = useSafeAreaInsets();

  // Setup form. Defaults are for local loopback tests only (adb reverse); real runs overwrite them.
  const [signalingUrl, setSignalingUrl] = useState('ws://localhost:8080');
  const [room, setRoom] = useState('spike-local');
  const [turnUrls, setTurnUrls] = useState('');
  const [turnUser, setTurnUser] = useState('');
  const [turnCredential, setTurnCredential] = useState('');
  const [relayOnly, setRelayOnly] = useState(false);
  const [entireScreenOnly, setEntireScreenOnly] = useState(false);
  const [maxBitrate, setMaxBitrate] = useState('');
  const [maxFps, setMaxFps] = useState('');

  // Run state.
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [mode, setMode] = useState<Mode>('viewer');
  const [status, setStatus] = useState('idle');
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<{ sharer?: string; viewer?: string }>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [secure, setSecure] = useState(false);
  const [probeResult, setProbeResult] = useState('');
  const sessions = useRef<SpikeSession[]>([]);

  const addLog = useCallback((tag: string, text: string) => {
    // Call sites pass fixed strings / numbers only (see session.ts). Safe for logcat.
    console.log(`[spike] ${tag}: ${text}`);
    setLogs((prev) => [...prev.slice(-80), `${clock()} ${tag}: ${text}`]);
  }, []);

  useEffect(
    () => () => {
      sessions.current.forEach((s) => s.stop('screen-closed'));
    },
    [],
  );

  const stopAll = useCallback(
    (reason: string) => {
      sessions.current.forEach((s) => s.stop(reason));
      setFinished(true);
    },
    [],
  );

  const begin = (m: Mode) => {
    const urlError = m === 'loopback' ? null : validateSignalingUrl(signalingUrl);
    if (urlError !== null) {
      setStatus(urlError);
      return;
    }
    const cfg: SpikeConfig = {
      signalingUrl: signalingUrl.trim(),
      room: room.trim(),
      turnUrls: turnUrls.trim(),
      turnUser,
      turnCredential,
      relayOnly,
      entireScreenOnly,
      maxBitrateKbps: positiveInt(maxBitrate),
      maxFps: positiveInt(maxFps),
    };
    setMode(m);
    setRunning(true);
    setFinished(false);
    setLogs([]);
    setStats({});
    setRemote(null);
    setStatus('starting');

    const callbacks = (role: Role): SessionCallbacks => ({
      log: (t) => addLog(role, t),
      status: (t) => setStatus(`${role}: ${t}`),
      remoteStream: (s) => setRemote(s as MediaStream | null),
      stats: (t) => {
        console.log(`[spike] stats ${t}`);
        setStats((prev) => ({ ...prev, [role]: t }));
      },
      ended: (reason) => {
        if (m === 'loopback') {
          sessions.current.forEach((s) => s.stop(`loopback-${reason}`));
        }
        setFinished(true);
      },
    });

    if (m === 'loopback') {
      const [forSharer, forViewer] = createMemorySignalingPair();
      sessions.current = [
        new SpikeSession('viewer', cfg, callbacks('viewer'), forViewer),
        new SpikeSession('sharer', cfg, callbacks('sharer'), forSharer),
      ];
    } else {
      sessions.current = [
        new SpikeSession(m, cfg, callbacks(m), (handlers) => connectSignaling(cfg.signalingUrl, cfg.room, handlers)),
      ];
    }
    sessions.current.forEach((s) => detach(s.start()));
  };

  const backToSetup = () => {
    sessions.current = [];
    setRunning(false);
    setFinished(false);
    setRemote(null);
    setSecure(false);
    detach(Promise.resolve(probe?.setSecure(false)));
  };

  const toggleSecure = async () => {
    try {
      const next = !secure;
      await probe?.setSecure(next);
      setSecure(next);
      addLog('probe', `FLAG_SECURE ${next ? 'ON' : 'off'}`);
    } catch (e) {
      addLog('probe', `setSecure failed: ${describeError(e)}`);
    }
  };

  const runFgsBeforeConsent = async () => {
    setProbeResult('running...');
    try {
      const r = (await probe?.startServiceBeforeConsent()) ?? 'probe module missing';
      setProbeResult(r);
      console.log(`[spike] probe startServiceBeforeConsent -> ${r}`);
    } catch (e) {
      setProbeResult(describeError(e));
    }
  };

  const showsVideo = mode === 'viewer' || mode === 'loopback';
  const topPad = { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 };

  if (running) {
    return (
      <View style={[styles.root, topPad]}>
        <Text style={styles.status} testID="spike-status" accessibilityLabel="spike status">
          {status}
        </Text>
        {showsVideo ? (
          <View style={styles.videoBox}>
            {remote !== null ? (
              <RTCView
                style={styles.video}
                objectFit="contain"
                streamURL={remote.toURL()}
                onDimensionsChange={(e) =>
                  addLog('view', `video size ${e.nativeEvent.width}x${e.nativeEvent.height}`)
                }
              />
            ) : (
              <Text style={styles.dim}>no remote stream yet</Text>
            )}
          </View>
        ) : (
          <View style={styles.videoBox}>
            <Text style={styles.dim}>
              Sharing. Switch to the app you want to show; the other phone sees it. Come back here to stop.
            </Text>
          </View>
        )}
        {stats.viewer !== undefined && <Text style={styles.mono} testID="spike-stats-viewer">{stats.viewer}</Text>}
        {stats.sharer !== undefined && <Text style={styles.mono} testID="spike-stats-sharer">{stats.sharer}</Text>}
        <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
          {logs.slice(-14).map((l, i) => (
            <Text key={`${i}-${l}`} style={styles.logLine}>
              {l}
            </Text>
          ))}
        </ScrollView>
        <View style={styles.row}>
          {finished ? (
            <Btn label="Back to setup" id="spike-back" onPress={backToSetup} />
          ) : (
            <Btn label="Stop" id="spike-stop" onPress={() => stopAll('user')} danger />
          )}
          <Btn label={secure ? 'Secure: ON' : 'Secure: off'} id="spike-secure" onPress={() => detach(toggleSecure())} />
          {!finished && mode !== 'viewer' && (
            <Btn
              label="Naive stop"
              id="spike-naive-stop"
              onPress={() => sessions.current.forEach((s) => s.stopTracksOnlyForTest())}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.form, topPad]} keyboardShouldPersistTaps="handled">
      <View style={styles.row}>
        <Text style={styles.title}>SPIKE (dev only)</Text>
        <Btn label="Close" id="spike-close" onPress={onClose} />
      </View>
      <Text style={styles.warn}>
        Throwaway. Credentials and URLs are typed here, kept in memory only, never committed. Use a long random room
        name with a tunnel.
      </Text>
      <Text style={styles.status} testID="spike-status" accessibilityLabel="spike status">
        {status}
      </Text>

      <Field label="Signaling URL (wss://…)" id="spike-url" value={signalingUrl} onChangeText={setSignalingUrl} />
      <Field label="Room" id="spike-room" value={room} onChangeText={setRoom} />
      <Field label="TURN URL(s), comma separated" id="spike-turn-url" value={turnUrls} onChangeText={setTurnUrls} />
      <Field label="TURN username" id="spike-turn-user" value={turnUser} onChangeText={setTurnUser} />
      <Field
        label="TURN credential"
        id="spike-turn-cred"
        value={turnCredential}
        onChangeText={setTurnCredential}
        secure
      />
      <Field label="Max bitrate kbps (optional)" id="spike-bitrate" value={maxBitrate} onChangeText={setMaxBitrate} />
      <Field label="Max fps (optional)" id="spike-fps" value={maxFps} onChangeText={setMaxFps} />

      <View style={styles.switchRow}>
        <Text style={styles.label}>Relay only</Text>
        <Switch value={relayOnly} onValueChange={setRelayOnly} testID="spike-relay-only" />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.label}>Entire screen only (Android 14+)</Text>
        <Switch value={entireScreenOnly} onValueChange={setEntireScreenOnly} testID="spike-entire-screen" />
      </View>

      <View style={styles.row}>
        <Btn label="Share this screen" id="spike-share" onPress={() => begin('sharer')} primary />
        <Btn label="View" id="spike-view" onPress={() => begin('viewer')} primary />
      </View>
      <Btn label="Loopback self-test (one device)" id="spike-loopback" onPress={() => begin('loopback')} />

      <Text style={styles.section}>Trap probes</Text>
      <Btn label="T1: start FGS BEFORE consent" id="spike-probe-fgs" onPress={() => detach(runFgsBeforeConsent())} />
      {probeResult !== '' && <Text style={styles.mono}>{probeResult}</Text>}
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  id: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure === true}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        testID={props.id}
        accessibilityLabel={props.label}
        placeholderTextColor="#667"
      />
    </View>
  );
}

function Btn(props: { label: string; id: string; onPress: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      testID={props.id}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={[styles.btn, props.primary === true && styles.btnPrimary, props.danger === true && styles.btnDanger]}
    >
      <Text style={styles.btnText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0e14', paddingHorizontal: 12 },
  form: { paddingHorizontal: 0 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 },
  warn: { color: '#e5b567', fontSize: 12, marginVertical: 6 },
  status: { color: '#7fd6a2', fontSize: 14, fontWeight: '600', marginVertical: 4 },
  section: { color: '#9aa', fontSize: 13, marginTop: 16, marginBottom: 4 },
  field: { marginBottom: 8 },
  label: { color: '#cdd', fontSize: 12, marginBottom: 2 },
  input: { backgroundColor: '#161b26', color: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  row: { flexDirection: 'row', gap: 8, marginVertical: 6, alignItems: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 2 },
  btn: { backgroundColor: '#2a3142', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, marginVertical: 2 },
  btnPrimary: { backgroundColor: '#1f6feb' },
  btnDanger: { backgroundColor: '#b3261e' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  videoBox: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', minHeight: 200 },
  video: { width: '100%', height: '100%' },
  dim: { color: '#778', padding: 12, textAlign: 'center' },
  mono: { color: '#cfe', fontFamily: 'monospace', fontSize: 10, marginTop: 4 },
  log: { maxHeight: 110, marginTop: 4 },
  logContent: { paddingBottom: 4 },
  logLine: { color: '#8a93a6', fontFamily: 'monospace', fontSize: 9 },
});
