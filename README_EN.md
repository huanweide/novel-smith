<p align="center">
  <img src="assets/banner.svg" alt="novel-smith">
</p>

<p align="center">
  <b>**中文** · [README.md](./README.md)</b>
</p>

<!-- badges -->
[![License](https://img.shields.io/github/license/huanweide/novel-smith)](LICENSE)
[![CI](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/novel-smith/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/huanweide/novel-smith)](https://github.com/huanweide/novel-smith/stargazers)
[![Online demo · rule-engine self-check](https://img.shields.io/badge/online%20demo-rule%20engine%20self--check-22c55e)](https://huanweide.github.io/novel-smith/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/huanweide/novel-smith/pulls)
<!-- /badges -->

# 🔨 Novel Smith — AI long-form web-novel writing workshop

> **English**: A chatty chat window is a stranger who talks too much; Novel Smith is an AI writing workshop that lives in your computer and helps you write long-form web novels — from a one-line spark to a finished book, the AI drafts and you decide.

`AI writing` · `long-form web novel` · `creative workshop` · `tiered memory engine` · `Local-First` · `data never leaves your machine · zero-upload privacy` · `optional local "AI-taste" self-check`

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org) [![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev) [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![SQLite](https://img.shields.io/badge/SQLite-local-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org) [![LLM](https://img.shields.io/badge/LLM-DeepSeek%20%2F%20OpenAI%20compatible-4D6BFE?style=flat-square)](https://platform.deepseek.com) [![Local-First](https://img.shields.io/badge/Local--First-zero%20upload-22C55E?style=flat-square)](https://github.com/huanweide/novel-smith)

**One-line spark → explore settings → auto world-building → batch writing → local self-check → export to book**

> 💡 **One-line positioning**: Writing long-form web novels with AI, the biggest fear is writing yourself into a corner mid-book — broken character persona, mismatched settings, dried-up inspiration. Novel Smith packs **AI writing + tiered memory + a creative workshop** into your computer: the AI helps you write from spark to book, and even at 100 chapters the persona doesn't collapse, settings auto-file themselves, and you take over to revise anytime. **Not a single byte of unpublished manuscript is uploaded.**

<p align="center">
  <a href="https://huanweide.github.io/novel-smith/"><b>▶ Online demo (rule engine · no key needed)</b></a>
  &nbsp;·&nbsp;
  <a href="#quick-start"><b>🚀 Run locally with one command</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/huanweide/novel-smith/releases/tag/v3.1.156"><b>💻 Desktop build, download and double-click</b></a>
</p>

> ⚡ **Don't want to install Node / type commands?** Grab the desktop build and double-click to open → [GitHub Releases · v3.1.156](https://github.com/huanweide/novel-smith/releases/tag/v3.1.156) (no code signing; Windows SmartScreen blocks it on first run — click "Run anyway").

## ✨ Core capabilities (what it actually does, in one line each)

- 🤖 **Write a complete long-form with AI** — from spark, worldview, chapter outlines to chapter-by-chapter prose, the AI drafts and you handle creativity and final calls; a built-in "creative workshop" preset marketplace lets you apply writing-style / worldview / character-card / world-book templates in one click, so beginners can start immediately.
- 🧠 **Persona never collapses, no matter how long** — a built-in "tiered memory engine" (full text of recent chapters, summaries of slightly older ones, AI-compressed key points for the far ones; it always carries context while writing). At 100 chapters, persona, foreshadowing, and settings stay intact. This is the biggest difference from ordinary "let AI write for you".
- 📋 **Settings grow themselves** — after each chapter, characters / locations / factions are auto-extracted into character cards and a world book (15 auto-classified categories), with a one-click relationship graph, so you don't need a paper notebook.
- 🔒 **Zero upload of unpublished manuscripts** — everything lives in a local SQLite file on your computer; prose and API keys never leave the machine; no account, no cloud, no telemetry.
- 🔍 **(Optional) offline self-check** — 12 local rules flag, sentence by sentence, "which parts read like AI, why, and how to fix", with no network, no model calls, no cost (try it in 30 seconds below). It's purely a quality tool, not core — you can finish and export without ever opening it.

## Who should use / who should hold off

**This workshop is for you if —**

- You're writing (or want to write) a medium-to-long web novel / fiction and need to maintain persona, foreshadowing, and worldview over the long haul;
- You've used AI to write fiction but were put off by "loses memory by chapter 30, persona collapses";
- You mind uploading unpublished manuscripts to any cloud;
- You want the "AI does the work, you make the calls" collaboration, not a one-click generated soulless book.

**Hold off if —**

- You only want a single prompt to auto-spit an entire novel (unrealistic, and deliberately not built);
- You absolutely won't run any local program, not even `npm` — you can try the [online demo](https://huanweide.github.io/novel-smith/) to de-AI-ify text, but full features need a local run;
- You only write one-off short copy / social posts.

[30-second overview](#30-second-overview) · [Core capabilities](#core-capabilities) · [UI tour](#ui-tour) · [What it does](#what-it-does) · [Features](#features) · [Desktop download](#desktop) · [Quick start](#quick-start) · [Command reference](#command-reference) · [Architecture](#architecture) · [Add your own rule](#add-your-own-rule) · [Roadmap](#roadmap) · [Contributing](#contributing) · [⭐ Star](#star)

**Current version: v3.1.156** · local SQLite, zero config · 2163 test cases · 140 API routes · 17 built-in demo presets · MIT open source

> Recent versions focused on: **tiered-memory anti-forgetting** · **creative-workshop preset marketplace** · **auto world-building pipeline** · **optional local self-check** — all run locally, manuscripts never uploaded.

---

## 30-second overview

Novel Smith is a **local workbench for writing long-form**, and the AI-taste detection is just the most tangible ability of its fully offline "rule engine". Without installing or configuring a key, **open the [online demo](https://huanweide.github.io/novel-smith/)**, paste a piece of your own text, and immediately see how the rule engine flags AI-ish phrasing sentence by sentence — why, and how to fix.

Below is **real output** (run on this repo's `src/core/humanize` rule engine with the AI-ish text below):

```
=== Local self-check report ===

AI-trace index  69 / 100          level: noticeable

Raw statistics (explainable, not a black-box score)

  total chars 181 · sentences 6 · avg sentence length 30.2 · sentence-length std 9.00

  dash density 5.50 /k-chars · AI high-freq words 27.60 /k-chars · short-sentence ratio 0.0%

Aggregated by rule

  ai-vocab          AI high-frequency words   high    x5

  uniform-sentence  too-uniform sentence length  medium  x1

  progressive-pair  "not only… but also…" progressive  medium  x1

Per-paragraph scoring

  [P0] ██████████ 100   hits 3

      · AI high-frequency words (high)  "It is worth noting that the ancient city at night…"

         why: classic expository-transition tone; almost nobody opens a novel dialogue/narration like this.

         how: delete it outright, let the facts speak, or replace with a concrete character action.

      · too-uniform sentence length (medium)

         why: the 6 sentences' length std is only 9.0 chars (avg 30.2), like measured with a ruler.

         how: deliberately add a few short sentences (3–8 chars) for rhythm; slip a broken sentence into a long one.

  [P1] ██████████ 100   hits 2

      · AI high-frequency words (high)  "In summary, this sudden turn of events…"

         why: thesis/academic tone, very jarring inside novel prose.

         how: delete the whole sentence, or turn it into the character's judgment and choice.

      · "not only… but also…" progressive (medium)

         why: twists two separable things into one long sentence; tiring to read, also a common AI trick for "layered feel".

  [P2] ██████████ 100   hits 2

      · AI high-frequency words (high)  "Sunlight filtered through the gaps in the leaves…"

         why: AI's fixed template sentence for environmental description.

         how: replace with plot-relevant environmental detail; don't pad with generic beauty.
```

**This whole section runs in your browser**: no network, no upload, no model call, no cost — not a single byte of your unpublished manuscript leaves your machine. This is something no cloud AI-detector can do (they all require you to upload the manuscript).

> ⚠️ The rule engine only helps you **reduce machine-taste**, and cannot guarantee passing any platform's AI-rate check. Platform algorithms are undisclosed and keep changing; results are for reference only.

---

## UI tour

Real running screenshots, not concept art. Full demo at [online demo](https://huanweide.github.io/novel-smith/).

| Home · the novel-universe entrance | Explore mode · conversational world-building |
|---|---|
| ![](docs/screenshots/home.png) | ![](docs/screenshots/explore.png) |

| Home | Workbench |
|---|---|
| ![](docs/screenshots/novel-smith-home.png) | ![](docs/screenshots/novel-smith-workbench.png) |

Full closed-loop demo (from one-line spark to exported book):

![workflow demo](docs/screenshots/demo.gif)

---

## What it does

### Find the right capability for your goal

| What you want to do | How Novel Smith helps |
| --- | --- |
| Write a long-form web novel with AI | AI drafts: from spark, worldview, chapter outlines to chapter prose, the AI writes throughout, you only make the calls |
| Apply proven techniques, fewer wrong turns | Creative-workshop preset marketplace: writing-style / worldview / character-card / world-book / plot-progression templates in one click |
| Turn a one-line spark into a full worldview | Explore mode: 11-step guided conversation turning a spark into settings / characters / outline |
| Write long without collapsing persona or dropping foreshadowing | Tiered memory engine: full recent 4 chapters + summaries of recent 3 + AI-compressed far layers; 100 chapters without losing intelligence |
| Don't want a paper notebook for settings | Auto world-building pipeline: each chapter extracts characters / locations / factions → character cards + world book (15 auto-classified categories) |
| (Optional) reduce machine-taste in drafts | Local self-check: 12 rules flag sentence-by-sentence "why like AI, how to fix", offline and free |
| Keep manuscripts off the cloud | Local single-file SQLite: no account, no cloud, no telemetry, not a single byte uploaded |
| Export for editors / platform publishing | One-click five-format export: TXT / Markdown / HTML / EPUB / DOCX |

The hardest part of writing a long-form isn't the opening — it's **the middle**: chapter 30's protagonist suddenly acts like a different person, the foreshadowing buried in chapter 12 is never mentioned again, the AI gets more and more watered-down.

Novel Smith hands these "things you can't remember" to the engineering bench to manage automatically; you only handle creativity and the pen:

```
You: one-line spark "in a cultivation world, a boy who cannot use magic"

  Round 1  Explore mode     → 11-step guided conversation, turns a spark into a full worldview
  Round 2  Auto world-build → extracts characters/locations/factions → builds character cards + world-book entries (15-category auto-routing)
  Round 3  Batch writing    → first drafts chapter outlines 1–10 for you to revise; on confirm, writes prose chapter by chapter in the background
  Round 4  Tiered-memory injection → full recent 4 chapters + summaries recent 3 + far-layer AI compression; 100 chapters without losing intelligence
  Round 5  Local self-check → 12 rules scan paragraph by paragraph, green/yellow/red flagging which sentence reads like AI, why, how to fix
  Round 6  One-click export → TXT / Markdown / HTML / EPUB / DOCX
```

**Generating prose, story dissection, and character/world-book management write to a local SQLite file**, so it must run on your own machine (the online demo runs in a stateless cloud environment and can't write local files). **Your text never leaves your machine.**

### Features that don't need an API key

| Feature | Needs key |
|---|---|
| AI-taste detection, local self-check | **No** — pure local rule engine |
| Word count, consistency check, foreshadowing tracking, character relationship graph | No |
| Story dissection analysis, export to Word / EPUB | No |
| AI prose generation, continuation, polishing, character dialogue | Yes (use your own key) |

---

## Features

- 🤖 **AI writing engine (core)** — from spark, worldview, chapter outlines to chapter prose, the AI drafts; a built-in "creative workshop" preset marketplace applies writing-style / worldview / character-card / world-book templates in one click. See `src/app/workshop`, `src/core/write-generation.ts`.
- 🧠 **Tiered memory engine (default)** — full recent 4 chapters + summaries recent 3 + AI-compressed far layers, with S/A/B/C four-level event decay (S permanent, C cleared after 5 chapters), so persona/foreshadowing/settings don't get lost at 100 chapters. See `src/lib/memory-decay.ts`, `src/core/memory/`.
- 📋 **Auto world-building pipeline (optional · default off)** — after each chapter, extract a structured table → auto-build character cards and world-book entries → detect character relationships → write back the storyline; pure-manual writers aren't disturbed. See `src/core/assembly/engine.ts`.
- 📖 **World-book 15-category deterministic classifier** — geography/factions/power-system/destiny-system/physics/public-institutions… 15 categories, keyword-weighted auto-routing, no fuzzy guessing. See `src/lib/world-category-classifier.ts`.
- ⚖️ **Writing rule engine (specificity adjudication)** — rules carry 6 scopes (global/volume/chapter-range/event-type/character-scene/conditional-trigger); on conflict, adjudicates by "priority vs specificity" and gives the winning reason. See `src/core/rules.ts`.
- 🧵 **Frankenstein plot propeller** — after the main line ends, auto-constructs a follow-on main line so the plot never runs dry; three pacing modes (fast/balanced/slow-burn) adjustable. Entry at `src/app/api/storylines/generate/route.ts`.
- 🔒 **Network gate (default: local-only)** — all `/api/*` carry an access-control layer; public-network sources are 403 by default; three trust modes (`trust-proxy-header` / `trust-cf-only` / `direct`) prevent "accidental public deployment". See `src/lib/net-guard.ts`, `src/proxy.ts`.
- 💾 **Local single-file SQLite database** — `./data/novelforge.db`, zero-config out of the box; backup is just copying that file. No cloud service, no subscription, no account, no telemetry.
- 📦 **Five-format one-click export** — TXT / Markdown / HTML / EPUB / DOCX, packaged fully locally. See `src/core/docx.ts`, `src/core/epub.ts`.
- 🔍 **Local self-check (optional · default on)** — 12 rules based on regex and statistics, zero LLM calls, zero network requests, flagging sentence-by-sentence "why like AI, how to fix", no black-box scoring. It's a quality aid, not a writing prerequisite. See `src/core/humanize/rules.ts`.

---

<a id="desktop"></a>

## Desktop: download and use (no Node / no command line)

> Don't want to install Node or type commands? Grab the desktop build and double-click to open.

- **Download**: [GitHub Releases · v3.1.156](https://github.com/huanweide/novel-smith/releases/tag/v3.1.156)
- Three packages, pick by habit:
  - `NovelSmith-3.1.156-setup.exe` (recommended) — NSIS installer, double-click to install, creates desktop/start-menu shortcuts.
  - `NovelSmith-3.1.156-portable.exe` — single self-extracting file, USB / double-click to run, no registry writes.
  - `NovelSmith-3.1.156.zip` — unzip and run.
- **First run blocked by Windows SmartScreen?** That's the normal "unsigned" prompt, not a virus — click "Run anyway".
- **First open shows "AI not configured" at the top?** Go to Settings (⚙️) to fill in an LLM key, or set `LLM_API_KEY` in `.env`. It doesn't affect opening, nor the local-writing / dissection features that don't need AI.
- Data lands in a local single-file SQLite; backup = copy that file.

![desktop real running UI](docs/screenshots/desktop-app-home.png)

> The image above is the desktop build's real home page (rendered by the Next service inside the package). The top "AI not configured" banner is only because there's no LLM key; fill the key in Settings and it disappears, without affecting local-writing / dissection features that don't depend on AI.

## Quick start

### Easiest (one line)

```bash
npm run dev:db     # generate .env → build local DB tables → start
```

Open `http://localhost:3001` in your browser.

### Manual step by step

```bash
git clone https://github.com/huanweide/novel-smith.git
cd novel-smith
cp .env.example .env          # defaults to local SQLite, no manual edit needed
npm install                  # install deps (includes the better-sqlite3 native module)
npm run dev:db               # build tables + start
# open http://localhost:3001 in your browser
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

> All data is stored in `./data/novelforge.db` (one local file), with no external database service dependency.

> `.env` and `/data/` are both ignored by `.gitignore` and won't be uploaded to GitHub.

### Zero-barrier trial: taste it without a key

```bash
npm run dev:db     # after starting, open http://localhost:3001/detector
```

The AI-taste detector gives you: a total score + four tiers (basically clean / slight / noticeable / severe), paragraph-level green/yellow/red bars, **each hit telling you why it reads like AI and how to fix it**, plus six explainable raw statistics. Once it's useful, go to Settings to configure a key.

### First-time LLM provider setup

1. Top-right **Settings** → choose a provider (recommend **SiliconFlow**, cheap domestic, full DeepSeek available).
2. Fill the API key → click **Test connection** → confirm "connected" → **Save settings**.

| Provider | Get key | Price reference | Recommended model |
|---|---|---|---|
| SiliconFlow | [siliconflow.cn](https://siliconflow.cn) | ~¥0.001 / 1K tokens | `deepseek-ai/DeepSeek-V4-Flash` |
| DeepSeek official | [platform.deepseek.com](https://platform.deepseek.com) | ~¥0.002 / 1K tokens | `deepseek-v4-flash` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | ~$0.005 / 1K tokens | `gpt-4o` |
| Groq | [console.groq.com](https://console.groq.com) | free tier | `llama-3.3-70b-versatile` |
| Custom | any OpenAI-compatible service | per provider | per provider |

On first open, the "creative workshop" auto-seeds **17 built-in demo presets**; click "apply" to start writing, no manual form-filling.

---

## Command reference

| Command | Purpose |
|---|---|
| `npm run dev:db` | build local DB + start dev server (recommended entry) |
| `npm run dev` | start dev server only (`localhost:3001`, Turbopack HMR) |
| `npm run build` | production build (guarded by `scripts/safe-build.mjs`) |
| `npm start` | start production server |
| `npm test` | run all vitest cases (2163) |
| `npm run test:coverage` | tests with coverage |
| `npx tsc --noEmit` | TypeScript strict-mode check (zero errors to pass) |
| `npm run lint` | ESLint (**legacy tech debt, not a hard gate yet**) |
| `npm run lint:colors` | color guard ARCH-7 (soft reminder, non-blocking) |
| `npm run doctor` | environment self-check (deps/database/config) |
| `npx prisma studio` | database visualization panel (`localhost:5555`) |
| `npx prisma db push` | sync Prisma schema → local SQLite |
| `npm run db:seed` | seed built-in presets and sample data |

---

## Architecture

**In one sentence**: a local single-file SQLite is the foundation; the writing flow is a closed loop of "load context → generate → distill & write back → local self-check"; settings and memory aren't one-off text stuffed into a prompt, but structured archives that auto-settle and auto-decay with every chapter.

### Core concepts

| Concept | Meaning |
|---|---|
| **Tiered memory** | full recent 4 chapters + summaries recent 3 + AI-compressed far layers, solving "the longer you write, the dumber it gets" |
| **Event tiers (S/A/B/C)** | four importance tiers with forgetting-curve decay: S permanent, A→B after 30 chapters, B→C after 15, C deleted after 5 |
| **Distillation** | after each chapter, extract structured facts and write back character cards / world book / storyline, so settings grow with writing |
| **World book** | 15-category setting entry library, injected into context before generation by trigger words |
| **Auto world-building (Assembly)** | auto-build character cards and world-book entries from AI-extracted tables, and detect character relationships |
| **De-AI-ify (Humanize)** | 12 pure-local rules scan, paragraph-level green/yellow/red scoring, give "why + how to fix", never auto-rewrite prose |
| **Rule specificity** | writing rules weighted across 6 scopes; on conflict, adjudicate by priority/specificity with the winning reason |

### Writing loop

```
        ┌──────────────────────────────────────────┐
        │                                          │
  one-line spark                                     │
        │                                          │
        ▼                                          │
  Explore mode (11 steps)──► worldview / characters / factions        │
        │                                          │
        ▼                                          │
  Load context ◄──── tiered memory (recent full + summaries + far compression)  │
        │          ◄──── world-book trigger-word injection            │
        │          ◄──── writing rules (specificity adjudication)     │
        ▼                                          │
  chapter-outline gen ──► you confirm/revise ──► prose generation       │
        │                                          │
        ▼                                          │
  distill & write back ─► character cards / world book / storyline ──────┘
        │
        ▼
  local self-check (12 rules, paragraph-level scoring)
        │
        ├── few hits ──► finalize ──► export TXT/MD/HTML/EPUB/DOCX
        └── many hits ──► back to prose (author revises, machine doesn't ghostwrite)
```

### Core modules

| Module | File | Description |
|---|---|---|
| De-AI-ify rule library | `src/core/humanize/rules.ts` | 9 paragraph-level + 3 document-level rules, pure regex and statistics |
| Self-check scoring entry | `src/core/humanize/index.ts` | aggregate 5 explainable statistics → total + tier + per-paragraph report |
| One-click fix suggestions | `src/core/humanize/fixes.ts` | only deterministic fixes, and **must be applied by author click** |
| Platform-risk hints | `src/core/humanize/platform-risk.ts` | platform-caliber risk hints (no prediction of specific algorithms) |
| Memory-decay engine | `src/lib/memory-decay.ts` | S/A/B/C four-level forgetting curve, independent of the foreshadowing system |
| Semantic recall | `src/core/memory/semantic-recall.ts` | relevance recall of far-layer events |
| Memory classifier | `src/lib/memory-classifier.ts` | judge which memory layer/category an event belongs to |
| Distillation scorer | `src/core/distillation/scorer.ts` | event importance and S/A/B/C tier scoring |
| Context loader | `src/core/pipeline/context-loader.ts` | assemble tiered memory + world book + rules into one injection context |
| Outline/prose generation | `src/core/pipeline/generate-chapter-outline.ts`, `plan-chapter.ts` | two-stage flow: outline first, then prose |
| Auto world-building pipeline | `src/core/assembly/engine.ts` | table → character cards/world book → relationship detection → write back |
| World-book classifier | `src/lib/world-category-classifier.ts` | 15-category deterministic routing, single authoritative source for derived labels |
| Writing rule engine | `src/core/rules.ts` | 6-scope weight + conflict adjudication |
| Consistency check | `src/core/consistency/detectConflicts.ts` | extract facts → detect conflicts → suggest fixes |
| Foreshadowing tracking | `src/core/foreshadowing.ts` | auto-remind buried-but-unpaid foreshadowing |
| Storyline propulsion | `src/core/storyline/generate.ts`, `execute-task.ts` | main/sub-line seven elements + Frankenstein propulsion |
| Dissection & imitation | `src/core/dissect/engine.ts`, `imitation-engine.ts` | 15-dimension dissection of others' works + imitation |
| Network gate | `src/lib/net-guard.ts`, `src/proxy.ts` | `/api/*` access control and three trust modes |
| Export | `src/core/docx.ts`, `src/core/epub.ts` | local DOCX / EPUB packaging |

For a deeper analogy-style explanation see [ARCHITECTURE.md](ARCHITECTURE.md); for per-module detail see [`docs/architecture-reference/`](docs/architecture-reference/).

---

## Add your own rule

The de-AI-ify engine is open — when you find machine-taste in your own writing style, add a rule yourself (`src/core/humanize/rules.ts`):

```ts
// Example rule: recognize the "double negation then turn" AI-signature sentence
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
      reason: "Two negations then a turn, almost a signature sentence of AI writing.",
      suggestion: "Write directly 'what it is', don't first wind around two 'not what it is'.",
    });
  }
  return hits;
}

// Hang it into the paragraph-level rule table to take effect
export const PARAGRAPH_RULES = [/* ...existing rules, */ detectNegativeParallel] as const;
```

After writing the rule, `npm test` runs all 2163 cases to guard existing behavior. Template-style extensions (outline / style card / character card) can be submitted directly to the `templates/` directory.

---

## Roadmap

- [x] Local single-file SQLite architecture (zero config, no Docker)
- [x] De-AI-ify rule engine + zero-barrier online demo trial
- [x] Tiered memory engine + event-tier decay
- [x] Auto world-building pipeline + world-book 15-category classifier
- [x] Batch-writing two-stage flow (outline first, then prose)
- [x] Smart review + five-format export
- [x] `/api/*` access control and three trust modes
- [ ] Clear ESLint legacy tech debt (1134 errors, mostly historical `no-explicit-any`), lift the exemption to a hard gate
- [ ] Preset community-ization: import/export and sharing loop for built-in demo presets
- [ ] More built-in demo presets and genre openings

Full schedule and historical delivery ledger in [ROADMAP.md](ROADMAP.md).

---

## Production deployment

```bash
npm run build          # build production
npm start              # start production server
```

> **Must-read before public deployment**: since v3.1.115, all `/api/*` carry a built-in access-control layer — it **only accepts requests from local or LAN**, and public-network sources always return 403 (allows `localhost` / `127.` / `10.` / `192.168.` / `172.16~31.` / `169.254.` / `::1` / `*.local`). This is a bottom line against "accidental public deployment", **not an account system**.

> | `TRUSTED_PROXY_MODE` | Trusts what | For |
> | --- | --- | --- |
> | `trust-proxy-header` (default) | `CF-Connecting-IP` → `X-Forwarded-For` → `X-Real-IP` → `Host` | there is indeed a reverse proxy in front and you trust it to sanitize headers |
> | `trust-cf-only` | only `CF-Connecting-IP` | **recommended when exposed publicly** |
> | `direct` | trusts no request header, only the TCP peer address | no front proxy |

> When no trusted source can be obtained, it **blocks by default**. Temporary passthrough via `ALLOW_UNKNOWN_SOURCE=true`; if you truly want to serve externally, `ALLOW_PUBLIC=true` is **strongly recommended together with** `ALLOW_PUBLIC_TOKEN=<your custom long random string>`. Full explanation in [SECURITY.md](SECURITY.md).

> ⚠️ This layer is a **subnet whitelist, not authentication**. It stops accidental public deployment, not others on the same LAN. The real defense is listening only on `127.0.0.1` + a firewall.

---

## Contributing

An individual open-source project; all forms of participation are welcome. **Want to contribute? Read [CONTRIBUTING.md](CONTRIBUTING.md) first** — it has the full path from zero-start to directory structure, three gates, to "how to file a good Issue".

1. **Star** — the simplest and most useful support.
2. **Open an Issue** — bug / new feature / doc error, use the Issue template (with version + repro steps). For ideas or to show your work, go to **Discussions**.
3. **Open a PR** — before changing, run `./scripts/git-snapshot.sh create "note"` to snapshot; after changing, run the three gates (`npx tsc --noEmit` / `npm test` / `npm run build`).

> Presets are the best material for community building — a writing-style / worldview / character card you polished can be exported as `.preset.json` to share, or written into an Issue; we're happy to turn it into a built-in demo preset.

Local development:

```bash
npm run dev            # dev server (localhost:3001)
npx tsc --noEmit       # type check (zero errors to pass)
npm test               # 2163 cases
npx prisma studio      # database panel (localhost:5555)
```

---

## Security boundaries

- **No upload** — prose, settings, and API keys all live in your own SQLite file; no cloud service, no telemetry, no account system.
- **No ghostwriting** — de-AI-ify only flags traces and gives suggestions; even the "one-click apply" fix **only ever executes when the author clicks it**, never auto-rewriting prose.
- **No pass-guarantee** — the rule engine only reduces machine-taste, it does not predict any specific platform's algorithm.
- **Not an online service** — no account, no cloud sync, no "membership unlocks more chapters".
- `.env`, `/data/`, `*.db`, certificates and credential files are all ignored by `.gitignore`; CI includes security checks, no hardcoded keys in code.

---

## What it is not

- **Not an auto-book-machine** — every chapter's outline and prose need your nod. You are the author; it's the engineering bench.
- **The no-key parts are only the detection** — AI generation/continuation/polishing need your own key; detection, consistency check, foreshadowing tracking, and export are always free, always offline.
- **Not a bidirectional-link shell of note software** — the world book and character cards are structured archives designed for "writing long-form" (15 categories, auto-classified, auto-built).

---

## Other tools by the same author

**A star helps the same-family tools get seen by more people:**

**Subtitle / video family** (different links in the "turn video into text" chain):

- 🎬 [bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) · extract subtitles from any video + AI transcription without subtitles
- 🎓 [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · Zhihuishu course auto-play / resume / AI quiz
- 🔴 [live-subtitle](https://github.com/huanweide/live-subtitle) · live real-time subtitles
- ✂️ [video-brief](https://github.com/huanweide/video-brief) · video content summary

**Code-health family** (18-axis zero-dependency CLI):

- 🩺 [family-showcase](https://github.com/huanweide/family-showcase) · hub overview of all doctor tools

**Command-line gems**:

- 🔧 [idiot-index](https://github.com/huanweide/idiot-index) · [recall-cli](https://github.com/huanweide/recall-cli) · [forge-safeguard](https://github.com/huanweide/forge-safeguard-20260812)

**All repos**: <https://github.com/huanweide?tab=repositories>

---

## License

MIT License — see [LICENSE](LICENSE).

---

## Star

🔨 If this workshop helped you get your story written, **drop a Star** so more long-form writers can find it.

[![Star](https://img.shields.io/github/stars/huanweide/novel-smith?style=social)](https://github.com/huanweide/novel-smith/stargazers)

> Novel Smith · AI novel workshop · local-first · data is yours
