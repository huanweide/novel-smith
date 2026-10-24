[![License](https://img.shields.io/github/license/huanweide/novel-smith)](LICENSE)
[![CI](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/huanweide/novel-smith)](https://github.com/huanweide/novel-smith/stargazers)
[![Live Demo · AI-trace Detector](https://img.shields.io/badge/Live%20Demo-AI--trace%20detector-22c55e)](https://huanweide.github.io/novel-smith/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/huanweide/novel-smith/pulls)

![Novel Smith](docs/banner.svg)

# Novel Smith — AI Novel Workshop

> A **local-first** AI writing workshop for long-form web novels — characters, lore, outlines, and chapters, all in one place.

`TypeScript` · `Local-First` · `Tiered Memory Engine` · `Long-Form Web Novels` · `AI-trace Stripping (local review)` · `Data Stays on Your Machine · Zero Upload`

[⚡ Try in 30 seconds (no key)](https://huanweide.github.io/novel-smith/) · [🖼 UI Preview](https://huanweide.github.io/novel-smith/) · [📦 Quick Start](#quick-start) · [中文 README](README.md) · [⭐ Star on GitHub](https://github.com/huanweide/novel-smith/stargazers)

**Current Version: v3.1.153** · Local SQLite, zero-config · 17 built-in presets · One-click export to 5 formats · MIT License

**Try it in 30 seconds — no API key, nothing to install**
![AI Trace Detector Demo](docs/screenshots/demo.gif)

Open the **[AI-trace detector in the live demo](https://huanweide.github.io/novel-smith/)** and paste any text of your own. You get a real report instantly: which AI-writing patterns were hit, the exact snippets, why each one counts, and how to fix it.

This part **runs entirely in your browser** — no network calls, no upload, no API key. It is the project's core differentiator (a local rule engine) in action.

**Want the full feature set? Run it locally in two minutes**

Chapter generation, book dissection, character and lore management all write into a local SQLite file, so they need to run on your own machine. See [Quick Start](#quick-start). **Your drafts never leave your computer.**

**What works without an API key**

| Feature | Needs an API key |
|---|---|
| AI-trace detector, local review self-check | **No** — fully local rule engine |
| Word count, consistency checks, foreshadow tracking, relationship graph | No |
| Book dissection, export to Word / EPUB | No |
| Chapter generation, continuation, refinement, character chat | Yes (bring your own key) |

> The live demo runs in a stateless cloud environment (it cannot write local files), so only the parts that need no database are usable online. For everything else, run it locally.

---

## The Problem

Writing a long web novel is easy at Chapter 1, painful at Chapter 50:

- Characters multiply, and you forget who did what.
- Foreshadowing gets dropped; settings contradict each other.
- The AI "forgets" the story after 30 chapters and starts writing filler.
- You stare at a blank page, unsure where the plot goes next.
- Exporting to Word for your editor turns into a formatting nightmare.

Novel Smith automates the grunt work — so you can focus on the creative work.

---

## Screenshots

| Home — Projects & Presets | Explore — Chat-Based World Building |
|---|---|
| ![](docs/screenshots/home.png) | ![](docs/screenshots/explore.png) |

## See the Workflow in 60 Seconds

![Workflow demo](docs/screenshots/demo.gif)

The full loop from "one-line idea" to "AI-trace clean": ① open the app → ② Explore mode builds the world by chat → ③ auto-fills structured cards → ④ local review self-check (green/yellow/red per paragraph; manuscripts stay local).

---

## Why Novel Smith

| Pain Point | Traditional Tools | Novel Smith |
|---|---|---|
| Forgetting lore after 50 chapters | Manual spreadsheets | **Auto-fill tables**: extracts people, places, factions per chapter and auto-creates character cards & lorebook entries |
| Tangled character relationships | Draw graphs by hand | **Relationship graph**: draggable nodes, persisted layout, double-click to open cards |
| AI degrades over long stories | Dump full text into context | **Tiered memory engine**: full recent chapters + summaries + long-range compression |
| Writer's block | Stare at blank page | **Explore mode (11 steps)** + **stitch-monster plot continuation**: from one line to a full world; auto-spawns new arcs when the main one ends |
| Messy exports | Manual formatting | **One-click export** to TXT / Markdown / HTML / EPUB / DOCX |
| Cloud privacy concerns | Third-party SaaS | **Local SQLite**: your API keys and manuscripts never leave your machine |

---

## How Is This Different From Just Chatting With an AI?

You can already open a chat window and ask an AI to help you write. Here is the difference:

| | Chatting With an AI | Novel Smith |
|---|---|---|
| **Does it remember your lore?** | Forgets between windows; characters change personality session to session | Worldbook + character cards accumulate automatically; relevant lore is injected before every chapter |
| **Do characters drift?** | The protagonist in chapter 30 often feels like a different person | Auto-fill keeps character state current; contradictions are detected after each chapter |
| **Do planted foreshadows pay off?** | You keep your own notebook and hope | Foreshadow tracker reminds you what was planted but never resolved |
| **How do you handle the AI flavor?** | Ask the AI to "sound natural", then submit AI-flavored prose anyway | 12 local rules flag exactly which sentences read as AI-written, why, and how to fix them |
| **Where does the manuscript live?** | Scattered across dozens of chat logs | One project, one local database, one-click export to TXT / Markdown / EPUB / DOCX |
| **Who sees your text?** | Everything is uploaded to someone else's server | Manuscripts and API keys never leave your machine |

In one line: **a chat window is a talkative stranger; Novel Smith is a writing workstation that lives on your computer and remembers every setting you ever wrote.**

---

## Core Highlights

**12 local AI-trace rules** (9 paragraph-level + 3 whole-text) run entirely in your browser — no upload, no API cost, re-check as often as you like. Every hit tells you which sentence, why, and how to fix it. **15 lorebook categories** routed by a deterministic classifier. **2058 test cases** gate every change. **140 API routes**, all serving localhost only.

| Highlight | Detail |
|------|------|
| **Lore pipeline (auto-fill, optional)** | After each chapter, turn on "auto-fill" to extract structured tables → auto-create character cards / lorebook → auto-detect relationships → auto-write back the storyline; off by default so pure-hand writers are not disturbed |
| **Long-form memory, no degradation** | Tiered memory engine: sliding window + long-range chapter compression + S/A/B four-tier event memory — 100+ chapters without losing or degrading characters / foreshadowing / settings |
| **Batch writing, two-stage flow** | Generate 1–10 chapters at once: outlines first for you to edit, then bodies written in the background; you can close the window and it keeps running |
| **Stitch-monster continuation** | When the main arc ends, the system auto-constructs a承接 new main arc — the plot never runs dry; three pacing modes (fast / balanced / slow-burn) |
| **Character card system** | AI fill (all fields + 3-layer personality + storyline + relationships), AI expand, batch selection, auto-classify, auto-dedupe & merge |
| **Draggable relationship graph** | Built-in "interpersonal relations" list + dual-view graph; nodes draggable, layout remembered, double-click to open the card |
| **Data ownership** | Local SQLite file store (`./data/novelforge.db`), zero-config out of the box; no cloud, no subscription, no account |
| **Book dissection learning** | 15-dimension analysis of other works + style-mimic engine — dissect more, write better |
| **Zero-threshold start** | 17 built-in presets, one-click sample novel "山海拾遗" (Shanhai Legacy), 8 genre starters — clone and use immediately |
| **15-category lorebook system** | 15 setting modules (destiny system / physics / public systems, etc.), auto-routed by a deterministic classifier |
| **Storyline progress quantification** | Main / side arc seven elements + per-chapter progress percentage; the AI perceives the plot in real time as it writes |
| **Local review self-check (AI-trace)** | After writing, one-click "AI-trace" scan: zero network, zero cost, per-paragraph green/yellow/red scoring, highlights each AI-flavor hit (clichés / padding / hollow adverbs); unpublished drafts **stay on your machine, never uploaded** — self-review before submission |

---

## Quick Start

> Easiest (recommended): after cloning, just one command auto-completes "generate .env → create local DB tables → start server":
>
> ```bash
> npm run dev:db
> ```
> Open `http://localhost:3001` in your browser.

### Manual Steps

```bash
git clone https://github.com/huanweide/novel-smith.git
cd novel-smith
cp .env.example .env          # defaults to local SQLite, no editing needed
npm install                  # install deps (incl. prebuilt better-sqlite3 binary)
npm run dev:db               # create tables + start
# open http://localhost:3001
```

> All data lives in `./data/novelforge.db` (a single local file), with no external database service. Backup = copy that file.  
> `.env` is gitignored and never uploaded to GitHub; your API key is safe.

---

## Try Without a Key — Taste It First

Haven't signed up for any AI platform, don't want to spend yet? **You can experience the project's most lethal feature first:**

```bash
npm run dev:db     # after it starts, open: http://localhost:3001/detector
```

**AI-trace detector** — paste a passage and instantly see how AI-like it reads:

- An overall score + four tiers (basically clean / slight / obvious / severe);
- Per-paragraph green · yellow · red bars, **each telling you "why it reads as AI-written" and "how to fix it"**;
- Six explainable raw statistics (dash density, sentence-length variance, short-sentence ratio, AI-word density…) — not a mystical score.

The key point: **it runs fully locally — no network, no model call, no API key** — not one byte of your unpublished draft leaves your machine. That is something no cloud AI-detector can do (they all ask you to upload the manuscript).

When it proves useful, go to Settings and configure a key to unlock the full AI-writing capability.

---

## Feature Map

```
Novel Smith
├── Project Management   → create / delete / overview
├── Explore Mode         → chat-based world building (11 steps + card drawing)
├── Writing Desk         → core writing interface
│   ├── Characters       → character cards + AI fill / expand / classify / dedupe-merge + relationship graph
│   ├── Lorebook         → setting entries + AI auto-supplement (trigger-word injection)
│   ├── Outline / Chapters → collapsible chapter outlines, direct body generation, auto chapter titles
│   ├── Auto-fill        → backfill all unfilled chapters (runs in background)
│   ├── Batch Writing    → 1–10 chapters: generate outlines first for confirmation, then bodies in background
│   ├── Storyline        → main/side arc seven elements + chapter progress timeline + stitch-monster continuation
│   ├── Smart Review     → AI scoring diagnosis + auto-finalize on pass + smart whole-book delivery
│   ├── Local Review     → AI-trace scan: per-paragraph green/yellow/red scoring + hit highlighting, never uploaded
│   └── Toolbox / Stats  → conflict simulation, narrative energy curve, writing monitor
├── Book Dissection      → 15-dimension smart analysis + style-mimic engine
├── Settings             → LLM provider + API key + skeleton / config / memory decay
└── Update Log          → full version history
```

---

## Template Marketplace (Community Seed)

Want to share your **outline template / style card / character card**? This repo ships a `templates/` directory as a starting point:

- [`templates/大纲模板.md`](templates/大纲模板.md) (Outline Template) — three-act structure + main-arc seven elements + volume-skeleton
- [`templates/风格卡模板.md`](templates/风格卡模板.md) (Style Card Template) — style params + banned writing + sentence features
- [`templates/角色卡预设.md`](templates/角色卡预设.md) (Character Card Preset) — personality + motivation & fear + relationship web

Copy the file, fill in your settings, and it is ready to use. You are also welcome to post your version in the repo's **Discussions (template sharing)** area so others can use it. More "shareable templates" will keep accumulating in this directory.

---

## First-Run Wizard

### Configure an LLM Provider

1. Click **Settings** in the top-right corner.
2. Pick an LLM provider (recommended: **SiliconFlow** — cheap, domestic, full DeepSeek series available).
3. Fill in your API key.
4. Click **Test Connection** → confirm "connection successful".
5. Click **Save Settings**.

| Provider | Get Key | Price Reference | Recommended Model |
|--------|-------------|---------|---------|
| SiliconFlow | [siliconflow.cn](https://siliconflow.cn) | ¥0.001 / 1K tokens | `Qwen-ai/DeepSeek-V4-Flash` |
| DeepSeek Official | [platform.deepseek.com](https://platform.deepseek.com) | ¥0.002 / 1K tokens | `deepseek-v4-flash` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | $0.005 / 1K tokens | `gpt-4o` |
| Groq | [console.groq.com](https://console.groq.com) | Free tier | `llama-3.3-70b-instruct` |
| Custom | Any OpenAI-compatible service | Varies | Varies |

### Built-in Presets & Creative Workshop

The first time you open the **Creative Workshop**, it auto-seeds **17 built-in demo presets** — click "apply" and start writing, no manual form-filling needed.

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + React 19
- **Styling**: Tailwind CSS v4 (Void Glass design system)
- **Database**: Local SQLite (better-sqlite3 native module) + Prisma 7
- **API**: Next.js API Routes + SSE streaming + background job table
- **AI**: Multi-provider LLM (OpenAI-compatible protocol)
- **Build**: Turbopack (dev) / Webpack (prod)
- **Type checking**: TypeScript strict mode (zero-error gate)

---

## Local Development

```bash
npm run dev            # dev server (localhost:3001, Turbopack HMR)
npx tsc --noEmit       # TypeScript compile check (zero errors to pass)
npx prisma studio      # database admin UI (localhost:5555)
npx prisma db push     # sync Prisma schema → database tables
```

---

## Production Deploy

```bash
npm run build          # build production version
npm start              # start production server
```

> **Must-read before public deploy**: since v3.1.115, all `/api/*` routes sit behind a built-in access control — **only requests from localhost or your LAN are accepted**; anything public gets a 403 (`localhost` / `127.` / `10.` / `192.168.` / `172.16~31.` / `169.254.` / `::1` / `*.local` are allowed). This is a safety net against accidental public deployment, not an account system.
>
> **From v3.1.136 this guard is tiered by trust.** Previously the client IP was taken wholesale from headers like `X-Forwarded-For`, which the client writes itself — connecting directly to the port with a hand-made `X-Forwarded-For: 192.168.1.5` was enough to be treated as LAN and let through. Now the trusted source depends on the deployment shape:
>
> | `TRUSTED_PROXY_MODE` | Trusts what | When |
> | --- | --- | --- |
> | `trust-proxy-header` (default) | `CF-Connecting-IP` → `X-Forwarded-For` → `X-Real-IP` → `Host` | A reverse proxy in front that you trust to sanitize headers. **Backwards compatible.** |
> | `trust-cf-only` | Only `CF-Connecting-IP` (written by Cloudflare's edge, overriding forged values) | **Recommended when exposed publicly** |
> | `direct` | No header at all — only the TCP peer address | No proxy in front |
>
> When no trustworthy source is available the request is **blocked** rather than allowed. `ALLOW_UNKNOWN_SOURCE=true` is the temporary escape hatch.
>
> If you do want to serve publicly, `ALLOW_PUBLIC=true` is required, and `ALLOW_PUBLIC_TOKEN=<a long random string>` is **strongly recommended alongside it**. Note: setting `ALLOW_PUBLIC` alone also opens access — that is legacy behaviour kept for backwards compatibility — its purpose is to raise the bar from "one mistyped variable" to "two mistakes before the app is exposed". See [SECURITY.md](SECURITY.md).
>
> ⚠️ This is an **IP allow-list, not authentication**. It protects against accidental public deployment, not against other people on the same LAN. Under `trust-cf-only`, an attacker who can reach the port directly around Cloudflare can still forge `CF-Connecting-IP` — **no code can detect that**. The real defence is binding to `127.0.0.1` plus a firewall, so the tunnel is the only way in.

---

## Security & Privacy

- API keys are stored only in the local SQLite database and never uploaded to any server.
- The database, manuscripts, settings, and runtime files all live on your own computer.
- No cloud service, no telemetry, no account system.
- `.env`, runtime state, database files, and `*.pem` are all gitignored.
- CI enforces the gate; no hardcoded secrets in code.

---

## What It Is Not

Clear boundaries beat inflated claims:

- **Not an online service** — No account system, no cloud sync, no "subscribe to unlock more chapters". It is a local program that runs on your machine; your data is one SQLite file.
- **Not a fully automatic book machine** — It manages settings, memory, detection, and export, but you approve every outline and every chapter. You are the author; it is the workstation.
- **Only detection works without a Key** — AI generation, continuation, and polishing need your own API key. Detection, consistency checks, foreshadow tracking, and exports are local and free forever.
- **Not a note app with backlinks** — The worldbook and character cards are structured archives designed for long-form writing (15 categories, auto-classified, auto-filled), not a general-purpose note tool.
- **No guarantee of passing any platform's review** — The local detector is a rule-based scan of common AI-writing patterns that helps you catch issues early. It does not predict any specific platform's algorithm.

---

## Contributing

Novel Smith is a personal open-source project, and all forms of participation are welcome. **Want to get hands on? Read [CONTRIBUTING.md](CONTRIBUTING.md) first** — it has the full path from spinning up the project, the directory structure, the three gates, to "how to file a good Issue".

Three steps to join in:

1. **Star** — The simplest and most useful support; it helps more people discover the project.
2. **Open an Issue** — Hit a bug, thought of a good feature, or found a doc error? Use the Issue template (include version number + reproduction steps).
   Want to discuss ideas, show off work, or ask how-to? Use the repo's **Discussions** area.
3. **Send a PR** — Fix a bug, add a preset, or add a feature. Before changing, run `./scripts/git-snapshot.sh create "description"` to snapshot; after, run the three gates (`tsc` / `vitest` / `next build`).

> Presets are the best community-built material — a polished writing style / worldbuilding / character card can be exported as `.preset.json` to share, or written into an Issue; we are happy to turn it into a built-in demo preset. You can also submit templates directly to the `templates/` directory.

---

## Sponsor

If Novel Smith really helped you write your story, buying the author a milk tea is enough — purely voluntary, changes nothing about the features, and carries no ads.

- **WeChat QR**: In the app, open "Settings → 赞助支持 (Sponsor)" and scan the author's own payment QR code.
- **GitHub Sponsor**: The Sponsor button on this repo's homepage — the same QR code.

> The QR image is just a payment entry point — no keys, no credentials, a plain static file. The project collects no donation amounts or messages on any backend.

---

## License

MIT License — see [LICENSE](LICENSE)

---

> Novel Smith · AI Novel Workshop · Local-first · Your data stays yours
