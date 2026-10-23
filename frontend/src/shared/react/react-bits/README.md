# React Bits 来源记录

`../LineSidebar.tsx` 及 `../../../styles/member-sidebar.css` 的 LineSidebar 段基于官方 TypeScript + CSS 版本：

- 组件：<https://reactbits.dev/components/line-sidebar>
- 注册表：<https://reactbits.dev/r/LineSidebar-TS-CSS.json>
- 源码：<https://github.com/DavidHDev/react-bits/tree/1eeb6f105c68b964289d85dabbe84a1d551f3797/src/ts-default/Components/LineSidebar>
- 获取日期：2026-10-23。
- 许可证：MIT + Commons Clause，全文保留在同目录 `LICENSE.md`，并非无附加限制的 MIT。

本地适配：用站点 CSS Tokens 替换颜色；保留官方距离衰减、逐帧指数平滑、标线缩放效果；将点击列表改成原生按钮，增加受控选项、双语标签、数据选择器、焦点反馈、减少动效与隐藏页清理。无新增 npm 依赖。

仓库根目录 `components.json` 为 shadcn MCP 配置官方 `@react-bits` 注册表，源码别名均指向 `frontend/src`。组件以源码引入，不是安装名为 react-bits 的运行时包；项目不使用 Tailwind，请继续选择 `TS-CSS` 变体。CSS 统一由 `src/style.css` 导入，便于现有 Node TSX 测试独立加载组件。

`CollapsibleSidebarLayout` 是共用布局适配，管理可拖动分隔线及收展状态，不拥有页面业务数据。桌面向左拖过阈值收起；收起后左缘悬停或键盘聚焦显示展开箭头，点击或向右拖动恢复。可用 Enter/空格切换、方向键调节、Home 收起、End 展开。窄屏保留全部横排菜单；收展不会销毁右侧内容。

## 集中验收记录（2026-10-23）

- 分支：`codex/music-footprints-integration`；基线 HEAD：`1c96639204bae2034fdb54c14611585c55bd5007`。保留原有未提交音乐足迹及部署文档，不改 `main`，未自动提交。
- 主 Agent 实现、整合并集中验收；独立工作树执行 Agent 编写组件测试，另由 TypeScript 与代码审查 Agent 只读审查，所发现问题均复核修正。
- 最终 `pnpm build:web` 通过；最终串行 `pnpm test` 共 358 项全部通过（含 8 项新增组件回归）；`pnpm test:e2e` 共 6 项全部通过。
- 浏览器覆盖两页真实拖拽、左缘悬停箭头、原生键盘激活、右侧节点保留、深色主题、390px 窄屏导航及单 Audio；现有真实隔离 API、2FA、混合音频、队列、场景释放流程均保留通过。
- 首轮浏览器发现窄屏扩大命中区域覆盖相邻菜单，已限制移动端按钮伪元素范围；测试夹具按现有足迹接口契约修正，未修改业务协议或降低断言。
- 回归中既有 2FA、用户资料测试分别出现单次异常；独立复核 23 项通过、最终串行全套 358 项通过。尚未确认这些间歇异常的根因，不等于已修复该类波动；本轮未改动后端。
- 日志保留在被忽略的 `artifacts/sidebar-integration/`，最终截图、报告位于 `artifacts/e2e/`，均不纳入 Git。构建仍有既有 Three.js 大块提示；没有 CPU/GPU 性能基准，不声称整体性能提升。
