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

`LetterGlitch.tsx` 来自官方 <https://reactbits.dev/r/LetterGlitch-TS-CSS.json>（2026-10-28），使用同目录许可证；仅将 CSS 导入移至登录页样式表。登录页适配层配置暖灰与橙色、透明背景及较低强度，不启用鼠标交互；输入和弹窗期间保持同一个背景；隐藏标签与减少动态效果时卸载装饰。无新增依赖。

`CodeSlots.tsx` 与 `../../../styles/code-slots.css` 基于官方 <https://reactbits.dev/r/CodeSlots-TS-CSS.json>（2026-10-30），使用同目录许可证；保留弹簧数字、光标、键盘/粘贴/自动填充与受控值逻辑。适配站点主题变量、中文读屏提示、输入名称和原生成功勾号，移除 Hugeicons 图标依赖，复用现有 Motion。登录验证码填满后自动请求既有验证接口，恢复码仍使用独立文本框手动提交，不改变后端认证协议。


`WakeSlider.tsx` 与 `../../../styles/wake-slider.css` 基于官方 <https://reactbits.dev/r/WakeSlider-TS-CSS.json>（2026-10-30），使用同目录许可证。保留竖条、速度驱动尾波和弹簧平滑；复用已有 Motion，适配主题变量、中文音量标签、0% 全暗、主指针限制、隐藏视图禁用/释放捕获、卸载帧清理和实时减少动态效果。仅用于展开播放器音量，受控 0～100 映射回原 0～1 音量接口；迷你播放器仍使用原 Radix VolumeSlider。无新增依赖。
