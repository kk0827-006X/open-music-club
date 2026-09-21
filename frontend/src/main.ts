// 本文件只用于确认 Vite 开发入口可运行，正式界面将在下一阶段实现。
const app = document.querySelector<HTMLElement>("#app");

if (app) {
  app.dataset.ready = "true";
}
