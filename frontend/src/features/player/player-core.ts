import { createAudioAnalysis } from './audio-analysis';
import { createState } from '../../shared/state.ts';
import type { MusicItem } from '../../shared/music.ts';
import type { MusicQueue } from '../queue/model.ts';

export type PlayerState = Readonly<{
  track: MusicItem | null;
  restored: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  error: string | null;
}>;
export type PlayerController = ReturnType<typeof createPlayerController>;

// 认证后的应用会话创建一次；页面只使用动作和状态，不持有音频元素。
export function createPlayerController(options: {
  queue: MusicQueue;
  resolveUrl: (track: MusicItem, signal: AbortSignal) => Promise<string>;
  createAudio?: () => HTMLAudioElement;
  onPlayed?: (track: MusicItem) => void | Promise<void>;
}) {
  const audio = options.createAudio?.() ?? new Audio();
  audio.crossOrigin = 'anonymous';
  const analysis = createAudioAnalysis(audio);
  audio.preload = 'none';
  audio.volume = 0.62;
  let track: MusicItem | null = null,
    request = 0,
    disposed = false;
  let pending: AbortController | null = null;
  let error: string | null = null;
  let restored = false;
  let started = false;
  const snapshot = (): PlayerState => ({
    track,
    restored,
    paused: restored || audio.paused,
    currentTime: restored ? 0 : audio.currentTime,
    duration: restored ? NaN : audio.duration,
    volume: audio.volume,
    error,
  });
  const state = createState(snapshot());
  const update = () => {
    if (!disposed) state.set(snapshot());
  };
  const cancel = () => {
    request++;
    pending?.abort();
    pending = null;
  };
  async function startAudio(current: number, selected: MusicItem) {
    await audio.play();
    if (disposed || current !== request || track !== selected || started) return;
    started = true;
    try {
      // 只报告首次成功开播，记录失败不能中断音频。
      void Promise.resolve(options.onPlayed?.(selected)).catch(() => undefined);
    } catch {
      /* 附属记录不替代播放器自身的错误状态。 */
    }
  }
  async function play(next: MusicItem) {
    if (disposed) return;
    const preparation = analysis.prepare();
    // 立即接住恢复失败，避免等待取址时产生未处理的 Promise。
    const prepared = preparation.then(
      () => null,
      () => new Error('音频上下文无法恢复，请再次点击播放。'),
    );
    cancel();
    const current = request,
      controller = new AbortController();
    pending = controller;
    const url = await options.resolveUrl(next, controller.signal);
    if (disposed || current !== request) return;
    const preparationError = await prepared;
    if (disposed || current !== request) return;
    if (preparationError) throw preparationError;
    audio.pause();
    analysis.reset();
    audio.src = url;
    track = next;
    restored = false;
    started = false;
    error = null;
    update();
    await startAudio(current, next);
  }
  const next = async () => {
    const item = track && options.queue.next(track.key);
    if (item) await play(item);
  };
  const previous = async () => {
    const item = track && options.queue.previous(track.key);
    if (item) await play(item);
  };
  const ended = () => {
    update();
    void next().catch(() => undefined);
  };
  const failed = () => {
    audio.pause();
    error = '音频加载失败，请重新选择歌曲。';
    update();
  };
  const events = ['timeupdate', 'loadedmetadata', 'play', 'pause', 'volumechange'];
  events.forEach((event) => audio.addEventListener(event, update));
  audio.addEventListener('ended', ended);
  audio.addEventListener('error', failed);
  return {
    get: state.get,
    subscribe: state.subscribe,
    restoreTrack(next: MusicItem) {
      // 迟到的历史曲目不能覆盖已经提交的播放或清空操作。
      if (disposed || request !== 0 || track) return;
      track = next;
      restored = true;
      update();
    },
    play,
    next,
    previous,
    readAudioBands: analysis.read,
    resetAudioBands: analysis.reset,
    async toggle() {
      if (disposed || !track) return;
      if (restored) return play(track);
      if (audio.paused) {
        const current = request;
        await analysis.prepare();
        if (!disposed && track && current === request) await startAudio(current, track);
      } else audio.pause();
    },
    setVolume(volume: number) {
      if (!disposed) {
        audio.volume = volume;
        update();
      }
    },
    seek(fraction: number) {
      if (!disposed && track && !restored && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, Math.max(0, fraction * audio.duration));
        update();
      }
    },
    clear() {
      if (disposed) return;
      cancel();
      audio.pause();
      analysis.reset();
      audio.removeAttribute('src');
      track = null;
      restored = false;
      started = false;
      error = null;
      update();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      cancel();
      events.forEach((event) => audio.removeEventListener(event, update));
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', failed);
      state.destroy();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      analysis.destroy();
    },
  };
}
