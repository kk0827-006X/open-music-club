import { useEffect, useState } from 'react';
import { MusicQueue } from '../../features/queue/model.ts';
import {
  createPlayerController,
  type PlayerController,
} from '../../features/player/player-core.ts';
import { resolvePlaybackUrl } from '../../services/music/search.ts';
import { createFootprintClient, durationToMs } from '../../services/music/footprint.ts';

// Audio 与在途足迹属于认证后的会话，普通切页不会重建。
export function usePlaybackSession() {
  const [session, setSession] = useState<{
    queue: MusicQueue;
    player: PlayerController;
    footprintClient: ReturnType<typeof createFootprintClient>;
  } | null>(null);
  const [footprintRevision, setFootprintRevision] = useState(0);
  useEffect(() => {
    const queue = new MusicQueue();
    const footprintClient = createFootprintClient();
    const reports = new Set<AbortController>();
    let disposed = false;
    const player = createPlayerController({
      queue,
      resolveUrl: (track, signal) => resolvePlaybackUrl(track, undefined, signal),
      onPlayed: async (track) => {
        if (disposed || track.kind !== 'song') return;
        const controller = new AbortController();
        reports.add(controller);
        try {
          await footprintClient.report(
            { ...track, durationMs: durationToMs(track.duration) },
            controller.signal,
          );
          if (!disposed) setFootprintRevision((value) => value + 1);
        } finally {
          reports.delete(controller);
        }
      },
    });
    setSession({ queue, player, footprintClient });
    return () => {
      disposed = true;
      reports.forEach((controller) => controller.abort());
      reports.clear();
      player.destroy();
    };
  }, []);
  return { session, footprintRevision };
}
