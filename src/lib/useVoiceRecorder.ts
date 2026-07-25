import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { downsampleWaveform, meteringToLevel, MAX_VOICE_NOTE_MS, MIN_VOICE_NOTE_MS, WAVEFORM_BARS } from './audioWaveform';

/**
 * Recording a voice note, cross-platform. expo-audio handles the actual
 * capture and encoding on every platform (one library, one code path for the
 * risky part); everything here layers real amplitude sampling on top, since
 * the sent bubble needs a genuine waveform, not a decorative one.
 *
 * - Native (iOS/Android): expo-audio's own metering (isMeteringEnabled) is
 *   polled via useAudioRecorderState, which is the library's documented way
 *   to get live dBFS.
 * - Web: expo-audio implements NO metering at all (confirmed by reading its
 *   web source; RecorderState.metering is simply never set there), so a
 *   small AnalyserNode is run alongside the recorder purely to sample levels.
 *   It REUSES the exact MediaStream expo-audio's own recorder already opened
 *   (reached via its internal `mediaRecorder.stream`, a private field but a
 *   standard MediaRecorder property once you have the instance) rather than
 *   opening a second one. This used to be a real bug: a fresh getUserMedia
 *   call here, ON TOP OF expo-audio's own and an explicit permission
 *   pre-check in start(), meant every single recording fired three separate
 *   mic-access requests, which is likely why some browsers/PWA contexts kept
 *   re-showing "wants to access your microphone" instead of remembering the
 *   grant. Falls back to opening its own stream only if the reach-around ever
 *   comes back empty (a future expo-audio version, say); if even THAT fails
 *   the recording itself is unaffected, only the waveform ends up flatter.
 *
 * Format at the RECORDING step: expo-audio's HIGH_QUALITY preset defaults to
 * audio/webm on every web browser, including Safari, whose own MediaRecorder
 * cannot actually produce webm; passing that unsupported mimeType to `new
 * MediaRecorder(...)` throws at construction time, before recording even
 * starts. pickWebMime() asks MediaRecorder.isTypeSupported() and picks
 * whatever the CURRENT browser can actually encode (audio/mp4 on Safari,
 * audio/webm elsewhere), purely so recording succeeds everywhere.
 *
 * This is NOT what makes playback cross-platform, though: that guarantee
 * lives entirely on the SERVER. Every clip, whatever format it was recorded
 * in (native m4a, Safari's mp4, Chrome/Firefox's webm), is normalized by
 * `transcodeToAac` (`api/_lib/transcode.ts`, real ffmpeg via `ffmpeg-static`)
 * into one canonical AAC/.m4a before it is ever stored, so a clip recorded on
 * Android Chrome plays back on a partner's iPhone the same as everything
 * else does. See CLAUDE.md's Chat > Voice notes bullet.
 */

export interface VoiceRecording {
  /** A local file:// (native) or blob: (web) URI; the caller reads it into a payload. */
  uri: string;
  mime: string;
  durationMs: number;
  /** Real sampled levels, 0..1, already downsampled to WAVEFORM_BARS. */
  waveform: number[];
}

