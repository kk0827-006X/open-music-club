# Open Music Club 工程技术路线图

> 项目名称：**Open Music Club**  
> 项目类型：面向受控成员的公网音乐共享与播放网站（课程作业）  
> 当前阶段：**只进行后端、数据库、接口与部署设计，不进行前端 UI 设计**  
> 参考项目：`NeteaseCloudMusicApiEnhanced/api-enhanced`  
> 技术目标：通过公网 HTTPS 为受控成员提供音乐服务；“网易云接口音乐”和“用户上传音乐”在存储、API 与来源标识层保持独立，在前端展示、播放队列和用户操作层通过统一播放器数据模型协作。

---

## 1. 项目目标

Open Music Club 是一个仅面向指定成员开放、通过 HTTPS 部署到公网的音乐网站。

系统核心目标：

1. 用户不能自由注册，必须提交访问申请。
2. 管理员审核通过后，用户才能获得账号并登录。
3. 登录后可以使用精简版网易云音乐相关功能。
4. 网易云相关功能只保留与音乐内容、用户音乐数据直接相关的基础接口。
5. 用户可以上传自己的音乐文件。
6. 用户上传音乐与网易云接口音乐在文件存储、数据库实体、API 命名空间和来源标识上保持独立。
7. 两类音乐在前端展示、播放队列、播放控制和用户操作层使用同一套统一歌曲模型，不建立两个播放器。
8. 本地音乐 API 必须返回足够的歌曲元数据和受保护的流媒体地址，使前端可以无损转换为统一播放器数据模型。
9. 已登录成员可以在线播放和下载其他成员上传的音乐。
10. 系统通过 HTTPS 对公网开放，Node.js 服务隐藏在受信任反向代理之后，不直接暴露内部端口、数据库或文件目录。
11. 登录系统支持 TOTP 2FA，管理员在公网开放前必须启用，普通用户允许逐步启用。
12. 公网响应、日志、上传入口、Session 和管理接口按不可信网络环境设计，默认不暴露内部实现信息。
13. 当前阶段暂不实现前端 UI，但后端 API 必须提前稳定统一播放器所需的数据契约。

---

# 2. 功能范围

## 2.1 第一阶段必须实现

### 用户与权限

- 访问申请
- 管理员审核申请
- 管理员创建/激活用户
- 邮箱 + 密码登录
- Session 登录状态
- 用户退出登录
- TOTP 2FA 设置、验证和恢复码
- 普通用户 / 管理员权限区分
- 禁止未登录用户访问音乐接口

### 网易云音乐基础功能

建议仅保留：

- 登录状态
- 用户信息
- 用户歌单
- 歌单详情
- 歌曲详情
- 歌曲搜索
- 歌曲播放地址
- 歌词
- 歌手基础信息
- 专辑基础信息
- 用户播放记录

### 本地共享音乐

- 上传音乐
- 查询本地音乐列表
- 查询音乐详情
- 在线播放
- 文件下载
- 下载次数记录
- 上传者删除自己的音乐
- 管理员删除任意音乐
- 获取上传者信息
- 文件大小限制
- 音频格式校验

---

## 2.2 暂不实现

以下内容不进入第一版：

- 评论
- 排行榜
- 每日推荐
- 私人 FM
- 动态
- 社交关系
- 关注/粉丝
- 直播
- 播客
- MV
- 视频
- 广告
- 云村
- 活动
- 签到
- 数字专辑购买
- 推荐算法
- 第三方 OAuth
- 手机验证码注册
- 完整前端 UI
- 在线支付
- 商业化功能

---

# 3. 总体架构

推荐采用“三层服务”结构。

```text
                     Open Music Club
                           │
                ┌──────────┴──────────┐
                │                     │
           用户认证服务            音乐服务
                │                     │
      ┌─────────┴─────────┐     ┌─────┴────────────┐
      │                   │     │                  │
   申请审核              Session  网易云音乐        本地音乐
      │                         │                  │
   数据库                 api-enhanced         本地文件系统
                               │                  │
                            网易云接口           uploads/
```

推荐实际运行结构：

```text
公网浏览器
   │
   │ HTTPS :443
   ▼
Caddy / Nginx 反向代理
   │
   │ 受保护的本机或容器网络
   ▼
Open Music Club Node.js 主服务
http://127.0.0.1:3000
   │
   ├── /api/auth/*
   ├── /api/applications/*
   ├── /api/admin/*
   ├── /api/local/*
   │
   └── /api/netease/*
           │
           ▼
   精简版 api-enhanced
```

音乐数据进入前端后的关系：

```text
/api/netease/* ──> 网易云数据适配器 ──┐
                                     ├──> 统一 Track 模型 ──> 同一播放队列 ──> 同一播放器
/api/local/*   ──> 本地音乐数据适配器 ─┘
```

这里的“统一”只发生在展示和交互契约层。网易云响应、本地音乐数据库记录和本地文件不能为了前端方便而混入同一套源数据存储逻辑。

---

# 4. 技术栈建议

## 4.1 基础环境

- Node.js 22+
- pnpm
- JavaScript（CommonJS）
- Express

优先沿用 `api-enhanced` 的技术体系，减少额外学习成本。

---

## 4.2 数据库

课程项目推荐：

**SQLite**

原因：

- 不需要额外安装数据库服务器
- 一个数据库文件即可备份
- 小型成员社区和单机部署完全够用
- 开发简单
- 适合演示

推荐库：

```bash
pnpm add better-sqlite3
```

后续如果需要迁移，可以换成：

- MySQL
- PostgreSQL

但第一版不建议一开始增加数据库部署复杂度。

---

## 4.3 用户认证

推荐：

- `bcrypt`
- `express-session`
- `connect-sqlite3`
- 支持 RFC 6238 TOTP 的维护良好库

```bash
pnpm add bcrypt express-session connect-sqlite3
```

认证方式：

```text
邮箱 + 密码
      ↓
bcrypt 校验
      ↓
需要 2FA 时验证 TOTP / 一次性恢复码
      ↓
重新生成 Session ID
      ↓
浏览器 Secure Cookie
```

不要第一版使用 JWT。

同源网站继续使用服务端 Session，便于立即撤销登录状态和管理员权限。

2FA 采用认证器 App 生成的 TOTP，不依赖短信或邮件验证码。管理员必须启用；普通用户可以逐步启用。TOTP 密钥需要可用于校验，因此使用独立环境密钥加密保存，不能明文入库；恢复码每个只能使用一次，并且只保存哈希。

密码验证成功但尚未完成 2FA 时，只能建立短时、低权限的“待验证登录状态”，不能写入正式 `userId`，也不能访问任何受保护业务接口。密码登录和 2FA 成功后都要重新生成 Session ID，防止 Session Fixation。

