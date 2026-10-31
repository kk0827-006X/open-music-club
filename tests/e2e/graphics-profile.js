// 只在浏览器测试的模块拦截中使用，不进入生产构建。
function graphicsProfile(url) {
  return `
    import { ArchiveScene as Original } from ${JSON.stringify(url)};
    export class ArchiveScene extends Original {
      pendingFrame = true;
      constructor(...args) { super(...args); this.acceptanceContainer = args[0]; if(window.__archiveEntryProbe) { window.__archiveEntryProbe.scene = this; window.__archiveEntryProbe.created++; } this.setQuality({ scale:50,pixelRatio:1,antialias:'off',shadows:0,aoSamples:0,aoResolution:.5,depthOfField:0,transmission:.25,anisotropy:1 }); }
      async load(...args) { await super.load(...args); this.setSuperPerformance(true); }
      setHover(...args) { super.setHover(...args); this.pendingFrame = true; }
      setReduced(...args) { super.setReduced(...args); this.pendingFrame = true; }
      setOpeningProgress(...args) { super.setOpeningProgress(...args); this.pendingFrame = true; }
      async prepareEntry(...args) {
        const probe = window.__archiveEntryProbe;
        const started = performance.now(), before = this.renderer.info.programs?.length ?? 0;
        await super.prepareEntry(...args);
        if (probe) probe.warmup = { before, after: this.renderer.info.programs?.length ?? 0, duration: performance.now() - started };
        this.pendingFrame = true;
      }
      select(...args) { super.select(...args); this.pendingFrame = true; }
      resize(...args) { super.resize(...args); this.pendingFrame = true; }
      setMode(...args) { super.setMode(...args); this.pendingFrame = true; }
      update(...args) {
        if (!window.__archiveEntryProbe?.animate && !this.pendingFrame && !args[1] && !['entering', 'settling'].includes(this.acceptanceContainer.closest('[data-entry-phase]')?.dataset.entryPhase)) return;
        this.pendingFrame = false;
        super.update(...args);
        // 真实模型/相机/渲染仍运行；业务验收不承载持续动画性能测试。
        const stats = this.getStats();
        if(window.__archiveEntryProbe && window.__archiveEntryProbe.frames.length < 600) window.__archiveEntryProbe.frames.push({ navigationInert: document.querySelector('[data-archive-navigation]')?.inert, informationHidden: document.querySelector('[data-album-information]')?.hidden, phase: this.acceptanceContainer.closest('[data-entry-phase]')?.dataset.entryPhase, cinematic: args[1], camera: stats.cameraPosition, aim: this.cameraAim.toArray(), fov: this.camera.fov, position: stats.modelPosition });
        this.acceptanceContainer.dataset.acceptanceFrames = String(stats.renderedFrames);
        this.acceptanceContainer.dataset.acceptanceSelection = JSON.stringify(stats.selectedCell);
      }
    }`
}
module.exports = { graphicsProfile }
