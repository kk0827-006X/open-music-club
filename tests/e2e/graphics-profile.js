// 只在浏览器测试的模块拦截中使用，不进入生产构建。
function graphicsProfile(url) {
  return `
    import { ArchiveScene as Original } from ${JSON.stringify(url)};
    export class ArchiveScene extends Original {
      nextFrameAt = 0;
      constructor(...args) { super(...args); this.setQuality({ scale:50,pixelRatio:1,antialias:'off',shadows:0,aoSamples:0,aoResolution:.5,depthOfField:0,transmission:.25,anisotropy:1 }); }
      async load(...args) { await super.load(...args); this.setSuperPerformance(true); }
      update(...args) {
        if (performance.now() < this.nextFrameAt) return;
        super.update(...args);
        // 按完成时间限速：慢软件帧也要给合成器和真实输入事件至少 250ms 空档。
        this.nextFrameAt = performance.now() + 250;
      }
    }`
}
module.exports = { graphicsProfile }
