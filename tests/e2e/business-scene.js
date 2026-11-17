// 此模块仅由 Playwright 网络拦截提供，不导入生产构建、不创建 WebGL 或动画渲染器。
const businessSceneSource = `
export class ArchiveScene {
  detailVisibility = 0;
  constructor(container) {
    this.container = container;
    this.probe = { live: true };
    (window.__migrationScenes ??= []).push(this.probe);
    (window.__businessScenes ??= []).push(this);
  }
  async load() {}
  setReduced() {}
  setTheme() {}
  setAudioBands() {}
  setMode(mode) { this.detailVisibility = mode === 'detail' ? 1 : 0; }
  select(index) { this.selectedIndex = index; }
  resize() {}
  update() {}
  finishOpening() { this.setMode('archive'); }
  finishDecryption() {}
  dispose() { this.probe.live = false; }
}
`;

module.exports = { businessSceneSource };
