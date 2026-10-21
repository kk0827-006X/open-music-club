// 只在浏览器测试的模块拦截中使用，不进入生产构建。
function graphicsProfile(url) {
  return `
    import { ArchiveScene as Original } from ${JSON.stringify(url)};
    export class ArchiveScene extends Original {
      pendingFrame = true;
      constructor(...args) { super(...args); this.acceptanceContainer = args[0]; this.setQuality({ scale:50,pixelRatio:1,antialias:'off',shadows:0,aoSamples:0,aoResolution:.5,depthOfField:0,transmission:.25,anisotropy:1 }); }
      async load(...args) { await super.load(...args); this.setSuperPerformance(true); }
      select(...args) { super.select(...args); this.pendingFrame = true; }
      resize(...args) { super.resize(...args); this.pendingFrame = true; }
      setMode(...args) { super.setMode(...args); this.pendingFrame = true; }
      update(...args) {
        if (!this.pendingFrame) return;
        this.pendingFrame = false;
        super.update(...args);
        // 真实模型/相机/渲染仍运行；业务验收不承载持续动画性能测试。
        const stats = this.getStats();
        this.acceptanceContainer.dataset.acceptanceFrames = String(stats.renderedFrames);
        this.acceptanceContainer.dataset.acceptanceSelection = JSON.stringify(stats.selectedCell);
      }
    }`
}
module.exports = { graphicsProfile }
