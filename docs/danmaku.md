# 音乐热梗弹幕墙（Danmaku Wall）

主打年轻化和社区互动：听歌时发一条弹幕（如「高能预警！」「这段吉他绝了」），系统记录当时的播放进度；别人听到同一秒时，这条弹幕准时从右往左飘过。

## 功能总览

| 能力 | 说明 |
| --- | --- |
| 实时弹幕 | 弹幕墙是独立整页：影院级大屏舞台占主视野，弹幕从右向左飘过（约 9 秒），7 条泳道轮转，最多同时 40 条 |
| 时间戳定位 | 发送时记录 `position_ms`（当前播放进度，钳制在歌曲时长内）；进度推进到该时间戳时准时触发 |
| 拖动保护 | 一次进度跳变超过 5 秒（拖进度条/切歌）视为「错过」，不回放旧弹幕，避免刷屏 |
| 全站实时流 | 右侧栏展示跨歌曲的最新弹幕（`GET /api/me/danmaku/recent`），不播放歌曲也有内容可看，12 秒增量刷新 |
| 直达地址 | 支持页内 hash 路由：`#/danmaku` 直接打开弹幕墙（`#/blindbox`、`#/search` 等同理），刷新/分享链接落在同一页 |
| 弹幕开关 | 一键开关，关闭后舞台透明度为 0 且不再起飞新弹幕（时间轴列表仍可读） |
| 透明度调节 | 20%–100% 滑杆，实时生效 |
| 关键词屏蔽 | 用户自选屏蔽词（逗号/顿号/换行分隔，忽略大小写），舞台与时间轴同时过滤，并提示隐藏条数 |
| 设置持久化 | 开关/透明度/屏蔽词存 `localStorage`（key `open-music-club.danmaku.settings`），隐私模式静默跳过 |
| 发送限速 | 同一用户 2 秒内只能发一条（服务端强校验，返回 429） |
| 撤回 | `DELETE /api/me/danmaku/:id` 只能删自己的；删他人返回 403 |

## 后端

- **表**：`danmaku_messages`（`src/db/danmaku.js` 初始化，含 `(track_source, track_source_id, position_ms)` 与 `(user_id, created_at)` 两个索引）
- **服务**：`src/services/danmaku.service.js`——内容校验（去控制字符、1–60 字）、进度钳制、2 秒限速、错误脱敏
- **路由**：`src/routes/danmaku.routes.js`，挂在 `/api/me`（需登录），`Cache-Control: no-store`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/me/danmaku?source=local&sourceId=8&afterId=0&limit=500` | 拉一首歌的弹幕时间轴；`afterId` 用于增量轮询 |
| GET | `/api/me/danmaku/recent?afterId=0&limit=30` | 全站实时弹幕流（跨歌曲，按 id 倒序），`afterId` 用于增量轮询 |
| POST | `/api/me/danmaku` | 发送 `{ track, content, positionMs, durationMs }`，返回带 `mine: true` 的消息 |
| DELETE | `/api/me/danmaku/:id` | 撤回自己的弹幕 |

### 为什么用轮询而不是 WebSocket

当前后端是 Express 单体 + better-sqlite3，没有 sticky-session / Redis pub/sub 基建；弹幕的同步粒度是「播放秒级进度」，前端以 `timeupdate`（约 250ms）驱动触发，配合 15 秒增量轮询即可秒级看到新弹幕，且断线自动恢复、无状态可水平扩展。接口结构（按 track + position 存取）已为 WebSocket 推送预留，后续可平滑升级。

## 前端

- **页面**：`frontend/src/features/danmaku/DanmakuPage.tsx`，注册为 Tab「弹幕墙」（`Workspace.tsx`），支持 `#/danmaku` hash 直达；通过 props 注入 `PlayerController`，与播放页共享同一播放状态——播放器在后台播，弹幕墙照常跟随进度
- **触发核心**：`dueMessages(messages, lastMs, currentMs)` 纯函数（可测试）；进度按 `timeupdate` 推进，跨过弹幕 `positionMs` 即起飞
- **样式**：`frontend/src/styles/danmaku.css`（`@keyframes danmaku-drift` 从右向左，`prefers-reduced-motion` 时缩短动画）
- **图标**：`icons.ts` 新增 `danmaku`
- 曲目标识来自播放条目 key（`local:8` / `netease:song:11`），与盲盒、搜索页共用同一 key 体系

## 测试

- `tests/danmaku.test.js`：9 项（发送/校验/限速/增量拉取/全站实时流/越权删除/未登录 401/CSRF）
- `tests/frontendDanmaku.test.js`：11 项（客户端适配、全站实时流、时间戳触发、拖动跳过、屏蔽词、开关、切歌竞态）

## 与盲盒补丁的关系

本补丁基于「main + 音乐盲盒补丁」之后的代码：`app.js`、`database.js`、`Workspace.tsx`、`icons.ts`、`style.css`、`tests/helpers/frontendSource.js` 六个文件同时包含盲盒与弹幕墙的改动。**请先应用盲盒补丁，再应用弹幕墙补丁。**
