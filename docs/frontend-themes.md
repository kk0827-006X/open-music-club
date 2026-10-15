# 前端主题：浅色、深色与跟随系统

## 配置与边界

全站颜色的唯一配置表为 `frontend/public/theme.css`，包含相同名称的浅色与深色 CSS Design Tokens。`frontend/src/styles/` 不再直接书写十六进制、RGB 等颜色值。

| 公开 Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--paper` | `#efede7` | `#141b1f` | 基础底色、设置弹窗 |
| `--ink` | `#20211e` | `#e7e7e0` | 主文字、主操作色 |
| `--muted` | `#77776f` | `#a2abae` | 次要说明 |
| `--hairline` | 原浅色半透明墨线 | 半透明蓝灰线 | 分隔与边框 |
| `--amber` | `#b77922` | `#d9aa6b` | 焦点、强调 |
| `--on-action` | `#f4f2ec` | `#161c1f` | 主操作背景上的文字 |
| `--on-accent` | `#20211e` | `#161c1f` | 琥珀背景上的文字 |
| `--danger` / `--success` | 原暖红／灰绿 | 柔和珊瑚／灰绿 | 提示与状态 |
| `--scene-*` | 原场景色 | 原仓库深色材质色 | 3D 环境与深色目标材质 |

`--color-text-*`、`--color-border-*`、`--color-surface-*` 等编号色阶保留原页面细微差别，浅色值不合并、不近似替换。新功能优先引用上述语义 Token；确需新增色阶，必须同时补齐两套配置。编号只是旧视觉的兼容色阶，不是在每个页面再定义一套主题。

专辑封面、头像、二维码等图片，以及 GLB/玻璃 Shader 的固有物理光学参数不反色、不滤镜处理。主题相关的 CSS 颜色、授权 SVG、3D 环境及原有深色目标材质由配置表提供；不以改变音频、重新创建场景的方式换肤。

## 初始化与调用

`frontend/index.html` 在 head 中依次加载：

1. `/theme.css`：立即提供根底色与 `color-scheme`。
2. `/theme-init.js`：同源、阻塞、非 async/defer 的独立 JavaScript，尽早读取偏好并设定主题。
3. 原 Vite 应用模块。

不添加内联脚本，不放宽 CSP。构建后这两个公共文件仍保留原路径。相比等待应用启动后才换肤，该顺序减少首屏错误主题闪烁；没有声称在断网或任意浏览器下都绝对零闪屏。

页面只调用中立接口：

```ts
import { getThemeState, setThemePreference, subscribeTheme } from './shared/theme.ts'

setThemePreference('light')  // 浅色
setThemePreference('dark')   // 深色
setThemePreference('system') // 跟随系统，保留这个偏好，而非保存某次解析结果

const current = getThemeState() // preference / resolved / persisted
const unsubscribe = subscribeTheme(state => { /* 同步该视图的选中态 */ })
// 视图销毁时 unsubscribe()
```

设置位置：设置 → 外观与动效 → 界面主题。三态按钮使用现有按钮悬停/键盘反馈，`aria-pressed` 表示偏好，而不是仅表示当前实际配色。

## 状态、存储与生命周期

- 文档根节点 `data-theme` 为实际 `light/dark`；`data-theme-preference` 为 `light/dark/system`。
- 缺省或损坏的存储值使用网站原有浅色；用户明确选择后持久化在当前来源的 `localStorage['omc.theme']`。只存三个短字符串之一，不保存账号或敏感资料，不写后端数据库。
- `prefers-color-scheme: dark` 的 change 事件仅在偏好为 system 时更新页面；手动选择不会被系统覆盖。
- storage 事件同步同源标签页；清空偏好恢复浅色。禁用存储时当前页面仍可切换，设置会提示无法保存偏好。
- early 脚本是文档生命周期唯一控制器，重复加载有守卫。它使用范围明确的主题请求/通知事件，不承担其他业务消息；不是应用万能 Event Bus。
- 设置视图、图形宿主各自取消主题订阅。HMR/页面切换不重复创建主题控制器，也不重新创建音频。
- 3D 复用原 `ArchiveScene.setTheme`；主题相关环境颜色只在主题改变时读取 CSS，不在每帧读取样式。设置弹窗暂停场景时只补画一帧更新背后画布，不恢复隐藏页高频循环。

## 验证与限制

- `tests/frontendTheme.test.js`：恢复/缺省/坏值、系统实时变化、手动覆盖、跨标签、禁用存储、重复初始化、设置分类不被主题选择器误拦截、Token 对应、深色关键对比度、音频/队列不变、Three 材质读取同一配置。
- `tests/frontendSceneHost.test.js`：主题进入现有场景接口；隐藏状态只补一帧，不产生第二条 RAF，销毁取消监听。
- `tests/frontendStyles.test.js`：将浅色 Token 还原后，原 2930 条样式声明的规范化哈希仍为 `bcee388081b6d2ffa751e226ca5dab835a0eccb53950be5bea091aa9abf20a9f`。仅排除原基础变量声明和新增三态按钮，原布局、断点和动效均保留。
- 主题控制脚本/接口定向覆盖率：行/语句 98.41%、分支 84.78%、函数 100%；这不是全前端覆盖率。
- 新增深色主文字、弱化文字和主操作色对比度测试达到 4.5:1。浅色严格保留原设计；既有弱化文字约 3.86:1，不据此声称整个网站所有文字都符合 AA。
- 浏览器使用隔离 Mock 工作区，检查档案墙、搜索/设置配色、三态选择、刷新恢复；系统主题变化由可控 MediaQueryList 单测验证，不改变用户操作系统设置。真实音源/VIP/公网 HTTPS 部署不属于本次主题验收。
- 后端、权限、Session/2FA、播放器业务未修改，无新增依赖和环境变量。全量测试与构建结果在本次交付中报告。

2026-10-15 最终结果：`pnpm build:web` 通过；`pnpm test` 273 项全部通过；`pnpm test:coverage` 全部通过，原后端行覆盖率 96.54%。Three.js 原有 500 kB 分块警告仍在，未借主题任务更改构建分包。`git diff --check` 通过。浏览器还验证了独立真实入口恢复深色、两个标签页的主题同步，测试后恢复为浅色并关闭测试标签；没有改动操作系统主题。

## Add 文件

```bash
git add frontend/index.html frontend/public/theme.css frontend/public/theme-init.js \
  frontend/src/shared/theme.ts frontend/src/styles \
  frontend/src/features/settings/settings-dialog.ts \
  frontend/src/features/auth/entry-page.ts frontend/src/features/auth/authorized-sequence.ts \
  frontend/src/graphics/archive/scene-host.ts frontend/src/rhine/theme-material.ts \
  tests/frontendTheme.test.js tests/frontendStyles.test.js tests/frontendSceneHost.test.js \
  tests/fixtures/frontend-refactor.html docs/frontend-themes.md docs/frontend-architecture.md
```

提交前查看 `git diff`；不要把原本未跟踪的 `docs/frontend-design/` 加进去。本次不自动暂存或提交。
