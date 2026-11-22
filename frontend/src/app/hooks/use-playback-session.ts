import { useEffect, useState } from 'react';
import { MusicQueue } from '../../features/queue/model.ts';
import {
  createPlayerController,
  type PlayerController,
} from '../../features/player/player-core.ts';
import { resolvePlaybackUrl } from '../../services/music/search.ts';
import { createFootprintClient, durationToMs } from '../../services/music/footprint.ts';
import {
  createPersonalLibraryClient,
  toPersonalSong,
} from '../../services/music/personal-library.ts';

// Audio 与在途足迹属于认证后的会话，普通切页不会重建。
export function usePlaybackSession() {
  const [session, setSession] = useState<{
    queue: MusicQueue;
    player: PlayerController;
    footprintClient: ReturnType<typeof createFootprintClient>;
    personalLibrary: ReturnType<typeof createPersonalLibraryClient>;
    flushLastPlayed(): Promise<unknown>;
  } | null>(null);
  const [footprintRevision, setFootprintRevision] = useState(0);
  useEffect(() => {
    const queue = new MusicQueue();
    const footprintClient = createFootprintClient();
    const personalLibrary = createPersonalLibraryClient();
    const lifetime = new AbortController();
    const reports = new Set<AbortController>();
    let startedAt = 0;
    let lastSave: Promise<unknown> = Promise.resolve();
    const player = createPlayerController({
      queue,
      resolveUrl: (track, signal) => resolvePlaybackUrl(track, undefined, signal),
      onPlayed: async (track) => {
        if (lifetime.signal.aborted || track.kind !== 'song') return;
        // 本会话内即使两次开播落在同一毫秒，后端也能识别更新的曲目。
        startedAt = Math.max(Date.now(), startedAt + 1);
        lastSave = personalLibrary
          .saveLastPlayed(track, startedAt, lifetime.signal)
          .catch(() => undefined);
        const controller = new AbortController();
        reports.add(controller);
        try {
          await footprintClient.report(
            { ...track, durationMs: durationToMs(track.duration) },
            controller.signal,
          );
          if (!lifetime.signal.aborted) setFootprintRevision((value) => value + 1);
        } finally {
          reports.delete(controller);
        }
      },
    });
    void personalLibrary
      .lastPlayed(lifetime.signal)
      .then((track) => {
        if (track && !lifetime.signal.aborted) player.restoreTrack(toPersonalSong(track));
      })
      .catch(() => undefined);

    async function flushLastPlayed() {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        // 主动退出时为已发出的保存留出时间；网络异常不能阻止退出。
        await Promise.race([
          lastSave,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 1500);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }

    setSession({ queue, player, footprintClient, personalLibrary, flushLastPlayed });
    return () => {
      lifetime.abort();
      reports.forEach((controller) => controller.abort());
      reports.clear();
      player.destroy();
    };
  }, []);
  return { session, footprintRevision };
}
