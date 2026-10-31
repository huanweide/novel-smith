<!-- badges -->

[![License](https://img.shields.io/github/license/huanweide/novel-smith)](LICENSE)

[![CI](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml)

[![Stars](https://img.shields.io/github/stars/huanweide/novel-smith)](https://github.com/huanweide/novel-smith/stargazers)

[![在线演示 · 规则引擎自检](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E6%BC%94%E7%A4%BA-%E8%A7%84%E5%88%99%E5%BC%95%E6%93%8E%E8%87%AA%E6%A3%80-22c55e)](https://huanweide.github.io/novel-smith/)

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/huanweide/novel-smith/pulls)

<!-- /badges -->


<p align="center">

  <img src="assets/banner.svg" alt="novel-smith">

</p>


# 🔨 Novel Smith — AI 长篇网文写作工坊


> **中文**：聊天窗口是健谈的陌生人，Novel Smith 是住在你电脑里、帮你写长篇网文的 AI 写作工坊——从一句话灵感到成书，AI 起草、你拍板。



`AI 写作` · `长篇网文` · `创意工坊` · `分层记忆引擎` · `Local-First` · `数据不出本机 · 隐私零上传` · `本地过审自检（可选）`

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org) [![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev) [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![SQLite](https://img.shields.io/badge/SQLite-local-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org) [![LLM](https://img.shields.io/badge/LLM-DeepSeek%20%2F%20OpenAI%20兼容-4D6BFE?style=flat-square)](https://platform.deepseek.com) [![Local-First](https://img.shields.io/badge/Local--First-%E9%9B%B6%E4%B8%8A%E4%BC%A0-22C55E?style=flat-square)](https://github.com/huanweide/novel-smith)


**一句话灵感 → 探讨设定 → 自动填表 → 批量写作 → 本地过审 → 导出成书**


> 💡 **一句话定位**：用 AI 写长篇网文，最怕写到一半——人设崩了、设定对不上、灵感枯竭。Novel Smith 把 **AI 写作 + 分层记忆 + 创意工坊** 装进你电脑里：AI 帮你从灵感写到成书，写 100 章人设也不崩，设定自动建档，你随时接手改。**未发表稿件一个字节都不上传。**


<p align="center">

  <a href="https://huanweide.github.io/novel-smith/"><b>▶ 在线 Demo（规则引擎 · 免 Key）</b></a>

  &nbsp;·&nbsp;

  <a href="#快速开始"><b>🚀 一行命令本地跑起来</b></a>

  &nbsp;·&nbsp;

  <a href="https://github.com/huanweide/novel-smith/releases/tag/v3.1.157"><b>💻 桌面版下载即用（双击开）</b></a>

</p>


> ⚡ **不想装 Node / 不想敲命令？** 直接下桌面版，双击就开 → [GitHub Releases · v3.1.157](https://github.com/huanweide/novel-smith/releases/tag/v3.1.157)（无代码签名，首次被 Windows SmartScreen 拦，点「仍要运行」即可）


## ✨ 核心能力（一句话说清它能干嘛）


- 🤖 **用 AI 写完整长篇** —— 从灵感、世界观、章纲到逐章正文，AI 帮你起草，你只管创意和拍板；内置「创意工坊」预设市场，文风 / 世界观 / 角色卡 / 世界书模板一键套用，新手也能立刻上手。
- 🧠 **写再长也不崩人设** —— 内置「分层记忆引擎」（最近几章看全文、稍远的看摘要、再远的让 AI 压成要点，永远带着上下文写），AI 写 100 章，人设、伏笔、设定都不丢、不退化。这是它和普通"让 AI 帮你写"最大的区别。

- 📋 **设定自己长出来** —— 每章写完自动抽取人物 / 地点 / 势力，建成角色卡和世界书（15 类自动分类），关系图一键可看，不用你拿小本本记。

- 🔒 **未发表稿件零上传** —— 全部存在你电脑上的一个本地 SQLite 文件里，正文和 API Key 都不出本机；无账号、无云、无遥测。

- 🔍 **（可选）离线过审自检** —— 12 条本地规则逐句标出"哪像 AI、为什么、怎么改"，不联网、不调模型、不花一分钱（下面 30 秒就能试）。它只是质量工具，不是核心——你完全可以写完直接导出，不开它。


## 谁该用 / 谁先别用


**这套工坊适合你，如果——**

- 你在写（或想写）中长篇网文 / 小说，需要长期维护人设、伏笔、世界观；

- 你用过 AI 写小说，却被「写到 30 章就失忆、人设崩了」劝退过；

- 你介意把未发表稿件传到任何云端；

- 你想要「AI 干活、你拍板」的协作感，而不是一键生成一整本没灵魂的文字。


**先别急着用，如果——**

- 你只想要一句提示词自动吐出一整本小说（这不现实，我们也故意不做）；

- 你完全不想在本地跑任何程序、连 `npm` 都不碰——可以先去[在线 demo](https://huanweide.github.io/novel-smith/) 试去 AI 味，但完整功能需本地跑；

- 你只写短篇文案、社媒推文等一次性文本。


[30 秒看懂](#30-秒看懂) · [核心能力](#核心能力一句话说清它能干嘛) · [界面一览](#界面一览) · [它能做什么](#它能做什么) · [特性](#特性) · [桌面版下载](#desktop) · [快速开始](#快速开始) · [命令速查](#命令速查) · [架构](#架构) · [加一条你自己的规则](#加一条你自己的规则) · [路线图](#路线图) · [贡献](#贡献) · [⭐ Star](#star)


**当前版本：v3.1.157** · 本地 SQLite 零配置 · 2163 个测试用例 · 140 个 API 路由 · 17 个内置示范预设 · MIT 开源


> 最近几个版本重点打磨：**分层记忆抗失忆** · **创意工坊预设市场** · **自动建档管线** · **可选本地过审自检** —— 都跑在本地、稿件零上传。


---


## 30 秒看懂


Novel Smith 是一个**写长篇的本地工作台**，去 AI 味检测只是它完全离线跑的「规则引擎」里最直观的一项能力。先不装、不配 Key，**打开[在线 demo](https://huanweide.github.io/novel-smith/)**，粘一段你自己的文字，立刻看到规则引擎怎么逐句标出 AI 腔、为什么、怎么改。


下面这份是**真实跑出来的输出**（用本仓库 `src/core/humanize` 规则引擎跑下面这段 AI 腔文字）：


```

输入：

值得注意的是，夜色中的古城显得格外静谧。他缓缓睁开双眼，心中不由得微微一凛，

仿佛有什么东西正在暗处窥视着自己。


综上所述，这场突如其来的变故，不仅仅改变了他一个人的命运，更是深刻地影响了

整个家族的未来走向。他深吸一口气，目光坚定地望向远方——那里，是希望的所在。


阳光透过树叶的缝隙洒落下来，形成斑驳的光影。她轻轻叹了口气，似乎想要说些什么，

却最终什么也没有说出口。

```


```

=== 本地过审自检报告 ===

AI 痕迹指数  69 / 100          等级：痕迹明显（noticeable）


原始统计（可解释，不是玄学分数）

  总字数 181 · 句数 6 · 平均句长 30.2 字 · 句长标准差 9.00

  破折号密度 5.50 /千字 · AI 高频词 27.60 /千字 · 短句占比 0.0%


按规则聚合

  ai-vocab          AI 高频词            high    x5

  uniform-sentence  句长过于均匀         medium  x1

  progressive-pair  「不仅…而且…」递进句  medium  x1


逐段评分

  [P0] ██████████ 100  命中 3 处

      · AI 高频词(high)  "值得注意的是，夜色中的古城显得格外静…"

        为什么: 典型的说明文过渡腔，小说对话与叙述里几乎没人会这么起句。

        怎么改: 直接删掉，让事实自己说话，或换成具体的人物动作。

      · 句长过于均匀(medium)

        为什么: 6 个句子的长度标准差只有 9.0 字（平均 30.2 字），像用尺子量过。

        怎么改: 刻意加入几个短句（3-8 字）制造节奏变化，长句里塞进一个破句。

  [P1] ██████████ 100  命中 2 处

      · AI 高频词(high)  "综上所述，这场突如其来的变故，不…"

        为什么: 论文腔，出现在小说正文里非常突兀。

        怎么改: 整句删掉，或改成人物的判断与抉择。

      · 「不仅…而且…」递进句(medium)

        为什么: 把两件能分开说的事拧成一个长句，读着累，也是 AI 凑层次感的常用手法。

  [P2] ██████████ 100  命中 2 处

      · AI 高频词(high)  "阳光透过树叶的缝隙洒落下来，形成斑驳…"

        为什么: AI 写环境描写的固定模板句。

        怎么改: 换成与情节相关的环境细节，别用通用美景填充。

```


**这一段全程在你浏览器里跑**：不联网、不上传、不调模型、不花一分钱 —— 你的未发表稿件一个字节都不出本机。这一点是任何云端 AI 检测都做不到的（它们都要求你把稿件传上去）。


> ⚠️ 规则引擎只能帮你**降低机器味**，不能保证通过任何平台的 AI 率审核。平台算法不公开且持续变化，结果仅供参考。


---


## 界面一览


真实运行截图，不是概念图。完整演示见[在线 demo](https://huanweide.github.io/novel-smith/)。


| 首页 · 小说宇宙入口 | 探讨模式 · 对话式构建世界观 |

|---|---|

| ![](docs/screenshots/home.png) | ![](docs/screenshots/explore.png) |


| 首页 | 工作台 |

|---|---|

| ![](docs/screenshots/novel-smith-home.png) | ![](docs/screenshots/novel-smith-workbench.png) |


完整闭环演示（从一句话灵感到导出成书）：


![工作流演示](docs/screenshots/demo.gif)


---


## 它能做什么


### 按你的目标，找对应能力


| 你想做成的事 | Novel Smith 怎么帮你 |

| --- | --- |

| 用 AI 写一部长篇网文 | AI 起草：从灵感、世界观、章纲到逐章正文，全程 AI 帮你写，你只管拍板 |
| 套用成熟写法，少走弯路 | 创意工坊预设市场：文风 / 世界观 / 角色卡 / 世界书 / 剧情推进模板一键应用 |
| 把一句话灵感变成完整世界观 | 探讨模式：11 步引导式对话，把灵感聊成设定 / 角色 / 大纲 |

| 写长也不崩人设、不丢伏笔 | 分层记忆引擎：近 4 章全文 + 近 3 章摘要 + 远楼层压缩，写 100 章不降智 |

| 不想拿小本本记设定 | 自动填表管线：每章抽人物 / 地点 / 势力 → 角色卡 + 世界书（15 类自动分类） |

| （可选）降低稿子的机器味 | 本地过审自检：12 条规则逐句标「为什么像 AI、怎么改」，不联网不花钱 |

| 稿件别传上云 | 本地 SQLite 单文件库：无账号、无云、无遥测，一个字节不上传 |

| 导出给编辑 / 平台发布 | 一键五格式导出：TXT / Markdown / HTML / EPUB / DOCX |


写一个长篇，最怕的不是开头，而是**写到一半**——第 30 章的主角突然像换了个人，第 12 章埋的伏笔再也没提起过，AI 越写越水。


Novel Smith 把这些「记不住的活」交给工程台自动管，你只管创意和落笔：


```

你：一句话灵感「修真世界里，一个不能用术法的少年」


  Round 1  探讨模式     → 11 步引导式对话，把一句话聊成完整世界观

  Round 2  自动建档     → 抽取人物/地点/势力 → 建角色卡 + 世界书词条（15 类自动路由）

  Round 3  批量写作     → 先出 1-10 章章纲给你改，确认后后台逐章写正文

  Round 4  分层记忆注入 → 近 4 章全文 + 近 3 章摘要 + 远楼层 AI 压缩，写 100 章不降智

  Round 5  本地过审自检 → 12 条规则逐段扫描，绿/黄/红标出哪句像 AI、为什么、怎么改

  Round 6  一键导出     → TXT / Markdown / HTML / EPUB / DOCX

```


**生成正文、拆书、角色与世界书管理要写本地 SQLite 文件**，所以要在你自己机器上跑（在线 demo 跑在无状态云环境，写不了本地文件）。**你的文字不出本机。**


### 哪些功能不需要 API Key


| 功能 | 需要 Key |

|---|---|

| 去 AI 味检测、本地过审自检 | **不需要** —— 纯本地规则引擎 |

| 字数统计、一致性检查、伏笔追踪、角色关系图 | 不需要 |

| 拆书分析、导出 Word / EPUB | 不需要 |

| AI 生成正文、续写、精修、角色对话 | 需要（用你自己的 Key） |


---


## 特性


- 🤖 **AI 写作引擎（核心）** —— 从灵感、世界观、章纲到逐章正文，AI 帮你起草；内置「创意工坊」预设市场，文风 / 世界观 / 角色卡 / 世界书模板一键套用。实现见 `src/app/workshop`、`src/core/write-generation.ts`。

- **🧠 分层记忆引擎（默认）** —— 近 4 章全文 + 近 3 章摘要 + 远楼层 AI 压缩三层装配，配 S/A/B/C 四级事件衰减（S 级永久、C 级 5 章后清理），写 100 章人设/伏笔/设定不丢。实现见 `src/lib/memory-decay.ts`、`src/core/memory/`。

- **📋 自动填表管线（可选 · 默认关）** —— 每章生成后抽结构化表格 → 自动建角色卡与世界书词条 → 检测角色关系 → 回写故事线；纯手写作家不会被被动打扰。实现见 `src/core/assembly/engine.ts`。

- **📖 世界书 15 类确定性分类器** —— 地理/势力/力量体系/命运体系/物理/公开体制…共 15 类，按关键词加权自动路由填表，不做模糊猜测。实现见 `src/lib/world-category-classifier.ts`。

- **⚖️ 写作规则引擎（特异性裁决）** —— 规则带 6 档作用域（全局/卷/章节范围/事件类型/角色场景/条件触发），冲突时按「优先级 vs 特异性」裁决并给出胜出理由。实现见 `src/core/rules.ts`。

- **🧵 缝合怪推进器** —— 主线完结后自动构造承接的新主线，剧情永不干涸；三档节奏（快/均衡/慢热）可调。入口见 `src/app/api/storylines/generate/route.ts`。

- **🔒 网络闸门（默认只认本机）** —— 全部 `/api/*` 带一层访问控制，公网来源默认 403；三种信任模式可选（`trust-proxy-header` / `trust-cf-only` / `direct`），防「误部署到公网」。实现见 `src/lib/net-guard.ts`、`src/proxy.ts`。

- **💾 本地单一 SQLite 文件库** —— `./data/novelforge.db`，零配置开箱即用；备份就是复制这个文件。无云服务、无订阅、无账号、无遥测。

- **📦 五格式一键导出** —— TXT / Markdown / HTML / EPUB / DOCX，纯本地打包。实现见 `src/core/docx.ts`、`src/core/epub.ts`。
- 🔍 **本地过审自检（可选 · 默认开）** —— 12 条基于正则与统计的规则，零 LLM 调用、零网络请求，逐句标「为什么像 AI、怎么改」，不打分黑箱。它是质量辅助，不是写作前提。实现见 `src/core/humanize/rules.ts`。


---


<a id="desktop"></a>

## 桌面版：下载即用（无需 Node / 不碰命令行）

> 不想装 Node、不想敲命令？直接下桌面版，双击就开。

- **下载地址**：[GitHub Releases · v3.1.157](https://github.com/huanweide/novel-smith/releases/tag/v3.1.157)
- 三个包，按习惯挑一个：
  - `NovelSmith-3.1.156-setup.exe`（推荐）— NSIS 安装包，双击安装、可建桌面/开始菜单快捷方式。
  - `NovelSmith-3.1.156-portable.exe` — 单文件自解压，U 盘 / 直接双击即跑，不写注册表。
  - `NovelSmith-3.1.156.zip` — 解压即用。
- **首次运行被 Windows SmartScreen 拦？** 这是正常的「未代码签名」提示，不是病毒，点「仍要运行」即可。
- **首次打开顶部提示「AI 未配置」？** 去设置页（⚙️）填 LLM Key，或在 `.env` 设 `LLM_API_KEY`。不影响打开，也不影响本地写作 / 拆书等不依赖 AI 的功能。
- 数据落在本地单一 SQLite 文件，备份 = 复制那个文件。

![桌面版真实运行界面](docs/screenshots/desktop-app-home.png)

> 上图为桌面版真实运行的首页（由打包产物内的 Next 服务渲染）。顶部「AI 未配置」横幅仅因无 LLM Key，去设置页填 Key 即消失，不影响本地写作 / 拆书等不依赖 AI 的功能。

## 快速开始


### 最省事（一行）


```bash

npm run dev:db     # 生成 .env → 建本地数据库表 → 启动

```


浏览器打开 `http://localhost:3001` 即可。


### 手动分步


```bash

git clone https://github.com/huanweide/novel-smith.git

cd novel-smith

cp .env.example .env          # 默认即用本地 SQLite，无需手改

npm install                  # 安装依赖（含 better-sqlite3 原生模块）

npm run dev:db               # 建表 + 启动

# 浏览器打开 http://localhost:3001

```


```

$ npm run dev:db

✔ .env 已生成（DATABASE_URL="file:./data/novelforge.db"）

✔ Prisma schema 已同步到 ./data/novelforge.db

✔ 17 个内置示范预设已播种

  ▲ Next.js 16.3.8

  - Local:   http://localhost:3001

  ✓ Ready in 2.4s

```


> 数据全部存在 `./data/novelforge.db`（一个本地文件），不依赖任何外部数据库服务。

> `.env` 与 `/data/` 都被 `.gitignore` 忽略，不会上传 GitHub。


### 零门槛试用：不配 Key 也能先尝一口


```bash

npm run dev:db     # 起站后打开 http://localhost:3001/detector

```


去 AI 味检测给你：一个总分 + 四档等级（基本干净 / 轻微 / 明显 / 严重）、逐段绿黄红色条、**每一处都告诉你为什么像 AI 写的、怎么改**、六项可解释的原始统计。觉得好用了，再去「设置」页配 Key。


### 首次配置 LLM 提供商


1. 右上角 **设置** → 选提供商（推荐 **硅基流动**，国产便宜，DeepSeek 全系可用）

2. 填 API Key → 点 **测试连接** → 确认「连接成功」→ **保存设置**


| 提供商 | 获取 Key | 价格参考 | 推荐模型 |

|---|---|---|---|

| 硅基流动 | [siliconflow.cn](https://siliconflow.cn) | ¥0.001~/1K tokens | `deepseek-ai/DeepSeek-V4-Flash` |

| DeepSeek 官方 | [platform.deepseek.com](https://platform.deepseek.com) | ¥0.002~/1K tokens | `deepseek-v4-flash` |

| OpenAI | [platform.openai.com](https://platform.openai.com) | $0.005~/1K tokens | `gpt-4o` |

| Groq | [console.groq.com](https://console.groq.com) | 免费额度 | `llama-3.3-70b-versatile` |

| 自定义 | 任何 OpenAI 兼容服务 | 看服务商 | 看服务商 |


首次打开「创意工坊」会自动播种 **17 个内置示范预设**，点「套用」即可开写，无需手填表。


---


## 命令速查


| 命令 | 用途 |

|---|---|

| `npm run dev:db` | 建本地库 + 启动开发服务器（推荐入口） |

| `npm run dev` | 仅启动开发服务器（`localhost:3001`，Turbopack HMR） |

| `npm run build` | 生产构建（走 `scripts/safe-build.mjs` 守卫） |

| `npm start` | 启动生产服务器 |

| `npm test` | 跑全部 vitest 用例（2163 个） |

| `npm run test:coverage` | 带覆盖率的测试 |

| `npx tsc --noEmit` | TypeScript 严格模式检查（零错误才算过） |

| `npm run lint` | ESLint（**存量技术债，暂不硬门禁**） |

| `npm run lint:colors` | 颜色守卫 ARCH-7（软提醒，不阻断） |

| `npm run doctor` | 环境自检（依赖/数据库/配置） |

| `npx prisma studio` | 数据库可视化面板（`localhost:5555`） |

| `npx prisma db push` | 同步 Prisma schema → 本地 SQLite |

| `npm run db:seed` | 播种内置预设与示例数据 |


---


## 架构


**一句话**：本地 SQLite 单文件为地基，写作流程是一条「装载上下文 → 生成 → 蒸馏回写 → 本地过审」的闭环；设定与记忆不是塞进 prompt 的一次性文本，而是会随每一章自动沉淀、自动衰减的结构化档案。


### 核心概念


| 概念 | 含义 |

|---|---|

| **分层记忆（Tiered Memory）** | 近 4 章全文 + 近 3 章摘要 + 远楼层 AI 压缩的三层上下文装配，解决「写越长越降智」 |

| **事件分级（S/A/B/C）** | 事件重要性四档，配遗忘曲线式衰减：S 永久、A 30 章降 B、B 15 章降 C、C 5 章删除 |

| **蒸馏（Distillation）** | 每章写完后抽取结构化事实，回写角色卡 / 世界书 / 故事线，让设定随写作自动生长 |

| **世界书（World Book）** | 15 类设定词条库，按触发词在生成前注入上下文 |

| **自动填表（Assembly）** | 把 AI 抽出的表格自动建成角色卡与世界书词条，并检测角色关系 |

| **去 AI 味（Humanize）** | 12 条纯本地规则扫描，段落级绿/黄/红评分，给「为什么 + 怎么改」，绝不自动改写正文 |

| **规则特异性（Specificity）** | 写作规则按 6 档作用域加权，冲突时按优先级/特异性裁决并给出胜出理由 |


### 写作闭环


```

        ┌──────────────────────────────────────────┐

        │                                          │

  一句话灵感                                        │

        │                                          │

        ▼                                          │

   探讨模式（11 步）──► 世界观 / 角色 / 势力           │

        │                                          │

        ▼                                          │

   装载上下文 ◄──── 分层记忆（近章全文 + 摘要 + 远楼压缩）│

        │          ◄──── 世界书触发词注入              │

        │          ◄──── 写作规则（特异性裁决）         │

        ▼                                          │

   章纲生成 ──► 你确认/修改 ──► 正文生成               │

        │                                          │

        ▼                                          │

   蒸馏回写 ──► 角色卡 / 世界书 / 故事线 ──────────────┘

        │

        ▼

   本地过审自检（12 条规则，段落级评分）

        │

        ├── 命中少 ──► 定稿 ──► 导出 TXT/MD/HTML/EPUB/DOCX

        └── 命中多 ──► 回到正文（作者自己改，机器不代笔）

```


### 核心模块


| 模块 | 文件 | 说明 |

|---|---|---|

| 去 AI 味规则库 | `src/core/humanize/rules.ts` | 9 条段落级 + 3 条全文级规则，纯正则与统计 |

| 过审评分入口 | `src/core/humanize/index.ts` | 汇总 5 项可解释统计 → 总分 + 等级 + 逐段报告 |

| 一键修复建议 | `src/core/humanize/fixes.ts` | 只给确定性改法，且**必须作者点「套用」才执行** |

| 平台风险提示 | `src/core/humanize/platform-risk.ts` | 按常见平台口径给风险提示（不预测具体算法） |

| 记忆衰减引擎 | `src/lib/memory-decay.ts` | S/A/B/C 四级遗忘曲线，与伏笔系统互不干扰 |

| 语义召回 | `src/core/memory/semantic-recall.ts` | 远楼层事件的相关性召回 |

| 记忆分类器 | `src/lib/memory-classifier.ts` | 判定事件归属的记忆层与类别 |

| 蒸馏评分器 | `src/core/distillation/scorer.ts` | 事件重要性与 S/A/B/C 分级打分 |

| 上下文装载 | `src/core/pipeline/context-loader.ts` | 组装分层记忆 + 世界书 + 规则的单次注入上下文 |

| 章纲/正文生成 | `src/core/pipeline/generate-chapter-outline.ts`、`plan-chapter.ts` | 先章纲后正文的两段流 |

| 自动填表管线 | `src/core/assembly/engine.ts` | 表格 → 角色卡/世界书 → 关系检测 → 回写 |

| 世界书分类器 | `src/lib/world-category-classifier.ts` | 15 类确定性路由，单一权威源派生标签 |

| 写作规则引擎 | `src/core/rules.ts` | 6 档作用域权重 + 冲突裁决 |

| 一致性检查 | `src/core/consistency/detectConflicts.ts` | 抽取事实 → 检测冲突 → 给修复建议 |

| 伏笔追踪 | `src/core/foreshadowing.ts` | 埋了没收的自动提醒 |

| 故事线推进 | `src/core/storyline/generate.ts`、`execute-task.ts` | 主线/支线七要素 + 缝合怪推进 |

| 拆书与仿写 | `src/core/dissect/engine.ts`、`imitation-engine.ts` | 15 维拆解他人作品 + 仿写 |

| 网络闸门 | `src/lib/net-guard.ts`、`src/proxy.ts` | `/api/*` 访问控制与三种信任模式 |

| 导出 | `src/core/docx.ts`、`src/core/epub.ts` | 本地打包 DOCX / EPUB |


更深的类比式讲解见 [ARCHITECTURE.md](ARCHITECTURE.md)，逐模块细节见 [`docs/architecture-reference/`](docs/architecture-reference/)。


---


## 加一条你自己的规则


去 AI 味引擎是开放的——你发现自己文风里的机器味，可以自己加一条规则（`src/core/humanize/rules.ts`）：


```ts

// 规则示例：识别「双重否定再转折」这个 AI 签名句式

export function detectNegativeParallel(text: string, offset = 0): AiTraceHit[] {

  const hits: AiTraceHit[] = [];

  const re = /不是([^，。！？；\n]{1,20})[，、]不是([^，。！？；\n]{1,20})/g;

  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {

    hits.push({

      ruleId: "negative-parallel",

      ruleName: "否定式排比",

      severity: "high",

      excerpt: excerptAt(text, m.index, m[0].length),

      start: offset + m.index,

      end: offset + m.index + m[0].length,

      reason: "连续两次否定再转折，几乎成了 AI 写作的签名句式。",

      suggestion: "直接写「是什么」，别先绕两个「不是什么」。",

    });

  }

  return hits;

}


// 挂进段落级规则表即可生效

export const PARAGRAPH_RULES = [/* ...既有规则, */ detectNegativeParallel] as const;

```


规则写好后 `npm test` 会跑全部 2163 个用例守住既有行为。模板类扩展（大纲 / 风格卡 / 角色卡）直接往 `templates/` 目录提即可。


---


## 路线图


- [x] 本地 SQLite 单文件架构（零配置、无需 Docker）

- [x] 去 AI 味规则引擎 + 在线 demo 零门槛试用

- [x] 分层记忆引擎 + 事件分级衰减

- [x] 自动填表管线 + 世界书 15 类分类器

- [x] 批量写作两段流（先章纲后正文）

- [x] 智能审阅 + 五格式导出

- [x] `/api/*` 访问控制与三种信任模式

- [ ] 清理 ESLint 存量技术债（1134 errors，多为历史 `no-explicit-any`），解除豁免转为硬门禁

- [ ] 预设社区化：内置示范预设的导入/导出与分享闭环

- [ ] 更多内置示范预设与题材开局


完整排期与历史交付台账见 [ROADMAP.md](ROADMAP.md)。


---


## 生产部署


```bash

npm run build          # 构建生产版本

npm start              # 启动生产服务器

```


> **公网部署前必读**：自 v3.1.115 起，全部 `/api/*` 带一层内置访问控制——**只接受来自本机或局域网的请求**，公网来源一律返回 403（放行 `localhost` / `127.` / `10.` / `192.168.` / `172.16~31.` / `169.254.` / `::1` / `*.local`）。这是防「误部署到公网」的底线，**不是账号体系**。


> | `TRUSTED_PROXY_MODE` | 采信什么 | 适用 |

> | --- | --- | --- |

> | `trust-proxy-header`（默认） | `CF-Connecting-IP` → `X-Forwarded-For` → `X-Real-IP` → `Host` | 前面确有反代且信任它清洗头 |

> | `trust-cf-only` | 只信 `CF-Connecting-IP` | **暴露公网时推荐** |

> | `direct` | 一个请求头都不信，只认 TCP 对端地址 | 无前置代理 |


> 拿不到可信来源时一律**拦下**。临时放行走 `ALLOW_UNKNOWN_SOURCE=true`；若确实要对外提供服务，`ALLOW_PUBLIC=true` **强烈建议同时**设 `ALLOW_PUBLIC_TOKEN=<自定义长随机串>`。完整说明见 [SECURITY.md](SECURITY.md)。


> ⚠️ 这层是**网段白名单，不是身份认证**。它挡得住误部署到公网，挡不住同一内网里的其他人。真正的防线是只监听 `127.0.0.1` + 防火墙。


---


## 贡献


个人开源项目，欢迎一切形式的参与。**想动手先看 [CONTRIBUTING.md](CONTRIBUTING.md)**——里面有从零起站、目录结构、三道门禁到「怎么提一个好 Issue」的完整路径。


1. **点 Star** —— 最简单也最有用的支持。

2. **开 Issue** —— Bug / 新功能 / 文档错，用 Issue 模板提（附版本号 + 复现步骤）。想聊想法、晒作品去 **Discussions**。

3. **提 PR** —— 改前先 `./scripts/git-snapshot.sh create "说明"` 拍快照，改完跑三道门禁（`npx tsc --noEmit` / `npm test` / `npm run build`）。


> 预设是社区共建的最好素材——你打磨出的文风 / 世界观 / 角色卡，可以导出 `.preset.json` 分享，或写进 Issue，我们很乐意把它变成内置示范预设。


本地开发：


```bash

npm run dev            # 开发服务器 (localhost:3001)

npx tsc --noEmit       # 类型检查（零错误才算过）

npm test               # 2163 个用例

npx prisma studio      # 数据库面板 (localhost:5555)

```


---


## 安全边界


- **不上传** —— 正文、设定、API Key 全部在你自己的 SQLite 文件里，无云服务、无遥测、无账号体系。

- **不代笔** —— 去 AI 味只标出痕迹并给建议；即便带「一键套用」的修复，也**永远只在作者亲手点下时执行**，不自动改写正文。

- **不保证过审** —— 规则引擎只能降低机器味，不预测任何具体平台的算法。

- **不是在线服务** —— 没有账号、没有云端同步、没有「会员解锁更多章节」。

- `.env`、`/data/`、`*.db`、证书与凭据文件全部被 `.gitignore` 忽略；CI 含安全检查，代码中无硬编码密钥。


---


## 它不是什么


- **不是全自动写书机** —— 每一章的章纲和正文都要你点头。作者是你，它是工程台。

- **不需要 Key 的只是检测** —— AI 生成/续写/精修要配你自己的 Key；检测、一致性检查、伏笔追踪、导出这些纯本地功能永远免费、永远离线。

- **不是笔记软件的双向链接套壳** —— 世界书和角色卡是为「写长篇」设计的结构化档案（15 类、自动分类、自动填表）。


---


---


## 同一作者的其他工具


**顺手点个 Star，帮同族工具被更多人看见：**


**字幕 / 视频全家桶**（解决「把视频变成文字」的不同环节）：

- 🎬 [bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) · 全网视频字幕提取 + 无字幕 AI 听写

- 🎓 [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · 智慧树网课自动播放 / 断点续播 / AI 答题

- 🔴 [live-subtitle](https://github.com/huanweide/live-subtitle) · 直播实时字幕

- ✂️ [video-brief](https://github.com/huanweide/video-brief) · 视频内容速览


**代码健康全家桶**（18 轴零依赖 CLI）：

- 🩺 [family-showcase](https://github.com/huanweide/family-showcase) · 所有 doctor 工具的总览枢纽


**命令行利器**：

- 🔧 [idiot-index](https://github.com/huanweide/idiot-index) · [recall-cli](https://github.com/huanweide/recall-cli) · [forge-safeguard](https://github.com/huanweide/forge-safeguard-20260812)


**全部仓库**：<https://github.com/huanweide?tab=repositories>


---

## License


MIT License — 详见 [LICENSE](LICENSE)


---


## Star


🔨 如果这个工坊帮你把故事写了出来，**点个 Star** 让更多写长篇的人看见它。

[![Star](https://img.shields.io/github/stars/huanweide/novel-smith?style=social)](https://github.com/huanweide/novel-smith/stargazers)


> Novel Smith · AI 小说工坊 · 本地优先 · 数据自有



