# 小规模分区部署方案：海外 Nginx、国内 Express、WireGuard

更新日期：2026-10-23。对象：`webkk.xyz`，不超过 5 名受控成员，以网易云音乐为主。

**本文是方案，不代表已经部署。仅完成只读服务器/代码/DNS检查；没有安装软件、修改 DNS、安全组、路由或运行服务。用户指定使用 WireGuard，ZeroTier 不用于应用链路。**

## 1. 结论与合规前提

技术上建议采用：韩国 Azure 提供 HTTPS 入口与 React 静态资源，通过 WireGuard 访问成都阿里云的完整 Express；SQLite、Redis、音乐文件和网易云模块全部留在国内。无需改成跨域 API，也无需拆分现有登录、2FA、播放器或音乐来源逻辑。

但不能把它定性为“已确认可绕开 ICP 备案”。阿里云官方区分境内、境外服务器的备案要求；通信管理部门对境内提供互联网信息服务有备案要求。这些公开材料没有明确替本项目的“海外入口＋境内完整业务后端”作出豁免判断。**国内服务未直接开放公网，也不等于已取得合规豁免；上线前应向阿里云接入/备案支持确认这种实际业务部署是否允许。**这是技术可行性与合规结论的区别，不用更换端口或隐藏域名来规避服务商要求。[阿里云备案说明](https://help.aliyun.com/en/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview)、[通信管理局服务指南](https://hunca.miit.gov.cn/bsfw/bszn/art/2024/art_7ef0d8bd3b0d433ba4b9b277f883f74d.html)

不超过 5 人是资源规划条件，不作为备案、版权或其他责任的豁免依据。仅邀请明确授权的成员，不开放公共注册；不承诺解除网易云的版权、地区或 VIP 限制。若混合部署不获服务商确认，先限于管理通道内验证，之后选择办理适用备案，或另外讨论把业务后端也迁出、仅保留经确认允许的国内适配服务；不能把替代方案当作已经获批实施。

## 2. 已核实的服务器条件

以下为本轮 SSH、系统命令和云元数据读取得到的快照，不是云控制台套餐/配额证明。

| 项目 | 国内 `aliyun` | 海外 `kk-server` |
| --- | --- | --- |
| 地域 | 阿里云 `cn-chengdu` | Azure `KoreaCentral`，韩国首尔 |
| 实例规格元数据 | `ecs.e-c1m1.large` | `Standard_B2ats_v2` |
| SSH | 已有别名；通过现有管理网络连接 | `kk@20.214.157.62`，已验证密钥登录 |
| 系统 | Ubuntu 26.04.1 LTS，x86_64 | Ubuntu 24.04.4 LTS，x86_64 |
| CPU | 系统可见 2 vCPU | 系统可见 2 vCPU |
| 内存 | 总计 1735 MiB，快照 available 约 997 MiB | 总计 842 MiB，快照 available 约 430 MiB |
| Swap | 4 GiB，其中约 1.1 GiB 已使用；短时采样不代表持续压力 | 未配置 |
| 根磁盘 | 40 GiB，总体剩余约 19 GiB | 29 GiB，总体剩余约 26 GiB |
| 软件 | Node 22.22.1、Nginx 1.28.3、Docker；当前 PATH 未找到 pnpm/Redis | 当前 PATH 未找到 Node/pnpm/Nginx/Docker/Redis |
| WireGuard | 内核模块存在；未找到 `wg`/`wg-quick`，未发现已建接口 | 内核模块存在；未找到 `wg`/`wg-quick`，未发现已建接口 |
| 已有业务 | Nginx、1Panel、AstrBot、NapCat 等 | 只观察到 SSH 和本机 DNS 监听；80/443 未监听 |

国内的两个现有机器人容器在本次采样约占 195 MiB 和 273 MiB，配置的容器内存上限各 800 MiB；不能把当前空闲量当作未来永远可用的预算。`3001/6099` 属于 NapCat，`6185` 属于 AstrBot，`10086` 属于 1Panel；**它们不是本项目的网易云接口，不能覆盖或随意关闭**。本轮不对这些已有端口作公网可达或安全性结论，未审查其安全组/访问控制。

国内 SSH 一次 8 秒连接超时，重试成功；当时本机管理路由仍指向原 ZeroTier 网卡。不能据此认定是代理配置错误，更不能据此认定新 WireGuard 已稳定。

资源判断：海外只运行 Nginx、证书续期和 WireGuard，可作为这轮测试的起点；国内新增单进程 Express 与小型 Redis，需要实测峰值及对机器人服务的影响，不保证已有机器一定无需升级。两台云主机的出口带宽、月流量、突发 CPU 配额及公网 IP 是否固定，仍需控制台确认。

## 3. 域名和整体流向

本轮从海外通过公共 DoH 查询：`webkk.xyz` 的 A、AAAA 均没有回答记录；NS 指向 Cloudflare。本机代理返回过 `198.18.x.x` Fake-IP，该地址不是网站真实服务器地址，不能用于发布配置。

建议首次部署的 DNS 目标：

| 项目 | 建议值 |
| --- | --- |
| 主域名 | `webkk.xyz`，不另加 API 子域名 |
| A | 指向 `20.214.157.62`；先确认该 Azure 公网 IP 保留/静态分配 |
| Cloudflare | 先采用 DNS-only（灰云），不增加 HTTP 代理层 |
| AAAA | 暂不添加；待 IPv6、证书与防火墙完整验证后再决定 |
| www | 初期不启用；不擅自加入第二个 Origin |

DNS-only 下 Cloudflare 仅负责解析，HTTP/HTTPS 直接到 Azure；以后启用橙云，必须另外处理真实客户端 IP、访问限制、超时、上传大小、缓存和代理信任，不能只切按钮。[Cloudflare 官方说明](https://developers.cloudflare.com/dns/proxy-status/)

```text
成员浏览器 ── HTTPS webkk.xyz ──> 韩国 Azure：Nginx + React dist
                                    │
                                    └── WireGuard 加密链路 ──> 成都：Express
                                                                   ├── SQLite / storage
                                                                   ├── 本机 Redis
                                                                   └── 国内出口请求网易云 API

成员浏览器 ── HTTPS 音频/封面 ────────────────────────────────> 网易云 CDN
```

海外不是“只保存静态文件就看不到业务数据”：Nginx 还会终止 TLS、转发登录请求与 Cookie。数据库不在海外，但请求数据仍会经过海外节点；应告知测试成员并确认适用的数据处理要求，不在海外日志保存密码、验证码、恢复码、Cookie 或响应正文。

## 4. WireGuard：两台主机的专用隧道

### 4.1 拓扑与路由

拟定接口 `omc-wg`，配置位于各自的 `/etc/wireguard/omc-wg.conf`：

| 节点 | 隧道地址 | 角色 |
| --- | --- | --- |
| 韩国 Azure | `10.77.0.1/32` | 公网 UDP `51820` 接收端 |
| 成都阿里云 | `10.77.0.2/32` | 主动连接 `20.214.157.62:51820`，维持 NAT 映射 |

这两个地址未与本轮看到的两机 IPv4 路由冲突，实施前仍需复核。WireGuard 直接连接两机，不经过用户电脑，不需要每个成员安装客户端。

只配置对端 `/32` 的 AllowedIPs；**不配置 `0.0.0.0/0`、`::/0`，不修改系统默认网关或 DNS，不添加 MASQUERADE，不启用 IP 转发**。Nginx 与 Express 都是隧道终端，不是给整台机器代理上网。如此国内的网易云请求继续从阿里云本地出口发起。`wg-quick` 会按 AllowedIPs 添加路由，这不是单纯“访问名单”。[WireGuard 官方手册](https://git.zx2c4.com/wireguard-tools/about/src/man/wg-quick.8)

海外配置草案（占位符必须替换，本文不包含任何真实密钥）：

```ini
[Interface]
Address = 10.77.0.1/32
ListenPort = 51820
PrivateKey = <海外节点自己的私钥>

[Peer]
PublicKey = <国内节点公钥>
AllowedIPs = 10.77.0.2/32
```

国内配置草案：

```ini
[Interface]
Address = 10.77.0.2/32
PrivateKey = <国内节点自己的私钥>

[Peer]
PublicKey = <海外节点公钥>
Endpoint = 20.214.157.62:51820
AllowedIPs = 10.77.0.1/32
PersistentKeepalive = 25
```

国内主动连接，海外无需预先写国内公网 Endpoint。25 秒 keepalive 是针对可能存在的 NAT 的起始设置，不是稳定性保证；密钥在各自服务器安全生成，仅交换公钥。配置 root 所有、权限 0600，不进入 Git，不用 `wg showconf`、`wg show ... dump` 公开输出私钥。[WireGuard 官方快速开始与 NAT 说明](https://www.wireguard.com/quickstart/)

MTU 先由工具计算；出现“小请求成功、大请求卡住”时再依据实测调整，不预先修改现有网卡/默认路由。WireGuard 不自带 ZeroTier 的公共中继/打洞平台；UDP 被运营商或安全策略阻断时，这个方案可能无法直接建立，届时暂停并重新讨论，不悄悄切换传输或全局代理。

### 4.2 网络边界

- Azure：只新增本方案必需的 TCP 80/443 和 UDP 51820；SSH 保持管理来源限制。UDP 如能确认国内固定出口，进一步限制来源；否则需单独确认仅开放该 UDP 端口并以 peer 密钥认证的策略。
- 国内：Express 仅绑定 `10.77.0.2:3000`；只允许 `omc-wg` 入站、源 `10.77.0.1`、目标 TCP 3000。不能只依赖“IP 是内网地址”。
- Redis 只监听回环；SQLite 和 storage 不设网络共享；不对公网开放 3000/6379。
- 对本方案不新增国内公网 80/443 业务入口；原有 Nginx/1Panel/机器人端口不在本轮改动范围。云安全组与主机防火墙分别验证。
- 不重置 UFW/iptables/nftables，不清空 Docker 规则。现有 ZeroTier 仅保留管理用途；新服务不绑定 `172.29.50.45`，不以它作为断线回退地址。

## 5. 国内：完整后端及持久数据

### 5.1 进程与运行环境

建议首轮采用 **独立非 root 系统账号＋systemd 管理单个 Node 进程＋本机 Redis**，不同时引入 PM2、Kubernetes、集群或第二套网易云 HTTP 服务。

仓库 `.node-version` 固定 `26.0.0`，根 packageManager 固定 `pnpm@12.3.4`，虽 engines 接受 Node >=22，仍应先按锁定环境构建验收。国内现有 `/usr/bin/node` 为 22.22.1，**不要直接升级替换它影响已有服务**；为 OMC 准备独立运行时路径。发布前核对所选运行时的安全维护状态，需要调整版本时单独验证，而不是静默换版本。

在本机/CI 完成前端构建和全套验收；不在 842 MiB 的海外机器执行 pnpm/Vite/Playwright。国内只准备目标 Linux x86_64 的生产依赖。`bcrypt`、`better-sqlite3`、`sharp` 存在原生依赖，不能复制 macOS 的 node_modules；安装/预编译下载失败不能通过跳过构建脚本来掩盖。

国内发布包需要 `src/`、根 package/锁文件/workspace 配置以及初始化后的 `vendor/api-enhanced` 子模块和必要依赖；不是只上传 src。保留同一提交的实际 workspace 结构和成员清单（包括 `frontend/package.json`），不凭经验裁剪后再指望冻结安装等价；国内无需运行前端源码或提供 dist。`pnpm install --prod --frozen-lockfile` 是目标生产安装方向，完整冻结安装/测试仍在构建端完成。若目标机原生编译资源不足，停止并讨论可复现 Linux 构建产物，不当场改动全局工具链。

`src/server.js` 已在同一 Node 进程初始化网易云模块；不需要另启第三方 `app.js` 或占用现有 3001。

### 5.2 目录和配置

建议目录（尚未创建）：

```text
/srv/open-music-club/
├── releases/<发布SHA>/       后端运行代码、workspace及生产依赖
├── current -> releases/...  systemd WorkingDirectory
└── shared/
    ├── data/                SQLite
    ├── storage/             music / covers / temp
    └── runtime-tmp/         网易云匿名运行配置的专用临时目录

/etc/open-music-club.env     root 管理的私有环境文件
```

各 release 下 `storage` 指向同一持久目录。当前代码**没有 `STORAGE_PATH` 环境变量**，实际默认由 WorkingDirectory 下的 storage 决定；不能虚构一个变量后以为上传已持久化。

环境草案：

```dotenv
NODE_ENV=production
HOST=10.77.0.2
PORT=3000
PUBLIC_ORIGIN=https://webkk.xyz
TRUST_PROXY_HOPS=1
SESSION_SECRET=<独立长期随机值>
SESSION_IDLE_TIMEOUT_MINUTES=480
DATABASE_PATH=/srv/open-music-club/shared/data/open-music-club.sqlite
REDIS_URL=redis://127.0.0.1:6379
TOTP_ENCRYPTION_KEY=<独立32字节随机密钥的标准Base64>
TMPDIR=/srv/open-music-club/shared/runtime-tmp
MAX_UPLOAD_MB=100
REQUEST_TIMEOUT_MS=300000
HEADERS_TIMEOUT_MS=10000
KEEP_ALIVE_TIMEOUT_MS=5000
MAIL_ENABLED=false
ENABLE_GENERAL_UNBLOCK=false
```

- `HOST` 改为隧道地址，否则默认 127.0.0.1 无法被海外代理连接；不能改为公网 `0.0.0.0` 图方便。
- 超时 300000 是兼容保留的较大上传的建议，并非源码当前默认 30000；部署时需实测。没有因此放宽上传格式/签名/数量或 JSON 限制。
- `TMPDIR` 是运行时临时目录，不是持久用户数据；配合 systemd 可写目录权限，首次网易云初始化可能需要出网，失败时服务可启动但网易云返回 502。
- 解灰仍保持现有业务白名单/参数限制；不能把环境变量当成全部解灰防护，更不能接入 NapCat 的 3001 充当音乐接口。
- Redis 生产环境必需；项目校验其 URL 为回环地址。建议独立实例或独立配置，AOF everysec、明确持久目录，初始 maxmemory 可设 64 MiB、noeviction，内存占满时告警，不能悄悄淘汰限流/Session。此值是试运行预算，不是实测容量结论。
- systemd 依赖网络就绪、`wg-quick@omc-wg` 和实际 Redis unit；用绝对 Node 路径、非 root 运行，自动重启但有重试上限，限制写入至 shared。隧道服务停止时应停止/重启依赖的 OMC；握手断开但接口仍在时 Nginx 明确失败，不能回退公网后端。
- 先观察 OMC RSS 与现有容器峰值，再决定 MemoryHigh/MemoryMax；不以固定低内存上限导致随机 OOM，亦不重配原机器人内存。

首次管理员通过现有 `pnpm db:init` 初始化，使用专用初始化凭据，不放进 Azure 或 Git；启动不等于自动创建管理员。生产管理员首次登录必须完成 TOTP 绑定后才取得业务权限；离线保存恢复码。两机时间同步必须正常。邮件先关闭；用户审批仍可使用已有管理 API，不假设已有完整管理 UI。

## 6. 海外：Nginx 和 React 静态资源

### 6.1 HTTPS、静态站与缓存

- 安装受维护的发行版 Nginx、证书续期工具及 wireguard-tools；不运行 Node 应用、数据库或 Redis。
- 只上传同一发布 SHA 构建的 `frontend/dist` 完整内容；不上传 `.env`、源码仓库、数据库或用户文件。
- 为 `webkk.xyz` 签发公开可信证书，启用自动续期和续期后校验/reload。HTTP 仅做 HTTPS 308 跳转或 ACME 挑战，不提供明文业务页面；拒绝无关 Host。
- 前端入口/theme-init.js/theme.css 要及时重新验证；不要一年缓存非 hash 文件。
- 带 hash 的 JS/CSS 才使用长缓存/immutable，并保留上版 hash 文件，避免老页面懒加载新视图时遇到 404。
- 当前产物约 5.8 MiB，其中 `assets/archive-cassette.glb` 约 4.1 MiB，**该模型文件名不带 hash**。即使在 assets 目录也不该整目录统一一年 immutable；先用短缓存/ETag。
- `/api` 不设置共享缓存；保留上游认证/私有缓存头，不能缓存 Set-Cookie 或按忽略 Cookie 的键缓存 JSON。

推荐海外 `releases/<SHA>`＋`current` 布局；带 hash 的 JS/CSS 可以单独放只读 `shared/assets`，以相同 URL 保留最近两版/试运行周期的文件。仅以经过核对的 hash 规则指向该目录；非 hash 的模型和主题文件仍从当前 release 提供，不与后端 shared 数据目录混用。

当前 Express 不托管首页，仓库旧 Caddy 模板“全量反代 Node”不能直接照搬；Vite 开发代理也不会进入 dist。Nginx 必须区分静态站与 API，例如以下是路由关键片段，**不是已经过 nginx -t 的完整站点配置**：

```nginx
location = /api { return 404; }
location ^~ /api/ {
    proxy_pass http://10.77.0.2:3000;
    proxy_http_version 1.1;
    proxy_set_header Host webkk.xyz;
    proxy_set_header X-Forwarded-Host webkk.xyz;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Forwarded "";
    proxy_set_header Connection "";
    proxy_cache off;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_next_upstream off;
    proxy_connect_timeout 10s;
    proxy_read_timeout 120s;
    proxy_send_timeout 300s;
}
location = /health { return 404; }
location / {
    try_files $uri $uri/ /index.html;
}
```

完整配置还需 TLS、Host 拒绝、安全头、各类静态文件缓存/真实 404、压缩和日志。上游 `proxy_pass` 没有结尾 URI `/`，保证 `/api/...` 不被删掉；API 失败不做 SPA fallback，不重试写请求。100 MiB 音频上传仍保留时，站点 `client_max_body_size` 建议 110m；上传读取空闲超时与 Node requestTimeout 一并测试，不能靠把请求缓冲区调成巨大内存值来解决跨境上传。[Nginx 代理模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[核心模块](https://nginx.org/en/docs/http/ngx_http_core_module.html)

### 6.2 Session、代理信任与响应头

只有一个 HTTP 代理：Azure Nginx。**WireGuard 不计 HTTP 层数，`TRUST_PROXY_HOPS=1`。**国内不再叠一个 Nginx/Caddy；以后增加代理必须重新审计整条链，不能无条件信任全部来源。入口覆盖客户端传来的 Forwarded/X-Forwarded-*，并通过第 4 节 ACL 确保只有入口能访问 Express，才能安全使用数字跳数。[Express 官方代理说明](https://expressjs.com/en/guide/behind-proxies/)

浏览器只见 `https://webkk.xyz/api/...`，现有相对路径、`credentials: same-origin`、CSRF Origin 和 HttpOnly Session 保持不变。不需要新建 API 域名、VITE_API_URL、通配 CORS 或 Cookie Domain。生产 Cookie 保持 `__Host-`、Secure、HttpOnly、SameSite=Lax、Path=/；密码/2FA 成功后的 Session ID 轮换沿用现有逻辑。不能删 Cookie/Set-Cookie，也不能把 Origin 改成隧道地址。

Express/Helmet 的头只覆盖其响应，**不能保护 Nginx 提供的 HTML**。海外需为静态页面及本地错误配置 CSP、HSTS、nosniff、DENY 和 no-referrer；TLS 仅 1.2/1.3。CSP 草案应保留 script-src self，style-src 兼容现有动态样式，img-src 支持 self/data/blob 及受限网易云域名（上传预览会产生 blob URL），media-src 仅 self 与网易云 CDN；不开放任意脚本或 unsafe-eval。最终以登录液态玻璃、头像、上传封面、2FA 二维码及播放器实测为准。

Nginx `add_header` 在子 location 定义新头时可能不继承父级集合；对缓存 location 逐项检查/复用安全头片段。API 如与上游头重复，应明确单一权威或保持相容，不让两条不同 CSP 叠加阻断页面。不可假设未安装的 Nginx 支持较新 `add_header_inherit` 指令。[Nginx 响应头文档](https://nginx.org/en/docs/http/ngx_http_headers_module.html)、[TLS 文档](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)

## 7. 音乐流量与性能预期

| 内容 | 实际线路 |
| --- | --- |
| React/Three.js 代码、模型、站点静态资源 | 浏览器 ↔ Azure |
| 登录/2FA、搜索、歌词、播放地址 JSON、歌单/收藏、音乐足迹 | 浏览器 ↔ Azure ↔ WireGuard ↔ 国内 Express |
| 网易云音频及封面 | 浏览器 ↔ 网易云 CDN；不是经 Azure/国内 Express 转发音频 |
| 上传音频/封面、头像、本地歌曲播放/下载 | 浏览器 ↔ Azure ↔ WireGuard ↔ 国内 Express/存储 |

依据：`frontend/src/services/music/search.ts` 的 resolvePlaybackUrl 给 audio 返回网易云 HTTPS CDN URL，本地来源返回 `/api/local/music/:id/stream`；player-core 使用同一个 Audio；上传/下载仍经过受鉴权 Express 接口。Nginx 透传 Range/If-Range 与 206/416，不用静态 alias 暴露 storage，也不缓存受保护的音频。

国内 API 出口只是满足上游请求位置的必要条件之一，不能保证匿名接口、每首歌或海外成员的 CDN 播放都成功。不要为“可能稳定”自动增加通用媒体代理、开放第三方全部接口、启用解灰或保存他人网易云 Cookie。

5 人各播放 320 kbps 音频约合 1.6 Mbps、每小时 720 MB（十进制），但网易云直连时这部分不经过 Azure。若换成本地上传歌曲，它才进入两机间的转发和云出口预算。实际音质、重试、缓存命中、套餐计费均未实测，不能据此承诺费用或带宽余量。

前端 WebGL 动画仍由成员电脑渲染，Nginx 不替用户计算 3D；海外节点主要影响首屏下载、API 跨境延迟与本地音频传输。首轮观察 TTFB、5xx、WG 握手/丢包、Node RSS、Redis 内存、磁盘和现有机器人稳定性，不预先宣称性能提升。

## 8. 发布、备份和回退

目前集成分支有未提交的音乐足迹前后端文件，HEAD `1c96639` 不包含它们。上轮本地构建、350 项测试、5 个浏览器流程通过是隔离环境证据，**不是本轮两台服务器的部署验收**。用户先确认并提交完整候选，再固定发布 SHA；前后端必须来自同一 SHA，禁止当前 dist 配旧 HEAD 后端。

建议顺序：

1. 确认服务商合规意见、Cloudflare/Azure 安全组权限、公网 IP 保留和带宽配额；记录两机原配置，不改旧服务。
2. 对候选提交在构建端执行冻结安装、构建、测试、覆盖率、浏览器流程和 `pnpm audit --audit-level=high`；高危/严重未解决不得按“已具备公网条件”发布。
3. 经再次授权后安装 WireGuard 工具、生成独立密钥、最小端口放行、建立专用隧道；确认默认路由和国内网易云出口未改变。
4. 国内建立专用账号/运行时/Redis/持久目录，部署后端并初始化测试管理员；先通过受信入口头在隧道内检查，不把临时调试端口暴露公网。
5. 海外部署同版本静态资源、完整 Nginx 配置及证书；配置 DNS-only A、续期任务，保留原配置备份；完成第 9 节后才邀请成员。
6. 首轮只发给管理员，再逐步加入最多 5 名成员。保留观察窗口，不同时迁移本机真实用户数据；默认新建隔离测试库，确需迁移另行确认。

持久数据：SQLite（含足迹/头像/歌单/2FA 加密数据）、storage、独立 TOTP 加密密钥及 Session Secret。SQLite 启用了 WAL，在线备份使用一致性备份能力，不能只复制正在写入的主 sqlite 文件；备份与密钥分离加密保存并做一次恢复验证。Redis 持久化可改善服务重启后的会话恢复，但故障恢复可能仍要求重新登录，不承诺永久登录。

前端切回上个静态 release，后端切回上个兼容 release；先停止写入并核对表兼容性，代码回滚不等于数据库回滚，不删除新增足迹表来“清理”。禁止回退到缺少现有 2FA 检查的旧版本。隧道故障时返回明确 502/503 或维护响应，不转发至公网 Express；紧急暂停只停本项目服务/站点，不停机器人或全机网络。

## 9. 上线前验收门槛

- [ ] 两机 WireGuard 成功握手，空闲后可恢复；连续观察至少 30 分钟，并测试双向小/较大请求、重启自动恢复。仅 ping 通不算 API 验收。
- [ ] 国内到网易云请求保持国内出口；没有默认路由经韩国，未依赖用户电脑或管理用 ZeroTier。
- [ ] 域名公共 A 正确、无错误 AAAA；证书可信、HTTP 仅跳转/ACME，未知 Host 拒绝，证书续期验证成功。
- [ ] 从非授权节点无法连接国内 3000/6379；已有服务未受影响；日志/错误页无秘密或内部路径泄漏。
- [ ] 确认公网入口覆盖伪造转发头，应用识别真实客户端 IP，限流没有把全部成员当成同一代理 IP。
- [ ] 浏览器完成首次管理员绑定、登录/退出、TOTP 错码/重放/恢复码、保持登录；Secure/HttpOnly/SameSite Cookie 正常；恶意 Origin 与缺失 CSRF 被拒绝。
- [ ] `/health` 仅作为进程探活；另验证 Redis、真实网易云搜索/播放地址/歌词。国内受信探活需带正确转发头，生产直接 HTTP 探活可能得到 308，不代表业务就绪。
- [ ] 五人场景搜索/播放/切歌/歌词/队列持久化；本地测试音频 Range 206、非法 Range 416；上传大小、头像和未登录下载权限不被代理绕过。
- [ ] 足迹、收藏、歌单、头像在重登/重启后保留；跨用户不能修改；私有记录/卡片仅本人可读，显式分享仅其他已登录成员可见，匿名不可读。
- [ ] 确认 Nginx HTML CSP 下液态玻璃、模型、主题、封面预览、2FA 二维码、播放器可用；有 hash 缓存及旧资源保留，非 hash 资源不会陈旧一年。
- [ ] 在保持 API 安全的前提下模拟隧道故障，静态页仍可加载、API 有明确失败，不返回首页假成功、不无限重试写入。
- [ ] 一次备份恢复与版本回退演练；没有公网暴露备份、环境文件或管理端口；内存/磁盘和两机出口流量在预算内。

## 10. 本轮交付与未执行事项

已完成：两机资源/端口/云地域、公共 DNS、WireGuard 工具/模块/网段、项目入口/Session/2FA/代理/播放路径的只读核对；部署方案形成。主 Agent 负责服务器、网络、公开文档和最终方案；只读 Agent 核对仓库实际部署接口。

未执行：安装、生成密钥、申请证书、修改 DNS/路由/安全组/防火墙、部署、迁移数据库、真实生产 Redis/网易云/压力验收。未读取真实环境文件、数据库、上传文件或私钥。本文配置片段未在服务器应用或验证语法，不能当作已上线配置。

下一步需用户确认：是否按该分工正式实施；确认国内服务商对混合部署的要求、两云控制台及域名操作权限、Azure 公网 IP 与带宽配额。确认前只保留本文，不主动部署。
