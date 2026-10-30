**中文** · [README.md](./README.md)

<!-- badges -->

[![License](https://img.shields.io/github/license/huanweide/novel-smith)](LICENSE)
[![CI](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/huanweide/novel-smith)](https://github.com/huanweide/novel-smith/stargazers)
[![Live Demo · Rule Engine](https://img.shields.io/badge/live%20demo-rule%20engine%20self--check-22c55e)](https://huanweide.github.io/novel-smith/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/huanweide/novel-smith/pulls)

<!-- /badges -->

<p align="center">
  <img src="assets/banner.svg" alt="novel-smith">
</p>

**English** · [README_EN.md](./README_EN.md)

# 🔨 Novel Smith — AI long-form web-novel writing workshop

> A chat window is a chatty stranger; Novel Smith is an AI writing workshop that lives in your computer and helps you write long-form web fiction — from a one-line spark to a finished book. AI drafts, you decide.

`AI Writing` · `Long-form web fiction` · `Creative Workshop` · `Tiered Memory Engine` · `Local-First` · `Data stays on your machine · zero upload` · `Local AI-taste self-check (optional)`

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org) [![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev) [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![SQLite](https://img.shields.io/badge/SQLite-local-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org) [![LLM](https://img.shields.io/badge/LLM-DeepSeek%20%2F%20OpenAI%20compatible-4D6BFE?style=flat-square)](https://platform.deepseek.com) [![Local-First](https://img.shields.io/badge/Local--First-zero%20upload-22C55E?style=flat-square)](https://github.com/huanweide/novel-smith)

**One-line spark → explore the setting → auto-fill cards → batch writing → local review → export to book**

> 💡 **One-line pitch**: the worst part of writing long fiction with AI is the middle — the character breaks, the setup stops matching, the ideas run dry. Novel Smith packs **AI writing + tiered memory + a creative workshop** into your computer: AI helps you go from spark to book, and your characters stay consistent even at chapter 100; settings are filed automatically and you can take over anytime. **Not one byte of your unpublished drafts is uploaded.**

<p align="center">
  <a href="https://huanweide.github.io/novel-smith/"><b>▶ Live Demo (rule engine · no key needed)</b></a>
  &nbsp;·&nbsp;
  <a href="#quick-start"><b>🚀 Run locally with one command</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/huanweide/novel-smith/releases/tag/v3.1.156"><b>💻 Desktop build, download and run (double-click)</b></a>
</p>

> ⚡ **Don't want to install Node or type commands?** Grab the desktop build and double-click to open → [GitHub Releases · v3.1.156](https://github.com/huanweide/novel-smith/releases/tag/v3.1.156) (no code signing — Windows SmartScreen may block the first launch; click "Run anyway").

---

## Core Capabilities

- 🤖 **Write a complete long-form with AI** — from spark, worldview, chapter outlines to per-chapter prose, AI drafts for you; you only handle creativity and sign-off. A built-in "Creative Workshop" preset marketplace lets you apply style / worldview / character-card / world-book templates in one click, so beginners can start immediately.
- 🧠 **Characters never break, no matter how long** — a built-in "Tiered Memory Engine" (recent chapters see full text, slightly older ones see summaries, distant ones are compressed into key points by AI; context is always carried) keeps character, foreshadowing, and setting intact through 100 chapters. This is the biggest difference from ordinary "let AI write for you".
- 📋 **Settings grow by themselves** — after each chapter, characters / locations / factions are auto-extracted into character cards and a world book (15 auto-classified categories), with a one-click relationship graph. No notebook required.
- 🔒 **Zero upload of unpublished drafts** — everything lives in one local SQLite file on your computer; prose and API keys never leave the machine. No account, no cloud, no telemetry.
- 🔍 **(Optional) offline AI-taste self-check** — 12 local rules flag, sentence by sentence, "what looks AI, why, and how to fix it", with no network, no model calls, no cost (try it in 30 seconds below). It's a quality tool, not core — you can export directly without ever opening it.

## Who Should Use It / Who Shouldn't Yet

**This workshop is for you if —**

- You write (or want to write) mid-to-long web fiction / novels and need to maintain characters, foreshadowing, and worldview over the long haul;
- You've used AI to write fiction but were put off by "memory loss and broken characters by chapter 30";
- You mind uploading unpublished drafts to any cloud;
- You want the "AI does the work, you sign off" collaboration, not a button that spits out a soulless whole book.

**Hold off if —**

- You only want a prompt to auto-spew an entire novel (unrealistic, and we deliberately don't do it);
- You absolutely refuse to run any local program and won't touch `npm` — you can try the [online demo](https://huanweide.github.io/novel-smith/) to check AI-taste, but full features need a local run;
- You only write one-off short copy, social posts, etc.

[30-Second Overview](#30-second-overview) · [Core Capabilities](#core-capabilities) · [Interface](#interface) · [What It Can Do](#what-it-can-do) · [Features](#features) · [Desktop](#desktop-version) · [Quick Start](#quick-start) · [Command Reference](#command-reference) · [Architecture](#architecture) · [Add Your Own Rule](#add-your-own-rule) · [Roadmap](#roadmap) · [Contributing](#contributing) · [Star](#star)

**Current version: v3.1.156** · local SQLite, zero config · 2163 test cases · 140 API routes · 17 built-in demo presets · MIT open source

> Recent versions focused on: **tiered memory against forgetting** · **creative-workshop preset marketplace** · **auto-filing pipeline** · **optional local AI-taste self-check** — all running locally, drafts zero upload.

---

## 30-Second Overview

Novel Smith is a **local workbench for writing long fiction**; the AI-taste detector is just the most intuitive capability of its fully offline "rule engine". Without installing or configuring a key, open the [online demo](https://huanweide.github.io/novel-smith/), paste your own text, and immediately see how the rule engine flags AI-ish phrasing sentence by sentence, why, and how to fix it.

Below is **real output** (run with this repo's `src/core/humanize` rule engine on the AI-ish text below):

```
Input:

值得注意的是，夜色中的古城显得格外静谧。他缓缓睁开双眼，心中不由得微微一凛，
仿佛有什么东西正在暗处窥视着自己。

综上所述，这场突如其来的变故，不仅仅改变了他一个人的命运，更是深刻地影响了
整个家族的未来走向。他深吸一口气，目光坚定地望向远方——那里，是希望的所在。

阳光透过树叶的缝隙洒落下来，形成斑驳的光影。她轻轻叹了口气，似乎想要说些什么，
却最终什么也没有说出口。
```

```
=== Local AI-taste Self-Check Report ===

AI-trace index  69 / 100          Level: noticeable

Raw statistics (explainable, not a black-box score)
  Total 181 chars · 6 sentences · avg sentence 30.2 chars · std 9.00
  dash density 5.50 /k chars · AI-frequency words 27.60 /k chars · short-sentence ratio 0.0%

Aggregated by rule
  ai-vocab          AI-frequency words     high    x5
  uniform-sentence  too-uniform length     medium  x1
  progressive-pair  "not only…but also…"   medium  x1

Per-paragraph scoring
  [P0] ██████████ 100  3 hits
      · AI-frequency words (high)  "值得注意的是，夜色中的古城显得格外静…"
        why: a textbook expository transition; almost nobody opens a novel's dialogue or narration like this.
        fix: delete it; let facts speak, or replace with a concrete character action.
      · too-uniform length (medium)
        why: the 6 sentences have a length std of only 9.0 (avg 30.2) — measured with a ruler.
        fix: deliberately add a few short sentences (3–8 chars) for rhythm; slip a broken sentence into a long one.
  [P1] ██████████ 100  2 hits
      · AI-frequency words (high)  "综上所述，这场突如其来的变故，不…"
        why: thesis voice; jarring inside fiction prose.
        fix: delete the whole sentence, or turn it into the character's judgment and choice.
      · "not only…but also…" (medium)
        why: two separable points welded into one long sentence — tiring to read, a common AI trick for fake hierarchy.
  [P2] ██████████ 100  2 hits
      · AI-frequency words (high)  "阳光透过树叶的缝隙洒落下来，形成斑驳…"
        why: a fixed template sentence AI uses for environment description.
        fix: replace with plot-relevant environmental detail; don't pad with generic beauty.
```

**This whole snippet runs in your browser**: no network, no upload, no model call, no cost — not one byte of your unpublished draft leaves your machine. That's something no cloud AI detector can do (they all require you to upload the draft).

> ⚠️ The rule engine only helps **reduce machine tone**; it cannot guarantee passing any platform's AI-rate check. Platform algorithms are undisclosed and constantly changing; results are for reference only.

---

## Interface

Real running screenshots, not concept art. Full demo: [online demo](https://huanweide.github.io/novel-smith/).

| Home · novel universe entry | Explore mode · conversational world-building |
|---|---|
| ![](docs/screenshots/home.png) | ![](docs/screenshots/explore.png) |

| Home | Workbench |
|---|---|
| ![](docs/screenshots/novel-smith-home.png) | ![](docs/screenshots/novel-smith-workbench.png) |

Full loop demo (from one-line spark to exported book):

![Workflow demo](docs/screenshots/demo.gif)

---

## What It Can Do

### Match a capability to your goal

| What you want to do | How Novel Smith helps |
| --- | --- |
| Write a long web novel with AI | AI drafts: from spark, worldview, chapter outlines to per-chapter prose — AI writes throughout, you only sign off |
| Use proven techniques, fewer detours | Creative Workshop preset marketplace: one-click apply style / worldview / character-card / world-book / plot templates |
| Turn a one-line spark into a full worldview | Explore mode: 11-step guided conversation that turns a spark into setting / characters / outline |
| Keep characters consistent and foreshadowing alive even when long | Tiered memory engine: recent 4 chapters full text + recent 3 summaries + distant floors compressed — no drop-off at chapter 100 |
| Don't want to notebook your settings | Auto-filing pipeline: each chapter extracts characters / locations / factions → character cards + world book (15 auto-classified categories) |
| (Optional) reduce machine tone in drafts | Local AI-taste self-check: 12 rules flag per sentence "why it looks AI, how to fix", offline and free |
| Keep drafts off the cloud | Local single-file SQLite library: no account, no cloud, no telemetry, not one byte uploaded |
| Export to editor / publish to platforms | One-click five-format export: TXT / Markdown / HTML / EPUB / DOCX |

Writing a long novel, the scariest part isn't the opening — it's **the middle**: chapter 30's protagonist suddenly acts like a different person, a foreshadowing planted in chapter 12 is never mentioned again, and the AI gets blander and blander.

Novel Smith hands these "can't-remember tasks" to the workbench to manage automatically; you only handle creativity and the actual writing:

```
You: one-line spark "a cultivation world where a boy can't use magic"

  Round 1  Explore mode      → 11-step guided conversation turns a spark into a full worldview
  Round 2  Auto-filing       → extract characters/locations/factions → build character cards + world-book entries (15-type auto-routing)
  Round 3  Batch writing      → first produce chapter outlines 1–10 for you to edit; on confirm, write prose chapter by chapter in the background
  Round 4  Tiered memory inject → recent 4 full + recent 3 summaries + distant AI-compressed; no drop-off at chapter 100
  Round 5  Local self-check  → 12 rules scan per paragraph; green/yellow/red flag which sentence looks AI, why, how to fix
  Round 6  One-click export  → TXT / Markdown / HTML / EPUB / DOCX
```

**Generating prose, dissecting books, and managing characters/world-book writes to a local SQLite file**, so it must run on your own machine (the online demo runs in a stateless cloud environment and can't write local files). **Your text never leaves your machine.**

### Which features need no API key

| Feature | Key needed |
|---|---|
| AI-taste detection, local self-check | **No** — pure local rule engine |
| Word count, consistency check, foreshadowing tracking, character relationship graph | No |
| Book dissection analysis, Word / EPUB export | No |
| AI prose generation, continuation, polishing, character dialogue | Yes (bring your own key) |

---

## Features

- 🤖 **AI writing engine (core)** — from spark, worldview, chapter outlines to per-chapter prose, AI drafts for you; a built-in "Creative Workshop" preset marketplace applies style / worldview / character-card / world-book templates in one click. See `src/app/workshop`, `src/core/write-generation.ts`.
- 🧠 **Tiered memory engine (default)** — recent 4 chapters full text + recent 3 summaries + distant floors AI-compressed, with S/A/B/C four-level event decay (S permanent, C cleared after 5 chapters), so character/foreshadowing/setting survive 100 chapters. See `src/lib/memory-decay.ts`, `src/core/memory/`.
- 📋 **Auto-filing pipeline (optional · off by default)** — after each chapter, extract a structured table → auto-build character cards and world-book entries → detect character relations → write back the story line; pure handwriting authors are never disturbed. See `src/core/assembly/engine.ts`.
- 📖 **World-book 15-category deterministic classifier** — geography / factions / power-system / fate-system / physics / public-institution… 15 categories, keyword-weighted auto-routing, no fuzzy guessing. See `src/lib/world-category-classifier.ts`.
- ⚖️ **Writing rule engine (specificity adjudication)** — rules carry 6 scopes (global / volume / chapter-range / event-type / character-scene / conditional-trigger); on conflict, adjudicate by "priority vs specificity" and give the winning reason. See `src/core/rules.ts`.
- 🧵 **Seam-monster driver** — after the main line ends, auto-constructs a承接 new main line, so the plot never runs dry; three pacing modes (fast / balanced / slow-burn) adjustable. Entry: `src/app/api/storylines/generate/route.ts`.
- 🔒 **Network gate (default: local only)** — all `/api/*` carry an access-control layer; public-source requests are 403 by default; three trust modes (`trust-proxy-header` / `trust-cf-only` / `direct`) prevent "accidental public deployment". See `src/lib/net-guard.ts`, `src/proxy.ts`.
- 💾 **Local single SQLite file library** — `./data/novelforge.db`, zero-config out of the box; backup is just copying this file. No cloud service, no subscription, no account, no telemetry.
- 📦 **Five-format one-click export** — TXT / Markdown / HTML / EPUB / DOCX, packaged purely locally. See `src/core/docx.ts`, `src/core/epub.ts`.
- 🔍 **Local AI-taste self-check (optional · on by default)** — 12 regex-and-statistics rules, zero LLM calls, zero network requests, flag per sentence "why it looks AI, how to fix", no black-box scoring. It's quality assistance, not a writing prerequisite. See `src/core/humanize/rules.ts`.

---

<a id="desktop"></a>

## Desktop Version: Download and Run (no Node / no command line)

> Don't want to install Node or type commands? Grab the desktop build and double-click to open.

- **Download**: [GitHub Releases · v3.1.156](https://github.com/huanweide/novel-smith/releases/tag/v3.1.156)
- Three packages, pick what you like:
  - `NovelSmith-3.1.156-setup.exe` (recommended) — NSIS installer, double-click to install, creates desktop / start-menu shortcuts.
  - `NovelSmith-3.1.156-portable.exe` — single-file self-extracting; USB drive / double-click to run, no registry writes.
  - `NovelSmith-3.1.156.zip` — extract and run.
- **Blocked by Windows SmartScreen on first run?** This is the normal "no code signing" prompt, not a virus; click "Run anyway".
- **Top banner "AI not configured" on first open?** Go to Settings (⚙️) and fill in an LLM key, or set `LLM_API_KEY` in `.env`. It doesn't block opening, nor the local-writing / dissection features that don't need AI.
- Data lands in one local SQLite file; backup = copy that file.

![Desktop app real running interface](docs/screenshots/desktop-app-home.png)

> The image above is the desktop app's real home page (rendered by the bundled Next service). The top "AI not configured" banner is only because there's no LLM key; fill a key in Settings and it disappears, without affecting local-writing / dissection features that don't depend on AI.

## Quick Start

### Easiest (one line)

```bash
npm run dev:db     # generate .env → build local DB tables → start
```

Open `http://localhost:3001` in a browser.

### Manual step by step

```bash
git clone https://github.com/huanweide/novel-smith.git
cd novel-smith
cp .env.example .env          # defaults to local SQLite, no manual edit needed
npm install                  # install deps (incl. better-sqlite3 native module)
npm run dev:db               # build tables + start
# open http://localhost:3001 in a browser
```

```
$ npm run dev:db
✔ .env generated (DATABASE_URL="file:./data/novelforge.db")
✔ Prisma schema synced to ./data/novelforge.db
✔ 17 built-in demo presets seeded
  ▲ Next.js 16.3.8
  - Local:   http://localhost:3001
  ✓ Ready in 2.4s
```

> All data lives in `./data/novelforge.db` (one local file), with no external database service dependency.

> `.env` and `/data/` are both ignored by `.gitignore` and never uploaded to GitHub.

### Zero-threshold trial: taste it without a key

```bash
npm run dev:db     # after starting, open http://localhost:3001/detector
```

The AI-taste detector gives you: a total score + four levels (basically clean / slight / noticeable / severe), per-paragraph green/yellow/red bars, **each hit tells you why it looks AI-written and how to fix it**, plus six explainable raw statistics. Once it's useful, go to Settings and configure a key.

### First-time LLM provider setup

1. Top-right **Settings** → pick a provider (recommend **SiliconFlow** — cheap domestic option, full DeepSeek family available)
2. Fill API Key → click **Test connection** → confirm "connected" → **Save settings**

| Provider | Get key | Price reference | Recommended model |
|---|---|---|---|
| SiliconFlow | [siliconflow.cn](https://siliconflow.cn) | ¥0.001~/1K tokens | `deepseek-ai/DeepSeek-V4-Flash` |
| DeepSeek official | [platform.deepseek.com](https://platform.deepseek.com) | ¥0.002~/1K tokens | `deepseek-v4-flash` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | $0.005~/1K tokens | `gpt-4o` |
| Groq | [console.groq.com](https://console.groq.com) | free quota | `llama-3.3-70b-versatile` |
| Custom | any OpenAI-compatible service | per provider | per provider |

Opening "Creative Workshop" the first time auto-seeds **17 built-in demo presets**; click "apply" to start writing, no manual form-filling needed.

---

## Command Reference

| Command | Purpose |
|---|---|
| `npm run dev:db` | build local DB + start dev server (recommended entry) |
| `npm run dev` | start dev server only (`localhost:3001`, Turbopack HMR) |
| `npm run build` | production build (guarded by `scripts/safe-build.mjs`) |
| `npm start` | start production server |
| `npm test` | run all vitest cases (2163) |
| `npm run test:coverage` | tests with coverage |
| `npx tsc --noEmit` | TypeScript strict mode check (zero errors to pass) |
| `npm run lint` | ESLint (**legacy tech debt, not a hard gate yet**) |
| `npm run lint:colors` | color guard ARCH-7 (soft reminder, non-blocking) |
| `npm run doctor` | environment self-check (deps / DB / config) |
| `npx prisma studio` | DB visual panel (`localhost:5555`) |
| `npx prisma db push` | sync Prisma schema → local SQLite |
| `npm run db:seed` | seed built-in presets and sample data |

---

## Architecture

**One sentence**: a local single-file SQLite is the foundation; the writing flow is a closed loop of "load context → generate → distill-and-write-back → local review"; settings and memory are not one-off text stuffed into a prompt, but structured archives that auto-settle and auto-decay with every chapter.

### Core concepts

| Concept | Meaning |
|---|---|
| **Tiered Memory** | recent 4 chapters full text + recent 3 summaries + distant floors AI-compressed — a three-layer context assembly that solves "the longer you write, the dumber it gets" |
| **Event tiers (S/A/B/C)** | four importance tiers with forget-curve decay: S permanent, A→B after 30 chapters, B→C after 15, C deleted after 5 |
| **Distillation** | after each chapter, extract structured facts and write back to character cards / world book / story line, so settings grow with writing |
| **World Book** | a 15-category setting entry library, injected into context before generation by trigger words |
| **Auto-filing (Assembly)** | auto-build character cards and world-book entries from AI-extracted tables, and detect character relations |
| **Humanize** | 12 purely local rules scan, paragraph-level green/yellow/red scoring, giving "why + how to fix", never auto-rewriting the prose |
| **Rule Specificity** | writing rules weighted across 6 scopes; on conflict, adjudicate by priority/specificity and give the winning reason |

### Writing loop

```
        ┌──────────────────────────────────────────┐
        │                                          │
  one-line spark                                    │
        │                                          │
        ▼                                          │
  Explore mode (11 steps) ──► worldview / characters / factions
        │                                          │
        ▼                                          │
  load context ◄──── tiered memory (recent full + summaries + distant compress)│
        │          ◄──── world-book trigger injection              │
        │          ◄──── writing rules (specificity adjudication)  │
        ▼                                          │
  chapter outline ──► you confirm/edit ──► prose generation        │
        │                                          │
        ▼                                          │
  distill & write back ──► character cards / world book / story line ──┘
        │
        ▼
  local self-check (12 rules, paragraph-level scoring)
        │
        ├── few hits ──► finalize ──► export TXT/MD/HTML/EPUB/DOCX
        └── many hits ──► back to prose (author fixes; machine doesn't ghostwrite)
```

### Core modules

| Module | File | Notes |
|---|---|---|
| Humanize rule library | `src/core/humanize/rules.ts` | 9 paragraph-level + 3 document-level rules, pure regex and statistics |
| Self-check scoring entry | `src/core/humanize/index.ts` | aggregate 5 explainable stats → total + level + per-paragraph report |
| One-click fix suggestions | `src/core/humanize/fixes.ts` | only deterministic fixes, and **must be applied by author click** |
| Platform risk hint | `src/core/humanize/platform-risk.ts` | risk hint by common platform wording (no algorithm prediction) |
| Memory decay engine | `src/lib/memory-decay.ts` | S/A/B/C four-level forget curve, independent of foreshadowing |
| Semantic recall | `src/core/memory/semantic-recall.ts` | relevance recall of distant-floor events |
| Memory classifier | `src/lib/memory-classifier.ts` | decide which memory tier/category an event belongs to |
| Distillation scorer | `src/core/distillation/scorer.ts` | event importance and S/A/B/C grading |
| Context loader | `src/core/pipeline/context-loader.ts` | assemble tiered memory + world book + rules into one injection context |
| Outline / prose generation | `src/core/pipeline/generate-chapter-outline.ts`, `plan-chapter.ts` | two-stage flow: outline first, then prose |
| Auto-filing pipeline | `src/core/assembly/engine.ts` | table → character card/world book → relation detection → write-back |
| World-book classifier | `src/lib/world-category-classifier.ts` | 15-category deterministic routing, single authoritative source for tags |
| Writing rule engine | `src/core/rules.ts` | 6-scope weights + conflict adjudication |
| Consistency check | `src/core/consistency/detectConflicts.ts` | extract facts → detect conflicts → suggest fixes |
| Foreshadowing tracking | `src/core/foreshadowing.ts` | auto-remind of planted-but-unresolved threads |
| Story-line advance | `src/core/storyline/generate.ts`, `execute-task.ts` | main/side-line seven elements + seam-monster advance |
| Dissect & imitation | `src/core/dissect/engine.ts`, `imitation-engine.ts` | 15-dimension dissection of others' works + imitation |
| Network gate | `src/lib/net-guard.ts`, `src/proxy.ts` | `/api/*` access control and three trust modes |
| Export | `src/core/docx.ts`, `src/core/epub.ts` | local DOCX / EPUB packaging |

Deeper analogical explanation: [ARCHITECTURE.md](ARCHITECTURE.md); per-module detail: [`docs/architecture-reference/`](docs/architecture-reference/).

---

## Add Your Own Rule

The humanize engine is open — when you spot machine tone in your own style, add a rule (`src/core/humanize/rules.ts`):

```ts
// Rule example: detect the "double negation then turn" AI signature sentence
export function detectNegativeParallel(text: string, offset = 0): AiTraceHit[] {
  const hits: AiTraceHit[] = [];
  const re = /不是([^，。！？；\n]{1,20})[，、]不是([^，。！？；\n]{1,20})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    hits.push({
      ruleId: "negative-parallel",
      ruleName: "negative parallelism",
      severity: "high",
      excerpt: excerptAt(text, m.index, m[0].length),
      start: offset + m.index,
      end: offset + m.index + m[0].length,
      reason: "Two negations then a turn, almost an AI writing signature.",
      suggestion: "Write 'what it is' directly; don't first wind around two 'not what it is'.",
    });
  }
  return hits;
}

// Add it to the paragraph-level rule table to take effect
export const PARAGRAPH_RULES = [/* ...existing rules, */ detectNegativeParallel] as const;
```

After writing the rule, `npm test` runs all 2163 cases to guard existing behavior. Template-style extensions (outline / style card / character card) can be submitted directly into the `templates/` directory.

---

## Roadmap

- [x] Local single-file SQLite architecture (zero config, no Docker)
- [x] Humanize rule engine + zero-threshold online demo
- [x] Tiered memory engine + event-tier decay
- [x] Auto-filing pipeline + world-book 15-category classifier
- [x] Batch-writing two-stage flow (outline first, then prose)
- [x] Smart review + five-format export
- [x] `/api/*` access control and three trust modes
- [ ] Clear ESLint legacy tech debt (1134 errors, mostly historical `no-explicit-any`); lift the exemption into a hard gate
- [ ] Preset community: import/export and sharing loop for built-in demo presets
- [ ] More built-in demo presets and genre starters

Full schedule and delivery ledger: [ROADMAP.md](ROADMAP.md).

---

## Production Deployment

```bash
npm run build          # build production version
npm start              # start production server
```

> **Must-read before public deployment**: since v3.1.115, all `/api/*` carry a built-in access-control layer — **only requests from localhost or the LAN are accepted**; public-source requests always return 403 (allows `localhost` / `127.` / `10.` / `192.168.` / `172.16~31.` / `169.254.` / `::1` / `*.local`). This is a bottom line against "accidental public deployment", **not an account system**.

> | `TRUSTED_PROXY_MODE` | Trusts what | Use when |
> | --- | --- | --- |
> | `trust-proxy-header` (default) | `CF-Connecting-IP` → `X-Forwarded-For` → `X-Real-IP` → `Host` | you do have a reverse proxy in front and trust it to clean headers |
> | `trust-cf-only` | only `CF-Connecting-IP` | **recommended when exposed publicly** |
> | `direct` | trusts no request header, only the TCP peer address | no front proxy |

> When no trusted source can be obtained, it's **blocked** by default. Temporary allow via `ALLOW_UNKNOWN_SOURCE=true`; if you really must serve externally, `ALLOW_PUBLIC=true` is **strongly recommended together with** `ALLOW_PUBLIC_TOKEN=<custom long random string>`. Full notes: [SECURITY.md](SECURITY.md).

> ⚠️ This layer is a **subnet whitelist, not authentication**. It stops accidental public deployment, not other people on the same LAN. The real defense is listening only on `127.0.0.1` + a firewall.

---

## Contributing

A personal open-source project; all forms of participation are welcome. **Want to dive in? Read [CONTRIBUTING.md](CONTRIBUTING.md)** — it has the full path from zero-to-running, directory structure, the three gates, to "how to file a good Issue".

1. **Star it** — the simplest and most useful support.
2. **Open an Issue** — bug / new feature / doc error, use the Issue template (include version + repro steps). For ideas and showcasing work, go to **Discussions**.
3. **Submit a PR** — before changing, `./scripts/git-snapshot.sh create "note"` to snapshot; after, run the three gates (`npx tsc --noEmit` / `npm test` / `npm run build`).

> Presets are the best community-built material — the style / worldview / character card you polish can be exported as `.preset.json` to share, or written into an Issue; we're happy to turn it into a built-in demo preset.

Local development:

```bash
npm run dev            # dev server (localhost:3001)
npx tsc --noEmit       # type check (zero errors to pass)
npm test               # 2163 cases
npx prisma studio      # DB panel (localhost:5555)
```

---

## Security Boundaries

- **No upload** — prose, settings, and API keys all live in your own SQLite file; no cloud service, no telemetry, no account system.
- **No ghostwriting** — humanize only flags traces and gives suggestions; even the "one-click apply" fix **only ever executes when the author clicks**, never auto-rewriting the prose.
- **No pass-guarantee** — the rule engine only reduces machine tone; it predicts no specific platform's algorithm.
- **Not an online service** — no account, no cloud sync, no "membership unlocks more chapters".
- `.env`, `/data/`, `*.db`, certificates, and credential files are all ignored by `.gitignore`; CI includes security checks, and the code has no hardcoded secrets.

---

## What It Is Not

- **Not an auto-book-machine** — every chapter's outline and prose need your nod. You're the author; it's the workbench.
- **Only detection is key-free** — AI generation/continuation/polishing needs your own key; detection, consistency check, foreshadowing tracking, and export are always free, always offline.
- **Not a bidirectional-link shell of note software** — the world book and character cards are structured archives designed for "writing long fiction" (15 categories, auto-classified, auto-filled).

---

## Other Tools by the Same Author

**A Star helps the same-family tools get seen:**

**Subtitle / video suite** (solving different parts of "turn video into text"):

- 🎬 [bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) · universal video subtitle extraction + AI dictation when none
- 🎓 [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · Zhihuishu course auto-play / resume / AI answering
- 🔴 [live-subtitle](https://github.com/huanweide/live-subtitle) · live real-time subtitles
- ✂️ [video-brief](https://github.com/huanweide/video-brief) · video content summary

**Code-health suite** (18-axis zero-dependency CLI):

- 🩺 [family-showcase](https://github.com/huanweide/family-showcase) · hub for all doctor tools

**Command-line utilities**:

- 🔧 [idiot-index](https://github.com/huanweide/idiot-index) · [recall-cli](https://github.com/huanweide/recall-cli) · [forge-safeguard](https://github.com/huanweide/forge-safeguard-20260812)

**All repositories**: <https://github.com/huanweide?tab=repositories>

---

## License

MIT License — see [LICENSE](LICENSE)

---

## Star

🔨 If this workshop helped you get your story written, **give it a Star** so more long-fiction writers can find it.

[![Star](https://img.shields.io/github/stars/huanweide/novel-smith?style=social)](https://github.com/huanweide/novel-smith/stargazers)

> Novel Smith · AI novel workshop · local-first · your data is yours