生产 Cookie 至少设置：

```text
secure=true
httpOnly=true
sameSite=lax
path=/
```

如果没有跨站嵌入需求，优先使用 `__Host-` 前缀的 Cookie 名称。Session 设置合理的空闲和绝对过期时间，退出、密码修改、账号禁用或 2FA 重置时撤销相关 Session。

---

## 4.4 文件上传

推荐：

```bash
pnpm add multer
```

用于：

- 上传 MP3
- 上传 FLAC
- 上传 WAV
- 上传 M4A
- 上传 OGG

---

## 4.5 音乐元数据

推荐：

```bash
pnpm add music-metadata
```

上传音乐后自动读取：

- Title
- Artist
- Album
- Duration
- Cover
- Genre

---

## 4.6 邮件通知

推荐：

```bash
pnpm add nodemailer
```

注意：

邮件不是申请数据的唯一存储位置。

正确流程：

```text
用户提交申请
      ↓
保存数据库
      ↓
给管理员发送邮件提醒
```

即使邮件发送失败，管理员仍然可以在后台看到申请。

---

## 4.7 公网安全基础设施

公网生产环境采用以下简单结构：

```text
Internet
   ↓ HTTPS / TLS 1.2+
Caddy 或 Nginx
   ↓ HTTP，仅限本机回环或受保护容器网络
Node.js + Express
```

推荐使用 Caddy 自动申请和续期证书；如果使用 Nginx，则配合 ACME 客户端管理证书。HTTP 80 端口只用于 ACME 校验和跳转到 HTTPS，不提供可继续使用的明文业务会话。

Express 侧增加维护良好的安全中间件或等价配置，用于：

- 基础安全响应头和 Content Security Policy。
- 同源 CORS 白名单。
- CSRF Token 校验。
- 全局及敏感路由速率限制。
- 请求体大小、请求超时和参数数量限制。
- 统一请求 ID、服务端安全日志与公网错误脱敏。

`trust proxy` 只能按实际部署拓扑设置，例如单层本机反向代理使用精确的一跳配置。禁止为了让 Secure Cookie 生效而直接设置为无条件信任所有代理。

---

# 5. GitHub 项目处理方式

参考项目：

```text
NeteaseCloudMusicApiEnhanced/api-enhanced
```

不要直接对原仓库大规模删除。

推荐方式：

```text
Fork
 ↓
建立自己的 Open Music Club 仓库
 ↓
保留 api-enhanced 核心源码
 ↓
通过白名单只加载需要的接口
 ↓
最后再删除确定无依赖的模块
```

---

# 6. api-enhanced 精简方案

原项目的 `server.js` 会读取 `module/` 目录中的 JavaScript 模块并自动注册 API。

同时支持：

```js
moduleDefs
```

因此推荐使用“接口白名单”。

---

## 6.1 第一版建议保留的接口类型

### 用户

```text
login_status
user_detail
user_playlist
user_record
logout
```

如果需要网易云账号本身登录，再单独保留相关登录接口。

但 Open Music Club 自己的网站账号系统与网易云账号系统必须分开。

---

### 搜索

```text
search
```

第一版只在前端使用歌曲搜索类型。

即使接口本身支持其他搜索类型，也暂时不展示。

---

### 歌曲

```text
song_detail
song_url_v1
lyric
```

必要时补充：

```text
check_music
```

---

### 歌单

```text
playlist_detail
playlist_track_all
```

根据实际调用结果决定是否补充其他 playlist 模块。

---

### 歌手

建议保留最低限度：

```text
artist_detail
artist_songs
```

---

### 专辑

建议：

```text
album
album_detail
```

实际模块名称以当前仓库代码为准。

---

## 6.2 明确不加载

第一版不注册以下类别：

```text
comment*
toplist*
recommend*
personal_fm*
fm_*
daily_signin*
event*
video*
mv*
dj*
live*
follow*
fans*
topic*
ad_*
```

注意：

不要简单按照文件名前缀批量删除。

先通过白名单不注册。

---

## 6.3 白名单配置

建议新增：

```text
config/netease-modules.js
```

结构示意：

```js
module.exports = [
  {
    route: '/login/status',
    module: require('../module/login_status'),
  },
  {
    route: '/user/detail',
    module: require('../module/user_detail'),
  },
  {
    route: '/user/playlist',
    module: require('../module/user_playlist'),
  },
  {
    route: '/user/record',
    module: require('../module/user_record'),
  },
  {
    route: '/search',
    module: require('../module/search'),
  },
  {
    route: '/song/detail',
    module: require('../module/song_detail'),
  },
  {
    route: '/song/url/v1',
    module: require('../module/song_url_v1'),
  },
  {
    route: '/lyric',
    module: require('../module/lyric'),
  },
  {
    route: '/playlist/detail',
    module: require('../module/playlist_detail'),
  },
]
```

然后：

```js
const musicModules = require('./config/netease-modules')

require('./server').serveNcmApi({
  checkVersion: false,
  moduleDefs: musicModules,
})
```

第一阶段只做接口白名单，不删 `util/`、加密模块、Cookie 模块等底层代码。

---

# 7. Open Music Club 账号体系

一定要明确：

```text
Open Music Club 账号
≠
网易云账号
```

网站自己的用户权限由 Open Music Club 数据库管理。

Open Music Club 的 2FA 只保护网站账号，不复用、代理或保存网易云账号的二次认证信息。

---

# 8. 申请制注册流程

完整流程：

```text
访问 Open Music Club
       ↓
未登录
       ↓
┌──────────────┐
│ 登录 / 申请加入 │
└──────────────┘
       ↓
填写：
昵称
邮箱
申请理由
       ↓
POST /api/applications
       ↓
写入 access_requests
       ↓
status = pending
       ↓
发送管理员邮箱提醒
       ↓
管理员审核
       ↓
 ┌─────┴─────┐
通过         拒绝
 │            │
创建用户      rejected
 │
生成初始密码或激活 Token
 │
用户设置密码
 │
正式登录
```

---

# 9. 用户权限模型

第一版只设计两个正式角色：

```text
user
admin
```

状态：

```text
active
disabled
```

申请状态：

```text
pending
approved
rejected
```

权限：

| 功能 | 未登录 | user | admin |
|---|---:|---:|---:|
| 提交申请 | 是 | 否 | 否 |
| 登录 | 是 | 是 | 是 |
| 管理自己的 2FA | 否 | 是 | 是（强制启用） |
| 查看网易云音乐 | 否 | 是 | 是 |
| 播放网易云音乐 | 否 | 是 | 是 |
| 查看本地音乐 | 否 | 是 | 是 |
| 上传音乐 | 否 | 是 | 是 |
| 下载音乐 | 否 | 是 | 是 |
| 删除自己的音乐 | 否 | 是 | 是 |
| 删除任意音乐 | 否 | 否 | 是 |
| 审核申请 | 否 | 否 | 是 |
| 禁用用户 | 否 | 否 | 是 |

