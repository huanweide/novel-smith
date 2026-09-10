# 参与 Novel Smith

谢谢你想让这个项目变好。这是一份**照着做就能跑起来**的指南，不绕弯子。

---

## 一、先把项目跑起来（3 步）

```bash
git clone https://github.com/huanweide/novel-smith.git
cd novel-smith
npm run dev:db          # 自动生成 .env → 建本地 SQLite 库 → 启动
```

浏览器打开 <http://localhost:3001> 即可。**不需要 Docker、不需要安装数据库、不需要注册账号。**

> `npm run dev:db` 做的事：若 `.env` 不存在就从 `.env.example` 复制 → `prisma db push` 建表 → `npm run dev`。
> 数据全在 `./data/novelforge.db` 这一个文件里，备份就是复制它。

### 只在需要 AI 功能时才配 Key

- 打开 **设置页**，选提供商（推荐硅基流动，便宜且 DeepSeek 全系可用），填 Key，点「测试连接」。
- **不配 Key 也能用「去 AI 味检测」**（`/detector`）——它是纯本地规则引擎，不联网、不调模型。

### 常见问题

| 症状 | 原因与办法 |
|---|---|
| `better-sqlite3` 原生模块加载失败 | 缺预编译二进制。Windows 上从该库 GitHub releases 下载对应 `node-vXXX-win32-x64` 包，放进 `node_modules/better-sqlite3/lib/binding/` |
| 页面提示「数据库未连接」 | 确认 `.env` 里 `DATABASE_URL="file:./data/novelforge.db"`，然后跑 `npm run dev:db` 重建（**项目不用 Docker / Postgres**） |
| 想确认环境是否健康 | `npm run doctor` |

---

## 二、代码在哪

| 目录 | 放什么 |
|---|---|
| `src/app/` | 页面与 API 路由（App Router） |
| `src/core/` | **纯逻辑内核**（不碰 IO，可直接单测）——生成、记忆、humanize、导出、预设等 |
| `src/components/` | UI 组件（按页面域分目录） |
| `src/lib/` | 工具与客户端逻辑（`api-error`、`stream-error` 等） |
| `prisma/schema.prisma` | 数据模型（27 张表） |
| `scripts/` | 维护脚本（版本 bump、git 快照、诊断） |
| `templates/` | 可分享的大纲 / 风格卡 / 角色卡模板 |

**约定**：新逻辑优先写成 `src/core/` 或 `src/lib/` 里的**纯函数**，再配单测——这是本项目能保持 1500+ 测试全绿的原因。

---

## 三、改动前 / 提交前

### 1. 先拍快照（改坏了能一键回退）

```bash
./scripts/git-snapshot.sh create "我要改什么的说明"   # PowerShell 用 .\scripts\git-snapshot.ps1
./scripts/git-snapshot.sh list
./scripts/git-snapshot.sh restore <标签>              # 安全模式：开新分支，main 不动
```

### 2. 三道门禁（全过才允许提交）

```bash
npx tsc --noEmit --incremental false   # 类型检查：0 错
npx vitest run                          # 测试：全绿
npx next build                          # 生产构建：EXIT=0
```

### 3. 改了产品行为就要 bump 版本（五件套）

`package.json` 的 `version`、`src/lib/changelog-data.ts` 的 `LATEST_VERSION` + `CHANGELOG_BRIEF` + `VERSIONS`、
`CHANGELOG.md` 顶部段落、`agent.md` 版本记录——**五处版本号必须一致**。

直接用脚本（会自动同步中英 README 的版本行）：

```bash
node scripts/bump-version.js --title "标题" --items "修复:改了A,改了B" --items "新增:加了C"
```

> 只改文档 / 资源（README、截图、路线图）**不 bump**。

### 4. 提交

- 精确 `git add <具体文件>`，**不要用 `git add -A`**（避免把 `.log` 临时日志和未入库目录带进去）。
- **推送前必查凭据**：`git diff --cached | grep -iE 'sk-|ck_|BEGIN PRIVATE|SESSDATA'`，确认零命中再推。
  `.env` 与密钥文件已被 `.gitignore` 忽略，但这道检查不能省。

---

## 三之二、写验证 / E2E 脚本的规矩（2026-09-10 实测教训）

> 背景（有数据）：2026-09-10 实测本机 **8 个项目里有 7 个是零章节空壳**，其中 6 个名字是
> `P2003-DEFENSE-V350` / `FT-VERIFY-V350` / `FREETALK-TEST` / `EXPLORE-FIX-TEST`（同一名字还留了两份，
> 22 秒内被创建两次）——都是历史「即写即弃」的验证脚本留下的。
> 成因：**临时项目只在脚本成功路径的最后一行才删**，一旦中断、超时或脚本被丢弃，项目就永久留在库里。

**两条硬规矩：**

1. **临时项目统一用 `E2E-TEMP-` 前缀命名**
   ```js
   const res = await fetch("/api/projects", {
     method: "POST",
     body: JSON.stringify({ name: `E2E-TEMP-${Date.now()}` }),
   });
   ```
   这样首页「清理测试残留」能自动识别它们，也能肉眼一眼分清哪些是垃圾。

2. **清理必须写进 `try/finally`，不允许只在成功路径删**
   ```js
   let id = null;
   try {
     id = await createTempProject();
     await runAssertions(id);        // 这里抛错也要能走到 finally
   } finally {
     if (id) await fetch(`/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
   }
   ```

**补充约定**
- 清理用 `DELETE /api/projects/[id]` 是**软删**（只写 `deletedAt`），会进回收站、可恢复，放心调。
- 脚本跑完请不要留下带着业务名字的项目（比如「测试小说」），一律 `E2E-TEMP-*`。
- 已经在库里的老残留：不要手改数据库，用首页「清理测试残留」勾选 → 移入回收站（同样可恢复）。

## 四、怎么提一个好 Issue

用仓库的 Issue 模板（Bug 报告 / 功能请求），并附上：

1. **版本号**：设置页或 `/changelog` 页顶部能看到（如 v3.1.93）。
2. **复现步骤**：点了什么、输入了什么，越具体越好。
3. **期望 vs 实际**：你以为会发生什么，实际发生了什么。
4. **报错原文**：界面提示或服务端日志（**记得先把 API Key 等敏感信息打码**）。
5. **环境**：操作系统、Node 版本（`node -v`）。

---

## 五、贡献预设与模板（最欢迎，门槛最低）

你打磨出的好文风、世界观、角色卡，对别人很有价值：

- **模板**：往 `templates/` 目录提 PR（可参考已有的 `大纲模板.md` / `风格卡模板.md` / `角色卡预设.md`）。
- **预设**：在应用内导出 `.preset.json`，贴进 Issue 或 PR，我们会考虑收进内置示范预设。
- **内置预设**不允许直接改（接口会返回 403）——请先「复刻」成你自己的再改。

---

## 六、行为准则

参与即视为同意本仓库的 [行为准则](CODE_OF_CONDUCT.md)：就事论事，对人友善。

---

## 七、许可证

本项目用 MIT 许可。你提交的代码默认以同样的许可贡献给项目。
