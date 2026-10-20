# open-music-club
一个局域网音乐共享与播放网站（课程作业）的web平台，同时也是音乐爱好者的聚集地

## 开发与验收

使用 `.node-version` 中的 Node 和 `package.json` 中锁定的 pnpm 版本。

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm dev
```

本地网页：`http://127.0.0.1:5173/`。完整可复现验收：`pnpm verify:baseline`。

安装、CI、浏览器测试边界、报告位置和邮件配置见 [验收基线](docs/acceptance-baseline.md)。实际功能状态见 [技术路线图](open-music-club-technical-roadmap.md#0-当前实现与验收状态2026-10-17)；公网开放仍需完成 HTTPS、依赖安全修复和真实环境验收。