function pickWebMime(): string {
  const g: any = globalThis as any;
  if (typeof g.MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  for (const type of candidates) {
    try {
      if (g.MediaRecorder.isTypeSupported?.(type)) return type;
    } catch {
      // keep trying the next candidate
    }
  }
  return 'audio/webm';
}

function recordingOptions(webMime: string): RecordingOptions {
  return {
    ...RecordingPresets.HIGH_QUALITY,
    // A voice note is speech, not music: mono at a modest bitrate keeps a
    // 3-minute clip well under a megabyte, the same order of magnitude as
    // the app's own compressed photos.
    numberOfChannels: 1,
    bitRate: 64_000,
    isMeteringEnabled: true,
    web: { mimeType: webMime, bitsPerSecond: 64_000 },
  };
}

export function useVoiceRecorder() {
  const webMime = useRef(Platform.OS === 'web' ? pickWebMime() : 'audio/mp4').current;
  const recorder = useAudioRecorder(recordingOptions(webMime));
  const state = useAudioRecorderState(recorder, 120);

  const startedAtRef = useRef(0);
  const samplesRef = useRef<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  // Native: sample the recorder's own metering on every status tick.
  useEffect(() => {
    if (Platform.OS === 'web' || !state.isRecording) return;
    const lvl = meteringToLevel(state.metering);
    samplesRef.current.push(lvl);
    setLevel(lvl);
    setElapsedMs(Date.now() - startedAtRef.current);
  }, [state.isRecording, state.metering]);

  // Web: expo-audio reports no metering, so run our own analyser purely for
  // level sampling, reusing the recorder's OWN stream (see the module doc
  // comment for why: opening a second getUserMedia stream here used to mean
  // three separate mic-access requests per recording). Best-effort: any
  // failure here just leaves the waveform flatter, it never blocks or
  // breaks the actual recording.
  const recordingFlag = Platform.OS === 'web' && state.isRecording;
  useEffect(() => {
    if (!recordingFlag) return;
    let rafId = 0;
    let cancelled = false;
    let ownedStream: MediaStream | null = null; // only set if WE opened a fallback stream
    let ctx: any = null;

    (async () => {
      try {
        const reused: MediaStream | undefined = (recorder as any)?.mediaRecorder?.stream;
        let stream: MediaStream | null = reused ?? null;
        if (!stream) {
          const nav: any = (globalThis as any).navigator;
          stream = await nav.mediaDevices.getUserMedia({ audio: true });
          ownedStream = stream;
        }
        if (cancelled || !stream) {
          ownedStream?.getTracks().forEach((t) => t.stop());
          return;
        }
        const AudioCtx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
        ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / data.length);
          samplesRef.current.push(Math.max(0, Math.min(1, rms * 3)));
          setLevel((cur) => (cancelled ? cur : Math.max(0, Math.min(1, rms * 3))));
          setElapsedMs(Date.now() - startedAtRef.current);
          if (!cancelled) rafId = (globalThis as any).requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // No live meter available (permission race, unsupported browser);
        // the recording proceeds through expo-audio regardless.
      }
    })();

    return () => {
      cancelled = true;
      if (rafId) (globalThis as any).cancelAnimationFrame?.(rafId);
      // Only stop tracks WE opened (the fallback path): the reused stream
      // belongs to the recorder and must keep running until it stops itself.
      ownedStream?.getTracks().forEach((t) => t.stop());
      ctx?.close?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingFlag]);

  const start = useCallback(async (): Promise<boolean> => {
    // Native has a real permission-status API worth checking up front. On web
    // there is no separate check: expo-audio's own getUserMedia call below
    // IS the permission request, and a second explicit one first (as this
    // used to do) is a redundant mic-access round trip for no benefit, since
    // we would proceed to record() regardless of what it reported.
    if (Platform.OS !== 'web') {
      const perm = await requestRecordingPermissionsAsync().catch(() => null);
      if (!perm?.granted) return false;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
    samplesRef.current = [];
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setLevel(0);
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      return false; // permission denied, or no mic available
    }
    return true;
  }, [recorder]);

  /** Stops and returns the finished clip, or null if it was too short to bother with. */
  const finish = useCallback(async (): Promise<VoiceRecording | null> => {
    const durationMs = Date.now() - startedAtRef.current;
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const uri = recorder.uri;
    if (!uri || durationMs < MIN_VOICE_NOTE_MS) return null;
    const waveform = downsampleWaveform(samplesRef.current, WAVEFORM_BARS);
    return { uri, mime: webMime, durationMs: Math.min(durationMs, MAX_VOICE_NOTE_MS), waveform };
  }, [recorder, webMime]);

  const cancel = useCallback(async () => {
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, [recorder]);

  // A recording that hits the cap stops itself rather than growing unbounded.
  useEffect(() => {
    if (Platform.OS !== 'web' && state.isRecording && state.durationMillis >= MAX_VOICE_NOTE_MS) {
      recorder.stop().catch(() => {});
    }
  }, [state.isRecording, state.durationMillis, recorder]);

  return {
    start,
    finish,
    cancel,
    isRecording: state.isRecording,
    elapsedMs: Platform.OS === 'web' ? elapsedMs : state.durationMillis || elapsedMs,
    level,
  };
}