---

# 10. 数据库设计

现有业务至少需要 4 张核心表；公网认证升级另外增加 2 张 2FA 表。已有表通过增量迁移扩展，不能删除或重建现有数据。

---

## 10.1 users

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

公网升级时可以在安全迁移中增加 `two_factor_required` 等策略字段；TOTP 密钥本身不要直接放入 `users` 表。

---

## 10.2 access_requests

```sql
CREATE TABLE access_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    nickname TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
```

---

## 10.3 uploaded_music

```sql
CREATE TABLE uploaded_music (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,

    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    file_path TEXT NOT NULL,

    mime_type TEXT,
    file_size INTEGER NOT NULL,
    duration REAL,

    uploader_id INTEGER NOT NULL,

    download_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (uploader_id) REFERENCES users(id)
);
```

---

## 10.4 download_logs

```sql
CREATE TABLE download_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    music_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (music_id) REFERENCES uploaded_music(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 10.5 user_two_factor

```sql
CREATE TABLE user_two_factor (
    user_id INTEGER PRIMARY KEY,
    secret_ciphertext TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_used_counter INTEGER,
    confirmed_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

约束：

- `secret_ciphertext` 使用独立的 `TOTP_ENCRYPTION_KEY` 进行认证加密，数据库泄漏时不能直接得到 TOTP 密钥。
- 尚未确认的设置过程不能立刻启用 2FA；用户必须先用认证器生成一个正确验证码完成确认。
- 成功使用 TOTP 后记录其时间计数器，拒绝在同一有效窗口内重复使用同一个验证码；只允许很小的时钟偏差窗口，并确保服务器自动校时。
- 管理员账号在公网开放前必须存在 `enabled=1` 的有效记录。

## 10.6 two_factor_recovery_codes

```sql
CREATE TABLE two_factor_recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

恢复码只在生成时向用户展示一次。数据库只保存哈希；使用成功后立即标记失效，并向用户提示重新生成剩余恢复码。

---

# 11. Session 数据

Session 不建议只存在内存中。

开发阶段可以用 SQLite Session Store。

原因：

Node 服务重启后，内存 Session 会全部丢失。

推荐：

```text
sessions.sqlite
```

单独存储 Session。

公网环境额外要求：

- Session ID 使用足够强的随机值，Cookie 只包含 Session ID，不包含用户角色、TOTP 密钥或其他敏感资料。
- 密码校验成功但 2FA 未完成时，只保存短期 `pendingUserId`、过期时间和失败次数；不能视为正式登录。
- 完成登录、完成 2FA、权限提升或密码修改后重新生成 Session ID。
- 设置空闲过期和绝对过期时间；管理员 Session 使用更短有效期。
- 账号被禁用、密码或 2FA 被重置时撤销该用户现有 Session。
- 生产 Cookie 开启 `secure`、`httpOnly`、`sameSite=lax`，并仅通过 HTTPS 下发。

---

# 12. API 路由规划

Open Music Club 自己的 API 与网易云 API 必须使用不同命名空间。

推荐：

```text
/api/auth/*
/api/applications/*
/api/admin/*
/api/local/*
/api/netease/*
```

固定边界：

- `/api/netease/*` 只处理网易云外部数据，不查询或伪装成本地音乐记录。
- `/api/local/*` 只处理 Open Music Club 管理的本地文件和元数据，不代理网易云接口。
- 本地音乐 API 必须显式返回 `source=local` 和字符串形式的 `sourceId`；网易云适配器根据 `/api/netease/*` 命名空间和网易云歌曲 `id` 生成 `source=netease`、`sourceId`，不要求改写 vendor 的原始响应。
- API 独立不等于播放器独立；前端只维护一个播放队列和一个音频播放引擎。

---

# 13. 身份认证 API

## POST /api/auth/login

请求：

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

没有启用 2FA 时，登录成功后返回正式用户信息。启用 2FA 时，密码正确后只返回待验证状态：

```json
{
  "success": true,
  "requiresTwoFactor": true
}
```

此时不得写入正式登录身份，也不能访问受保护接口；可以下发只包含短期待验证状态的 Secure Session Cookie，用来关联下一步 2FA。邮箱不存在和密码错误继续使用完全相同的公网错误信息，避免枚举账号。

2FA 未启用时的成功返回：

```json
{
  "success": true,
  "requiresTwoFactor": false,
  "user": {
    "id": 2,
    "nickname": "User",
    "role": "user"
  }
}
```

---

## POST /api/auth/2fa/verify

请求：

```json
{
  "code": "123456"
}
```

只接受短时待验证 Session。验证 TOTP 或一次性恢复码成功后，清除待验证状态、重新生成 Session ID，再写入正式登录状态。验证码错误、过期和恢复码无效使用统一提示；连续失败必须限速并终止当前待验证流程。

---

## POST /api/auth/2fa/setup

已登录用户在重新输入当前密码后生成待确认的 TOTP 密钥和 `otpauth://` 信息。密钥不能写入日志，也不能在确认后再次通过 API 取回。

---

## POST /api/auth/2fa/confirm

用户提交认证器生成的第一个正确验证码后才正式启用 2FA，并一次性返回恢复码。管理员没有成功完成此步骤前，不能视为符合公网部署要求。

---

## POST /api/auth/2fa/recovery-codes/regenerate

要求当前密码和有效 TOTP，再生成一组新恢复码并使旧恢复码全部失效。

---

## POST /api/auth/2fa/disable

普通用户关闭 2FA 时要求当前密码和有效 TOTP。管理员账号默认禁止自行关闭，必须通过受审计的管理员恢复流程处理。

---

## POST /api/auth/logout

退出登录。

---

## GET /api/auth/me

获取当前登录用户。

返回示例：

```json
{
  "authenticated": true,
  "user": {
    "id": 2,
    "nickname": "User",
    "role": "user",
    "twoFactorEnabled": true
  }
}
```

所有认证接口都需要独立的速率限制。对外日志不得记录密码、验证码、恢复码、Cookie 或完整 Session ID。

---

# 14. 申请 API

## POST /api/applications

提交申请。

请求：

```json
{
  "nickname": "Alice",
  "email": "alice@example.com",
  "reason": "课程项目小组成员"
}
```

---

## GET /api/applications/status

可选功能。

通过邮箱 + 一次性查询 Token 查询申请状态。

第一版也可以不实现。

---

# 15. 管理员 API

全部必须经过：

```text
requireLogin
+
requireAdmin
```

---

## GET /api/admin/applications

查看申请列表。

---

## POST /api/admin/applications/:id/approve

批准申请。

执行：

```text
pending
 ↓
approved
 ↓
创建 users
 ↓
生成临时密码
```

---

## POST /api/admin/applications/:id/reject

拒绝申请。

---

## GET /api/admin/users

查看用户。

---

## POST /api/admin/users/:id/disable

禁用用户。

---

# 16. 本地音乐 API

本地音乐统一放：

```text
/api/local/music
```

---

## GET /api/local/music

返回本地音乐列表。

列表中的每一项至少返回：

```json
{
  "id": 25,
  "source": "local",
  "sourceId": "25",
  "title": "Example",
  "artists": [
    {
      "id": null,
      "name": "Alice"
    }
  ],
  "album": {
    "id": null,
    "name": "Example Album"
  },
  "durationMs": 243000,
  "coverUrl": "/api/local/music/25/cover",
  "streamUrl": "/api/local/music/25/stream",
  "downloadUrl": "/api/local/music/25/download",
  "mimeType": "audio/mpeg",
  "fileSize": 7340032,
  "playable": true,
  "uploadedBy": {
    "id": 2,
    "nickname": "Alice"
  },
  "createdAt": "2026-01-01T12:00:00.000Z"
}
```

约束：

- 不向客户端返回真实文件系统路径、UUID 存储文件名或其他内部字段。
- `streamUrl` 必须指向经过登录校验并支持 HTTP Range 的 API，不能指向静态目录。
- `durationMs` 统一使用毫秒，避免前端分别处理秒和毫秒。
- `artists` 和 `album` 使用结构化字段，使本地歌曲可以转换为与网易云歌曲一致的播放器模型。
- 缺少歌手、专辑或封面时返回稳定的空值或默认值，不让前端猜测字段结构。

---

## GET /api/local/music/:id

返回详细信息，并至少包含列表接口中的全部统一转换字段。详情接口可以额外返回格式、码率、采样率、上传者和下载统计，但不能暴露服务器文件路径。

---

## GET /api/local/music/:id/cover

返回从音频元数据提取或单独保存的封面。没有封面时可以返回统一默认封面或 `404`，但列表和详情中的 `coverUrl`/空值规则必须固定，避免前端为不同本地歌曲编写不同判断逻辑。

该接口与流媒体接口一样必须经过登录校验，不能通过静态目录直接暴露封面存储路径。

---

## POST /api/local/music

上传歌曲。

使用：

```text
multipart/form-data
```

字段：

```text
file
title（可选）
artist（可选）
album（可选）
```

如果没有填写：

通过 `music-metadata` 读取。

---

## GET /api/local/music/:id/stream

在线播放。

必须支持：

```text
HTTP Range Request
```

否则浏览器拖动播放进度可能出现问题。

---

## GET /api/local/music/:id/download

下载文件。

同时：

```text
download_count + 1
```

并写入：

```text
download_logs
```

---

## DELETE /api/local/music/:id

权限：

```text
上传者本人
OR
admin
```

---

# 17. 网易云 API 命名空间

不要让 `api-enhanced` 的接口直接裸露在根路径。

推荐统一：

```text
/api/netease/*
```

例如：

```text
/api/netease/search
/api/netease/song/detail
/api/netease/song/url/v1
/api/netease/lyric
/api/netease/user/detail
/api/netease/user/playlist
/api/netease/user/record
/api/netease/playlist/detail
/api/netease/album
```

所有网易云接口也应该经过：

```text
requireLogin
```

避免任何公网访问者无需账号直接调用或把本站当作网易云公开代理。

---

# 18. 两种音乐源的数据模型

## 18.1 数据源边界

以下内容必须保持独立：

| 层级 | 网易云音乐 | 本地音乐 |
|---|---|---|
| 源数据存储 | 不复制进本地音乐表，按需调用 vendor | SQLite 元数据 + `storage/music/` 文件 |
| API | `/api/netease/*` | `/api/local/*` |
| 来源标识 | `source = netease` | `source = local` |
| 播放地址 | 调用网易云播放地址接口动态解析 | 使用受保护的本地 `streamUrl` |

不得用相同的数据库表保存两类音乐源的业务实体，也不得把网易云 URL 当成本地文件路径保存。

## 18.2 统一播放器 Track 模型

两类 API 的原始响应可以不同，但进入前端展示、播放队列和用户操作层之前，必须转换为同一套模型：

```json
{
  "trackKey": "local:25",
  "source": "local",
  "sourceId": "25",
  "title": "Example",
  "artists": [
    {
      "id": null,
      "name": "Alice"
    }
  ],
  "album": {
    "id": null,
    "name": "Example Album"
  },
  "durationMs": 243000,
  "coverUrl": "/api/local/music/25/cover",
  "playable": true,
  "playback": {
    "kind": "local-stream",
    "url": "/api/local/music/25/stream"
  }
}
```

`trackKey` 必须由 `source + ':' + sourceId` 组成。这样网易云歌曲 `netease:25` 与本地歌曲 `local:25` 不会发生 ID 冲突。

网易云歌曲转换后使用相同字段；区别仅在 `source` 和播放地址解析方式：

```json
{
  "trackKey": "netease:123456",
  "source": "netease",
  "sourceId": "123456",
  "title": "Example",
  "artists": [
    {
      "id": "456",
      "name": "Artist"
    }
  ],
  "album": {
    "id": "789",
    "name": "Example Album"
  },
  "durationMs": 243000,
  "coverUrl": "https://example.invalid/cover.jpg",
  "playable": true,
  "playback": {
    "kind": "netease-resolve",
    "id": "123456",
    "level": "standard"
  }
}
```

统一模型是前端内部契约，不要求把网易云原始响应和本地数据库结构强行改成同一种格式。推荐分别实现：

```text
toPlayerTrackFromNetease(song)
toPlayerTrackFromLocal(song)
```

两个适配器输出同一种 `Track`，随后进入同一个展示组件、同一个播放队列和同一个播放器状态机。

## 18.3 单一播放器与播放队列

前端不得为本地音乐建立独立播放器。统一播放器只根据 `track.playback.kind` 解析最终 URL：

```js
async function resolvePlaybackUrl(track) {
  if (track.playback.kind === 'netease-resolve') {
    // 调用 /api/netease/song/url/v1
  } else if (track.playback.kind === 'local-stream') {
    // 直接使用受保护的 streamUrl
  }
}
```

这只是同一播放器的“地址解析适配器”，不是两套播放器。播放、暂停、上一首、下一首、进度、音量、循环和队列操作必须共享同一份状态。

## 18.4 统一用户操作

收藏、加入队列、移出队列、播放历史等用户操作统一以以下组合定位歌曲：

```text
(source, sourceId)
```

未来如果建立统一的收藏或播放历史表，只保存来源引用和操作数据，不复制或混合两类音乐的完整源数据。执行操作前由对应来源服务验证歌曲是否存在、是否可见和是否可播放。

---

# 19. 本地文件目录设计

推荐：

```text
storage/
├── music/
│   ├── 9d37b18e-....mp3
│   ├── 207caed2-....flac
│   └── ...
│
├── covers/
│
└── temp/
```

不要直接保存：

```text
周杰伦-晴天.mp3
```

作为实际文件名。

使用 UUID：

```text
550e8400-e29b-41d4-a716-446655440000.mp3
```

原始文件名存数据库。

---

# 20. 文件上传安全

公网版本至少限制：

```text
MP3
FLAC
WAV
M4A
OGG
```

建议最大：

```text
100 MB
```

同时校验：

```text
扩展名
+
客户端 MIME Type
+
文件头 / Magic Bytes 推断的真实类型
+
music-metadata 是否可解析
```

不允许上传：

```text
.exe
.sh
.js
.php
.html
```

即使文件扩展名被伪装，也应该尽量通过 MIME 与元数据解析进行二次确认。

公网上传还必须做到：

1. 反向代理和应用层同时限制请求体大小，两个限制保持一致或由代理略大于应用限制。
2. 单次请求只允许一个指定文件字段，限制表单字段数量、字段长度、上传频率和并发数。
3. 临时文件和最终文件都使用服务端生成的 UUID；原文件名只作为经过清理的展示或下载名称。
4. 音乐、封面和临时目录位于 Web Root 之外，目录不可执行，文件使用最小读写权限，不通过静态目录暴露。
5. 限制 Metadata 文本长度、封面体积和图片尺寸，拒绝损坏、异常复杂或解析超时的文件。
6. Metadata 解析、封面保存、数据库写入或删除事务失败时，清理所有临时文件和已生成文件。
7. 设置用户级上传速率、单文件大小和服务器总磁盘配额；磁盘接近阈值时停止新上传并告警。
8. 下载使用 `Content-Disposition`，媒体响应设置正确类型和 `X-Content-Type-Options: nosniff`。
9. 第一版可以不部署杀毒引擎，但保留后续接入 ClamAV 的位置；如果允许的文件类型或用户范围扩大，必须重新评估恶意文件扫描。

不要只相信客户端提供的扩展名和 MIME。底层原理是：扩展名只是文件名的一部分，MIME 也由客户端声明；文件签名和解析结果才能进一步确认内容是否确实像音频文件。

---

# 21. 网易云“解灰”功能

Open Music Club 第一版建议：

```env
ENABLE_GENERAL_UNBLOCK=false
```

理由：

1. 不是课程目标。
2. 增加接口复杂度。
3. 增加外部音源依赖。
4. 增加演示时不稳定因素。
5. 不应把绕过付费或版权限制设计为项目核心功能。

规则：

```text
网易云返回可播放 URL
→ 播放

网易云没有返回 URL
→ 提示“当前歌曲暂不可播放”
```

---

# 22. 推荐工程目录

```text
open-music-club/
│
├── package.json
├── pnpm-lock.yaml
├── .env
├── .env.example
├── README.md
│
├── src/
│   │
│   ├── app.js
│   ├── server.js
│   │
│   ├── config/
│   │   ├── database.js
│   │   ├── session.js
│   │   └── mail.js
│   │
│   ├── middleware/
│   │   ├── requireLogin.js
│   │   ├── requireAdmin.js
│   │   ├── errorHandler.js
│   │   └── uploadGuard.js
│   │
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── applications.routes.js
│   │   ├── admin.routes.js
│   │   ├── localMusic.routes.js
│   │   └── netease.routes.js
│   │
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── applications.controller.js
│   │   ├── admin.controller.js
│   │   └── localMusic.controller.js
│   │
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── mail.service.js
│   │   ├── music.service.js
│   │   └── metadata.service.js
│   │
│   └── db/
│       ├── init.js
│       └── migrations/
│
├── vendor/
│   └── api-enhanced/
│       ├── module/
│       ├── util/
│       ├── server.js
│       └── config/
│           └── open-music-modules.js
│
├── storage/
│   ├── music/
│   ├── covers/
│   └── temp/
│
├── data/
│   ├── open-music-club.sqlite
│   └── sessions.sqlite
│
└── tests/
    ├── auth.test.js
    ├── applications.test.js
    ├── localMusic.test.js
    └── netease.test.js
```

---

# 23. 环境变量

`.env.example`：

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1

PUBLIC_ORIGIN=https://music.example.com
TRUST_PROXY_HOPS=1

SESSION_SECRET=change-this-secret
TOTP_ENCRYPTION_KEY=replace-with-a-dedicated-32-byte-key

DATABASE_PATH=./data/open-music-club.sqlite

MAX_UPLOAD_MB=100

ADMIN_EMAIL=your-email@example.com

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=

ENABLE_GENERAL_UNBLOCK=false
```

注意：

`.env` 不提交 Git。生产密钥必须使用独立高强度随机值，通过部署平台 Secret、受限权限环境文件或密钥管理服务提供；开发、测试和生产环境不能复用密钥。

`PUBLIC_ORIGIN` 必须是唯一正式 HTTPS 来源，用于 CORS、CSRF Origin 校验和生成对外链接。`TRUST_PROXY_HOPS` 必须与实际反向代理层数一致，不能随意设大。

---

# 24. 公网 HTTPS 部署方式

推荐部署拓扑：

```text
公网 80/443
    ↓
Caddy / Nginx
    ↓
127.0.0.1:3000
    ↓
Open Music Club
```

Node.js 生产服务默认监听：

```text
127.0.0.1
```

如果使用容器，则只加入受保护的内部网络，不把 Node.js 端口直接映射到公网。防火墙仅开放：

```text
80/tcp   HTTP 跳转与 ACME
443/tcp  HTTPS
```

SSH 端口不对所有来源开放，建议限制管理 IP 或使用 VPN/密钥登录。数据库、Session Store、`storage/` 和任何调试端口都不得公网监听。

HTTPS 要求：

- 证书自动续期并监控续期失败。
- 支持 TLS 1.2/1.3，禁用过时协议和弱密码套件。
- HTTP 请求使用 301/308 跳转到 HTTPS，不在 HTTP 上创建 Session。
- HTTPS 稳定后启用 HSTS；确认所有子域都支持 HTTPS 前，不要贸然添加 `includeSubDomains` 或预加载。
- 反向代理保留 Range 请求与响应头，流媒体不应被完整缓冲到内存。

首次管理员 2FA 使用本机回环、SSH 隧道或一次性维护窗口完成引导；管理员成功启用 2FA 之前，不开放公网业务流量。这样可以避免为了初始设置而长期保留“管理员免 2FA”后门。

正式访问地址统一为：

```text
https://正式域名
```

---

# 25. 公网网络与应用安全

公网环境默认所有请求、Header、客户端 IP、文件和参数都不可信。

## 25.1 暴露面

1. 只公开反向代理的 80/443 端口，Node.js、SQLite、Session Store 和文件目录保持私有。
2. `/health` 对公网只返回简单存活状态，不返回版本、依赖、数据库和磁盘信息；详细健康检查仅供内部监控。
3. 删除 Express 技术标识响应头，不提供目录浏览、源映射、调试路由或开发错误页。
4. `/api/netease/*` 继续使用白名单，不能把 vendor 全部接口暴露到公网。
5. 管理接口必须同时经过 `requireLogin`、当前数据库角色检查和管理员 2FA 策略。

## 25.2 浏览器与 Session 防护

1. 全站 HTTPS，生产 Cookie 使用 `secure`、`httpOnly` 和 `sameSite=lax`。
2. POST、PUT、PATCH、DELETE 使用 CSRF Token，并校验 `Origin`/`Referer` 是否属于 `PUBLIC_ORIGIN`。
3. CORS 默认同源；确需跨域时只列出明确 HTTPS 来源，并禁止凭据配合 `*`。
4. 设置 CSP、HSTS、`X-Content-Type-Options: nosniff`、点击劫持防护和 Referrer Policy。
5. 登录成功、2FA 成功和权限变化时重新生成 Session ID；退出后销毁服务端 Session。

## 25.3 速率限制

至少分层限制：

- 全局 API：防止普通洪泛。
- 登录、2FA 和恢复码：按 IP 与账号组合限制，连续失败增加短时冷却。
- 访问申请：防止垃圾申请。
- 上传和下载：按用户限制频率、并发和流量。
- 网易云代理：限制单用户调用频率，避免本站被当作公开代理。

速率限制触发时返回统一 `429`，不要透露账号是否存在。若未来部署多个 Node 实例，计数需要迁移到共享存储；单实例阶段可以先使用进程内或 SQLite 方案。

## 25.4 公网错误和日志

公网错误响应只返回稳定的状态码、通用中文消息和可选请求 ID：

```json
{
  "success": false,
  "message": "服务器内部错误",
  "requestId": "..."
}
```

禁止返回：

- JavaScript 堆栈和异常对象。
- SQL、数据库路径和表结构细节。
- 服务器绝对路径、UUID 存储文件名和临时目录。
- 环境变量、密钥、Cookie、Session ID、TOTP 密钥或恢复码。
- 网易云上游 Cookie、代理配置和内部响应细节。

详细错误只写入受保护的服务端日志，通过请求 ID 与公网响应关联。日志必须脱敏并设置轮转和保留期限，避免磁盘被填满。

## 25.5 依赖、备份与运维

1. 使用 pnpm 锁文件进行可复现安装，定期执行生产依赖安全审计。
2. 高危或严重漏洞必须评估可利用性并安排修复，不允许长期静默忽略。
3. 数据库和上传文件需要定期备份；备份加密、限制权限，并实际演练恢复。
4. 数据库、Session、日志和存储目录使用独立低权限系统用户运行，避免以 root 启动 Node.js。
5. 监控证书有效期、5xx/429 比例、登录失败、2FA 失败、磁盘空间和异常上传量。

公网安全底线：

1. 所有业务接口要求登录，公开申请和认证接口只开放必要字段与方法。
2. 管理接口要求当前管理员身份和已启用的 2FA。
3. 文件、封面、数据库和 Session 不得通过静态目录或错误信息暴露。
4. Stream、下载和封面接口继续进行实时登录检查，并保留 Range 支持。
5. 认证、上传、下载和外部代理接口必须有限流、超时和资源上限。

---

# 26. 开发阶段路线

推荐分 8 个阶段。

---

## 阶段 0：项目初始化

目标：

建立 Open Music Club 独立仓库。

任务：

- 初始化 Git
- 初始化 pnpm
- 配置 Node.js
- 建立目录
- 配置 `.env`
- 配置 ESLint/Prettier（可选）
- 引入 SQLite

完成标准：

```bash
pnpm dev
```

可以启动：

```text
http://localhost:3000/health
```

本机开发和自动测试可以使用回环地址上的 HTTP；这一例外不能复制到公网生产环境。

返回：

```json
{
  "status": "ok"
}
```

---

# 阶段 1：精简 api-enhanced

目标：

只保留 Open Music Club 所需要的网易云接口。

任务：

1. 将 api-enhanced 作为 vendor / fork 代码引入。
2. 创建模块白名单。
3. 禁止自动加载全部 `module/*.js`。
4. 关闭 general unblock。
5. 将接口统一挂到 `/api/netease`。
6. 给网易云 API 加登录中间件。

验收：

至少可以成功调用：

```text
/api/netease/search
/api/netease/song/detail
/api/netease/song/url/v1
/api/netease/lyric
/api/netease/playlist/detail
```

---

# 阶段 2：数据库

目标：

建立项目自己的数据层。

任务：

创建：

```text
users
access_requests
uploaded_music
download_logs
```

实现：

```bash
pnpm db:init
```

自动初始化数据库。

验收：

数据库文件：

```text
data/open-music-club.sqlite
```

成功生成。

---

# 阶段 3：申请制账号

目标：

未授权成员不能进入。

任务：

- POST `/api/applications`
- 管理员查询申请
- approve
- reject
- 创建初始管理员
- bcrypt 密码
- Session 登录
- TOTP 2FA 设置、验证和恢复码
- 管理员强制启用 2FA
- logout
- `/api/auth/me`

验收流程：

```text
用户申请
→ admin 审批
→ 创建账号
→ 用户登录
→ 需要时完成 2FA
→ 获取 session
→ 成功访问受保护接口
```

---

# 阶段 4：邮件提醒

目标：

申请提交后给管理员发送通知。

实现：

```text
applications
     ↓
数据库
     ↓
mail.service
     ↓
SMTP
     ↓
管理员邮箱
```

注意：

邮件失败不能导致申请提交失败。

正确逻辑：

```text
申请保存成功
+
邮件发送失败
=
申请仍然有效
```

---

# 阶段 5：本地音乐共享

目标：

实现第二类音乐源。

任务：

- 上传
- UUID 文件名
- music-metadata
- 写数据库
- 音乐列表
- 音乐详情
- 删除
- 下载
- 列表和详情返回 `source=local`、`sourceId`、结构化歌手/专辑、`durationMs`、`coverUrl`、`streamUrl`、`playable` 等统一转换字段
- 不暴露真实文件路径，保持 `/api/local/*` 与 `/api/netease/*` 独立

验收：

用户 A 上传：

```text
song.mp3
```

用户 B 登录后能够：

```text
查询
播放
下载
```

并且本地音乐响应可以直接转换为第 18 节定义的统一 `Track`，无需为本地音乐设计另一套前端播放器数据结构。

---

# 阶段 6：流媒体播放

目标：

支持浏览器标准音频播放器，并用同一个播放器消费网易云音乐和本地音乐。

必须实现：

```text
HTTP Range
206 Partial Content
Content-Range
Accept-Ranges
```

验收：

播放器能够：

- 播放
- 暂停
- 快进
- 后退
- 拖动进度条

统一验收还必须覆盖：

- 网易云歌曲和本地歌曲可以同时存在于同一个播放队列。
- 上一首、下一首跨越不同来源时仍使用同一个播放器实例和状态。
- 播放器根据 `playback.kind` 解析地址，不按来源创建两个音频组件。
- 收藏、加入队列、移除队列等操作统一使用 `(source, sourceId)`。
- 本地音乐的流媒体请求仍经过登录与权限检查。

---

# 阶段 7：系统整合与权限测试

完整验证：

```text
未登录
→ 不能访问音乐

普通用户
→ 能播放
→ 能上传
→ 能下载
→ 只能删除自己的文件

管理员
→ 能审核
→ 能管理用户
→ 能删除所有上传音乐
→ 必须完成 2FA 才能进入正式管理员会话
```

公网安全测试：

```text
HTTP → HTTPS 跳转
Secure Cookie 不经 HTTP 发送
CSRF 请求被拒绝
错误响应不含堆栈或内部路径
登录 / 2FA / 上传限流生效
伪造 X-Forwarded-For 不能绕过限流或审计
数据库、storage 与 Node.js 端口无法从公网直接访问
```

跨来源整合测试：

```text
搜索或选择网易云歌曲
→ 加入统一队列
→ 再加入本地歌曲
→ 使用同一播放器连续播放
→ 队列项通过 trackKey 正确区分来源
→ 用户操作不会把网易云 ID 与本地 ID 混淆
```

---

# 阶段 8：公网 HTTPS 部署

任务：

- Node.js 使用 `HOST=127.0.0.1` 或受保护容器网络
- 配置 Caddy/Nginx 和自动续期证书
- 防火墙仅开放必要端口
- 配置精确 `trust proxy`
- 启用 Secure Cookie、HSTS、CSP、CSRF 和 CORS 白名单
- 配置登录、2FA、申请、上传、下载和网易云代理限流
- 验证管理员已经启用 2FA
- 文件上传测试
- 网易云接口测试
- Session 测试
- 公网错误脱敏和日志轮转测试
- 数据库与上传文件备份恢复演练

最终访问：

```text
https://<正式域名>
```

---

# 27. 推荐开发顺序

不要同时开发全部功能。

严格建议：

```text
1. 项目启动
↓
2. SQLite
↓
3. Session 登录
↓
4. 申请审核
↓
5. api-enhanced 白名单
↓
6. 网易云歌曲搜索/播放
↓
7. 本地上传
↓
8. 本地播放
↓
9. 下载
↓
10. 邮件通知
↓
11. 权限完善
↓
12. 2FA 与公网安全加固
↓
13. HTTPS 反向代理与公网联调
↓
14. 前端 UI
```

邮件功能不要放在最前面。

邮件属于附加通知系统，不应该阻挡核心开发。

---

# 28. 测试建议

前端完成前，使用：

- Postman
- Bruno
- Insomnia
- curl

测试 API。

例如：

```bash
curl https://正式域名/health
```

登录：

```bash
curl \
  -X POST \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"admin@example.com","password":"123456"}' \
  https://正式域名/api/auth/login
```

继续携带 Session：

```bash
curl \
  -b cookies.txt \
  https://正式域名/api/auth/me
```

不要在公网验收中使用 `curl -k` 跳过证书校验。还需要自动化覆盖：

- HTTP 自动跳转 HTTPS，生产 Cookie 包含 `Secure`、`HttpOnly` 和正确的 `SameSite`。
- 密码正确但 2FA 未完成时不能访问受保护接口。
- TOTP、恢复码、过期验证码、重复使用恢复码和连续失败限流。
- 管理员未启用 2FA 时不能通过公网部署验收。
- CSRF、CORS 白名单和伪造代理 Header。
- 公网 400/401/403/404/409/413/429/500/502 响应不含堆栈、SQL、磁盘路径或密钥。
- 恶意文件名、伪造扩展名/MIME、错误 Magic Bytes、超大文件、损坏 Metadata 和上传中断后的清理。
- 反向代理下的完整播放、Range 206、下载和连接中断。

---

# 29. Git 分支建议

小组课程作业建议：

```text
main
│
├── dev
│
├── feature/auth
├── feature/applications
├── feature/netease
├── feature/local-music
└── feature/mail
```

开发流程：

```text
feature/*
↓
dev
↓
测试
↓
main
```

不要所有人直接 push main。

---

# 30. 最低可用版本 MVP

如果时间有限，MVP 只需要：

### 身份

- admin
- 申请
- 审核
- 登录
- Session
- 管理员 TOTP 2FA 和恢复码

### 网易云

- 搜索
- 歌曲详情
- 播放
- 歌词
- 用户歌单

### 本地音乐

- 上传
- 列表
- 播放
- 下载
- 删除
- 返回可转换为统一 `Track` 的完整字段

### 统一播放体验

- 一个播放器
- 一个可混合来源的播放队列
- 一套收藏、队列和播放历史操作语义
- 使用 `source + sourceId` 避免跨来源 ID 冲突

### 部署

- 正式域名 HTTPS 可访问，HTTP 自动跳转
- Node.js、数据库、Session 和文件目录不直接暴露
- Secure Cookie、CSRF、限流和错误脱敏通过验收

达到以上要求，就已经是一个完整可演示的课程项目。

---

# 31. 第二阶段可扩展功能

第一版稳定以后再考虑：

- 用户头像
- 修改密码
- 本地音乐收藏
- 本地音乐搜索
- 标签
- 文件哈希去重
- 上传封面
- 自动封面提取
- 本地播放历史
- 下载排行榜
- 管理员磁盘占用统计
- 申请备注
- 登录日志
- 操作日志
- 前端播放器
- 响应式 UI
- PWA
- Docker 部署
- WebAuthn / Passkey
- 集中式日志与告警平台
- ClamAV 文件扫描

---

# 32. 风险点

## api-enhanced 变化

非官方接口可能变化。

处理：

- 锁定课程演示版本。
- 不在演示前临时升级依赖。
- 核心演示不要只依赖网易云。
- 本地上传音乐可以作为备用演示数据。

---

## 网易云播放 URL 失效

处理：

```text
无法播放
→ 前端显示“当前歌曲暂不可播放”
```

不要让整个页面崩溃。

---

## 文件占满磁盘

处理：

- 单文件 100 MB
- 可增加总容量限制
- 管理员可以删除
- 后续加入磁盘统计

---

## Session 被绕过

所有受保护 API 都必须使用：

```text
requireLogin
```

管理员 API：

```text
requireLogin
+
requireAdmin
```

不能只在前端隐藏按钮。

---

## 登录和 2FA 暴力尝试

处理：

- 登录和 2FA 使用 IP + 账号组合限流。
- 错误信息不区分账号不存在、密码错误或验证码错误的内部细节。
- 待验证 2FA Session 设置短过期时间和最大失败次数。
- 管理员恢复 2FA 必须记录审计日志，不能通过普通客服式接口直接关闭。

---

## HTTPS 或反向代理配置错误

处理：

- Node.js 不直接监听公网地址。
- `trust proxy` 按实际代理跳数配置，不信任任意来源的转发 Header。
- 自动监控证书续期；证书失效时告警。
- 生产环境启动检查 Secure Cookie、正式 Origin 和密钥是否已配置。

---

## 公网错误信息泄漏

处理：

- 统一错误处理中间件只向客户端返回通用消息和请求 ID。
- 详细堆栈仅进入受保护且脱敏的服务端日志。
- 自动化测试扫描错误响应，确保没有数据库路径、文件路径、环境变量和上游凭据。

---

## 恶意上传与资源耗尽

处理：

- 反向代理与应用双重限制体积、数量、速率和超时。
- 校验扩展名、声明 MIME、文件签名与 Metadata 解析结果。
- 设置磁盘阈值和用户配额，失败后清理临时文件。
- 运行进程和存储目录使用最小权限，上传文件不可执行。

---

# 33. 课程报告可以重点讲什么

Open Music Club 的课程设计价值并不是“做了一个播放器”，而是：

```text
受控用户访问
+
第三方音乐 API 集成
+
公网 HTTPS 与反向代理
+
文件上传与存储
+
HTTPS 下的 HTTP Range 流媒体
+
Session 身份认证
+
TOTP 双因素认证
+
RBAC 权限控制
+
数据库管理
+
用户间资源共享
```

这比单纯套一个网易云 API 更接近完整的信息系统。

---

# 34. 最终项目定位

推荐在课程报告中定义为：

> **Open Music Club 是一个面向小型受控成员群体、通过公网 HTTPS 提供服务的音乐共享与播放平台。系统采用申请制账号、Session 与 TOTP 双因素认证，通过权限控制和安全上传限制保护访问范围，并整合精简后的第三方音乐信息接口与自建本地音乐资源库，实现在线音乐查询、本地音乐上传、播放和下载等功能。**

不要把项目描述为：

```text
免费破解音乐网站
```

也不要把：

```text
会员歌曲解锁
版权限制绕过
```

作为项目卖点。

---

# 35. 第一阶段完成后的目标目录

最终后端应该能够做到：

```text
Open Music Club Server
│
├── 用户系统
│   ├── 申请
│   ├── 审核
│   ├── 登录
│   ├── 2FA
│   └── 权限
│
├── 网易云音乐
│   ├── 用户
│   ├── 歌单
│   ├── 搜索
│   ├── 歌曲
│   ├── 歌词
│   ├── 歌手
│   └── 专辑
│
├── 本地音乐
│   ├── 上传
│   ├── Metadata
│   ├── 在线播放
│   ├── 下载
│   └── 删除
│
├── 数据库
│
├── Session
│
├── HTTPS 反向代理
│
└── 公网安全防护
```

前端 UI 等以上模块稳定以后再开始。

---

# 36. 公网转型的第一批实际开发任务

现有认证、网易云白名单和本地音乐模块保留，公网转型按下列顺序逐项验收：

```text
[ ] 1. 盘点现有公网暴露面和生产密钥
[ ] 2. 建立 Caddy/Nginx HTTPS 反向代理，Node.js 改为内部监听
[ ] 3. 配置精确 trust proxy、Secure Cookie、Session 过期与撤销
[ ] 4. 统一公网错误脱敏、请求 ID 和安全日志
[ ] 5. 实现 TOTP 2FA、恢复码和管理员强制策略
[ ] 6. 增加 CSRF、同源 CORS 和安全响应头
[ ] 7. 增加登录、2FA、申请、上传、下载和网易云代理限流
[ ] 8. 加强文件签名、Metadata、封面、配额和失败清理校验
[ ] 9. 完成 HTTPS、认证、错误响应、上传和权限安全测试
[ ] 10. 完成备份恢复、证书续期、监控和公网部署验收
```

核心工程纪律仍然是每轮只完成一个可独立验收的安全功能，不能把 2FA、HTTPS、上传重构和前端改造混在同一次提交中。

---

# 37. 推荐版本目标

## v0.1

```text
服务器 + SQLite + admin 登录
```

## v0.2

```text
申请 + 审核 + 用户登录
```

## v0.3

```text
精简 api-enhanced
```

## v0.4

```text
网易云搜索 + 播放 + 歌单
```

## v0.5

```text
本地音乐上传 + 下载
```

## v0.6

```text
Range 在线播放
```

## v0.7

```text
邮件提醒 + 权限完善
```

## v0.8

```text
TOTP 2FA + 公网安全加固
```

## v0.9

```text
前端 UI
```

## v1.0

```text
HTTPS 公网部署版本
```

---

# 38. 当前阶段结论

Open Music Club 当前最合理的工程路线是：

```text
先做一个稳定的后端系统
        ↓
申请制用户认证
        ↓
精简网易云 API
        ↓
独立的本地音乐共享库
        ↓
TOTP 2FA 与公网安全加固
        ↓
HTTPS 反向代理部署
        ↓
测试
        ↓
最后再设计 UI
```

核心原则：

> **网易云音乐是外部音乐数据源，本地上传音乐是 Open Music Club 自己管理的资源。两者在存储、API 和来源标识层保持独立，在前端展示、播放队列和用户操作层通过统一 Track 模型协作；系统始终只使用一个播放器，不为本地音乐建立第二套播放链路。公网只暴露经过 HTTPS、认证、限流和错误脱敏保护的必要接口。**

这将使项目后续扩展、维护和课程展示都更清晰。
