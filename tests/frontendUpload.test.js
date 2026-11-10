const { readFrontendSource } = require('./helpers/frontendSource');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { pathToFileURL } = require('node:url');
const { withReactHarness } = require('./helpers/reactHarness');

const root = path.resolve(__dirname, '..');
const frontendFile = (name) => path.join(root, 'frontend/src', name);

describe('本地音乐上传页 UI', () => {
  it('按照设计图提供文件拖放、Metadata、封面预览和固定 LOCAL 来源', async () => {
    await withReactHarness(async (h) => {
      const { UploadPage } = await import('../frontend/src/features/upload/UploadPage.tsx');
      await h.render(h.React.createElement(UploadPage, { active: true }));
      const page = h.require('[data-upload-page]');
      for (const name of ['dropzone', 'cover', 'title', 'artist', 'album', 'submit'])
        h.require(`[data-upload-${name}]`);
      assert.equal(h.require('[data-upload-file]').type, 'file');
      assert.match(page.textContent, /LOCAL/);
      assert.match(page.textContent, /MP3.*FLAC.*WAV.*M4A.*OGG/s);
      assert.match(page.textContent, /100 MB/);
    });
  });

  it('页面组件不直接构造网络请求，上传逻辑统一交给客户端适配层', () => {
    const component = fs.readFileSync(frontendFile('features/upload/UploadPage.tsx'), 'utf8');
    assert.doesNotMatch(component, /fetch\s*\(|XMLHttpRequest|\/api\/local\/music/);
    assert.match(component, /uploadMusicFile/);
    assert.match(component, /内嵌封面/);
  });

  it('获取 CSRF Token 后使用会话和 FormData 上传，不手工设置 multipart 边界', async () => {
    const { uploadMusicFile } = await import(
      pathToFileURL(frontendFile('services/music/upload.ts')).href
    );
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      return url === '/api/security/csrf-token'
        ? { ok: true, json: async () => ({ csrfToken: 'test-csrf' }) }
        : {
            ok: true,
            status: 201,
            json: async () => ({ success: true, track: { source: 'local', title: '海岸' } }),
          };
    };
    const file = new File(['audio'], '海岸.mp3', { type: 'audio/mpeg' });
    const track = await uploadMusicFile(
      file,
      { title: '海岸', artist: '测试歌手', album: '夜航' },
      fetcher,
    );
    assert.equal(track.title, '海岸');
    assert.equal(calls[0].url, '/api/security/csrf-token');
    assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(calls[1].url, '/api/local/music');
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.credentials, 'same-origin');
    assert.equal(calls[1].options.headers['X-CSRF-Token'], 'test-csrf');
    assert.equal(calls[1].options.headers['Content-Type'], undefined);
    assert.equal(calls[1].options.body.get('file').name, '海岸.mp3');
    assert.equal(calls[1].options.body.get('title'), '海岸');
    assert.equal(calls[1].options.body.get('artist'), '测试歌手');
    assert.equal(calls[1].options.body.get('album'), '夜航');
    assert.equal(calls[1].options.body.get('role'), null);
  });

  it('上传失败只显示安全提示，不透传服务器内部错误', async () => {
    const { uploadMusicFile } = await import(
      pathToFileURL(frontendFile('services/music/upload.ts')).href
    );
    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' });
    const failingFetch = async (url) =>
      url === '/api/security/csrf-token'
        ? { ok: true, json: async () => ({ csrfToken: 'test-csrf' }) }
        : {
            ok: false,
            status: 500,
            json: async () => ({ message: '/secret/storage/music/test.mp3' }),
          };
    await assert.rejects(
      uploadMusicFile(file, { title: '测试', artist: '歌手' }, failingFetch),
      (error) => {
        assert.equal(error.message, '上传暂时失败，请稍后重试。');
        assert.doesNotMatch(error.message, /storage|secret/);
        return true;
      },
    );
  });

  it('没有 CSRF Token 时不发送音频，超限时显示明确但安全的提示', async () => {
    const { uploadMusicFile } = await import(
      pathToFileURL(frontendFile('services/music/upload.ts')).href
    );
    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' });
    let calls = 0;
    await assert.rejects(
      uploadMusicFile(file, { title: '测试', artist: '歌手' }, async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => ({}) };
      }),
      /安全校验失败/,
    );
    assert.equal(calls, 1);

    await assert.rejects(
      uploadMusicFile(file, { title: '测试', artist: '歌手' }, async (url) =>
        url === '/api/security/csrf-token'
          ? { ok: true, json: async () => ({ csrfToken: 'csrf' }) }
          : { ok: false, status: 413, json: async () => ({ message: '内部文件路径' }) },
      ),
      /超过服务器允许的大小/,
    );
  });

  it('真实上传页挂载和卸载保持独立于全站播放器', async () => {
    const css = readFrontendSource(frontendFile('style.css'));
    assert.match(css, /\.upload-page\s*\{[^}]*opacity: 0[^}]*transition:\s*opacity/);
    assert.match(
      css,
      /\.album-archive\[data-view=['"]upload['"]\] \.upload-page\s*\{[^}]*opacity: 1/,
    );
    assert.match(css, /\.album-archive\[data-view=['"]upload['"]\] \.archive-brand/);
    await withReactHarness(async (h) => {
      const { UploadPage } = await import('../frontend/src/features/upload/UploadPage.tsx');
      await h.render(h.React.createElement(UploadPage, { active: true }));
      await h.flush();
      h.require('[data-upload-page]');
      assert.equal(h.query('[data-global-player]'), null);
      assert.equal(h.query('audio'), null);
      await h.unmount();
      assert.equal(h.require('#app').childElementCount, 0);
    });
  });

  it('上传页拒绝不支持的本地文件，并允许移除已选文件', async () => {
    await withReactHarness(async (h) => {
      const { UploadPage } = await import('../frontend/src/features/upload/UploadPage.tsx');
      await h.render(h.React.createElement(UploadPage, { active: true }));
      const fileInput = h.require('[data-upload-file]');
      const choose = async (name, content, type) => {
        Object.defineProperty(fileInput, 'files', {
          configurable: true,
          value: [new h.window.File([content], name, { type })],
        });
        await h.React.act(async () => {
          fileInput.dispatchEvent(new h.window.Event('change', { bubbles: true }));
        });
      };
      await choose('bad.txt', 'x', 'text/plain');
      assert.match(h.require('[data-upload-feedback]').textContent, /100 MB 以内/);
      assert.equal(h.require('[data-upload-submit]').disabled, true);
      await choose('test.wav', 'RIFF', 'audio/wav');
      await h.until(
        () => h.require('[data-upload-submit]').disabled === false,
        '元数据读取完成后应允许提交',
      );
      assert.equal(h.require('[data-upload-filename]').textContent, 'test.wav');
      await h.click('[data-upload-remove]');
      assert.equal(h.require('[data-upload-filename]').textContent, '尚未选择文件');
      assert.equal(h.require('[data-upload-submit]').disabled, true);
      await h.unmount();
      assert.equal(h.require('#app').childElementCount, 0);
    });
  });
});
