const assert = require('node:assert/strict');
const { it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');
const response = (body) => ({ ok: true, status: 200, json: async () => body });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const song = (id, source = 'local') => ({
  key: `${source}:${id}`,
  source,
  sourceId: String(id),
  kind: 'song',
  title: `歌曲${id}`,
  artist: '隔离歌手',
  album: '隔离专辑',
  duration: '1:02',
  coverUrl: '/images/album-placeholder-01.svg',
});

async function withSession(run, fetch) {
  await withReactHarness(
    async (h) => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
      const audios = [];
      class FakeAudio extends h.window.EventTarget {
        paused = true;
        volume = 0.62;
        currentTime = 0;
        duration = 62;
        src = '';
        loads = 0;
        plays = 0;
        constructor() {
          super();
          audios.push(this);
        }
        async play() {
          this.plays++;
          this.paused = false;
          this.dispatchEvent(new Event('play'));
        }
        pause() {
          this.paused = true;
        }
        removeAttribute() {
          this.src = '';
        }
        load() {
          this.loads++;
        }
      }
      Object.defineProperty(globalThis, 'Audio', {
        configurable: true,
        writable: true,
        value: FakeAudio,
      });
      try {
        const { usePlaybackSession } =
          await import('../frontend/src/app/hooks/use-playback-session.ts');
        let state;
        function Probe() {
          state = usePlaybackSession();
          return null;
        }
        const render = (strict = false) =>
          h.render(
            strict
              ? h.React.createElement(h.React.StrictMode, null, h.React.createElement(Probe))
              : h.React.createElement(Probe),
          );
        await run(h, {
          render,
          audios,
          get state() {
            return state;
          },
        });
      } finally {
        await h.unmount();
        if (original) Object.defineProperty(globalThis, 'Audio', original);
        else delete globalThis.Audio;
      }
    },
    { fetch },
  );
}

it('播放会话普通重渲染保留同一队列、客户端和 Audio，成功足迹才推进版本', async () => {
  const reports = [];
  await withSession(
    async (h, ctx) => {
      await ctx.render();
      const first = ctx.state.session;
      await ctx.render();
      assert.equal(ctx.state.session, first);
      assert.equal(ctx.audios.length, 1);
      assert.equal(ctx.state.footprintRevision, 0);
      await h.React.act(async () => first.player.play(song(1)));
      await h.flush();
      assert.equal(ctx.state.footprintRevision, 1);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].durationMs, 62000);
      await h.React.act(async () => {
        await first.player.toggle();
        await first.player.toggle();
      });
      assert.equal(reports.length, 1);
      await h.unmount();
      assert.equal(ctx.audios[0].loads, 1);
      assert.equal(ctx.audios[0].paused, true);
      assert.equal(ctx.audios[0].src, '');
    },
    async (url, init) => {
      if (url === '/api/security/csrf-token') return response({ csrfToken: 'isolated-csrf' });
      assert.equal(url, '/api/footprint/events');
      assert.equal(init.headers['X-CSRF-Token'], 'isolated-csrf');
      reports.push(JSON.parse(init.body));
      return response({ eventId: 1 });
    },
  );
});

it('播放会话卸载中止全部在途足迹，迟到响应不污染新会话版本', async () => {
  const pending = [];
  await withSession(
    async (h, ctx) => {
      await ctx.render(true);
      assert.equal(ctx.audios.length, 2);
      assert.equal(ctx.audios[0].loads, 1, 'StrictMode 的旧 Audio 应清理');
      const old = ctx.state.session;
      await h.React.act(async () => old.player.play(song(1)));
      await h.React.act(async () => old.player.play(song(2)));
      await h.until(() => pending.length === 2, '两次开播都应发起足迹请求');
      await h.render(null);
      assert.ok(pending.every((item) => item.signal.aborted));
      assert.equal(ctx.audios[1].loads, 1);
      await ctx.render();
      const next = ctx.state.session;
      assert.notEqual(next.player, old.player);
      assert.notEqual(next.queue, old.queue);
      assert.notEqual(next.footprintClient, old.footprintClient);
      assert.equal(ctx.state.footprintRevision, 0);
      await h.React.act(async () =>
        pending.forEach((item) => item.resolve(response({ eventId: 1 }))),
      );
      await h.flush();
      assert.equal(ctx.state.footprintRevision, 0);
      await h.React.act(async () => old.player.play(song(3)));
      assert.equal(pending.length, 2);
      assert.equal(ctx.audios[1].loads, 1, '旧播放器销毁保持幂等');
    },
    (url, init) => {
      if (url === '/api/security/csrf-token')
        return Promise.resolve(response({ csrfToken: 'isolated-csrf' }));
      assert.equal(url, '/api/footprint/events');
      const request = deferred();
      pending.push({ ...request, signal: init.signal });
      return request.promise;
    },
  );
});

it('退出时取消在途网易云取址，迟到播放地址不能启动旧 Audio 或记录足迹', async () => {
  const pending = deferred();
  let signal;
  let reports = 0;
  await withSession(
    async (h, ctx) => {
      await ctx.render();
      let playing;
      await h.React.act(async () => {
        playing = ctx.state.session.player.play(song(1, 'netease'));
      });
      await h.until(() => signal, '应开始网易云取址');
      await h.unmount();
      assert.equal(signal.aborted, true);
      await h.React.act(async () => {
        pending.resolve(
          response({ code: 200, data: [{ url: 'https://e2e.music.126.net/isolated.wav' }] }),
        );
        await playing;
      });
      assert.equal(ctx.audios[0].plays, 0);
      assert.equal(ctx.audios[0].loads, 1);
      assert.equal(reports, 0);
    },
    (url, init) => {
      if (url.startsWith('/api/netease/song/url/v1')) {
        signal = init.signal;
        return pending.promise;
      }
      reports++;
      return Promise.resolve(response({}));
    },
  );
});
