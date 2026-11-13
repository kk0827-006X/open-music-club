import { approach } from './motion';
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
export type MusicBands = {
  low: number;
  mid: number;
  high: number;
  activity: number;
  spectrum?: Float32Array;
};
export const quietBands = (): MusicBands => ({ low: 0, mid: 0, high: 0, activity: 0 });
export function musicDisplacement(
  row: number,
  lane: number,
  time: number,
  bands: MusicBands,
  strength: number,
) {
  const bass = bands.low * 0.8 * (0.5 + 0.5 * Math.sin(row * 0.29 - lane * 0.5 - time * 2.7));
  const middle = bands.mid * 0.48 * (0.5 + 0.5 * Math.sin(row * 0.72 + lane * 0.9 - time * 4.3));
  const treble =
    bands.high * 0.18 * Math.pow(Math.max(0, Math.sin(row * 1.7 - lane * 2.2 - time * 6.4)), 4);
  return clamp((bass + middle + treble) * clamp(strength, 0, 2), 0, 1.8);
}

export type RhythmStyle = 'legacy' | 'wave' | 'lift';
export type RhythmFrame = { style: Record<RhythmStyle, number> };
/** Crossfade styles without a beat gate: sustained notes remain visible. */
export class RhythmMotion {
  private weights = { legacy: 1, wave: 0, lift: 0 };
  update(_bands: MusicBands, _time: number, dt: number, style: RhythmStyle): RhythmFrame {
    for (const key of ['legacy', 'wave', 'lift'] as const)
      this.weights[key] +=
        ((style === key ? 1 : 0) - this.weights[key]) * (1 - Math.exp(-clamp(dt, 0, 0.1) * 5));
    return { style: { ...this.weights } };
  }
}
/** x is the card's projected horizontal position, left=0, right=1. */
export function rhythmDisplacement(
  row: number,
  lane: number,
  time: number,
  bands: MusicBands,
  strength: number,
  frame: RhythmFrame,
  x = 0.5,
) {
  x = clamp(x);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const right = smooth(clamp((x - 0.5) * 2));
  const left = 1 - smooth(clamp(x * 2));
  const middle = 1 - left - right;
  const spectrum = bands.low * left + bands.mid * middle + bands.high * right;
  // A: broad, screen-aligned spectrum ridges, continuous across band boundaries.
  const wave = spectrum * (0.72 + 0.28 * Math.sin(row * 0.32 - time * 2.2)) * 0.95;
  // B: layered travelling currents; vocals and sustained treble also carry motion.
  const flow =
    bands.low * 0.62 * (0.55 + 0.45 * Math.sin(row * 0.22 + lane * 0.18 - time * 1.8)) +
    bands.mid * 0.42 * (0.55 + 0.45 * Math.sin(row * 0.38 - lane * 0.27 - time * 2.8)) +
    bands.high * 0.28 * (0.55 + 0.45 * Math.sin(row * 0.62 + lane * 0.4 - time * 4.1));
  return (
    musicDisplacement(row, lane, time, bands, strength) * frame.style.legacy +
    (frame.style.wave * wave + frame.style.lift * flow) * clamp(strength, 0, 2)
  );
}

export const AUDIO_SPECTRUM_SIZE = 32;
export const AUDIO_MAX_LIFT = 1.9;

// 镜像往返频谱映射没有取模接缝；相邻行频率相近，各列错开六个频段。
export function archiveSpectrumPosition(row: number, lane: number) {
  const span = AUDIO_SPECTRUM_SIZE - 1;
  const phase = (((row + lane * 6) % (span * 2)) + span * 2) % (span * 2);
  return span - Math.abs(phase - span);
}

// 保留既有高度场入口；音乐自己形成波峰，不再叠加自动播放的正弦波。
export function audioWave(row: number, lane: number, _time: number, bands: MusicBands) {
  const spectrum = bands.spectrum;
  if (!spectrum || spectrum.length !== AUDIO_SPECTRUM_SIZE) return 0;
  const sample = (position: number) => {
    const x = clamp(position, 0, spectrum.length - 1);
    const i = Math.floor(x),
      fraction = x - i;
    return spectrum[i] * (1 - fraction) + spectrum[Math.min(i + 1, spectrum.length - 1)] * fraction;
  };
  const position = archiveSpectrumPosition(row, lane);
  // 80% 自身频段，20% 邻域；连续插值同时用于档案高度和坡度采样。
  const energy = clamp(
    0.8 * sample(position) + 0.1 * sample(position - 1) + 0.1 * sample(position + 1),
  );
  return AUDIO_MAX_LIFT * (1 - Math.exp(-3 * energy));
}

export function interactionGain(value: number, dragging: boolean, detail: boolean, dt: number) {
  const target = detail ? 0 : dragging ? 0.2 : 1;
  return approach(value, target, target < value ? 14 : 4, Math.min(0.05, dt));
}
