// ============================================================
// 番茄小说发布 · 浏览器通道（Chrome DevTools Protocol，零依赖）
// ============================================================
//
// 为什么用 CDP 而不是装 Playwright：
//   ① 零依赖——Node 22+ 自带 WebSocket，不需要再装一个 200MB 的浏览器运行时；
//   ② 复用你已经登录的浏览器——不用把 Cookie 复制来复制去，也不会因为
//      「换了个浏览器环境」触发登录态异常；
//   ③ 能处理平台弹窗（错别字提醒 / 内容风险 / 发布设置），这些接口通道拿不到。
//
// 使用前提（必须人工做一次）：
//   关掉所有 Chrome 窗口，用调试端口重启：
//     "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
//   然后在里面正常登录番茄作家后台，并打开「新建章节」页面。
//
// ⚠️ DOM 选择器同样**未实测**：番茄后台改版就会变。所以这里：
//   - 选择器写成候选列表，逐个试；
//   - 提供 inspectPage()，把页面上真实的可编辑元素与按钮原样 dump 出来，
//     你照着改一下配置就能用，不用猜。

import type { PublishOutcome } from "./types";

const CONNECT_TIMEOUT_MS = 8_000;
const EVAL_TIMEOUT_MS = 20_000;

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/** 最小 CDP 客户端：只实现 request/response 与事件，够用且好读 */
class CdpSession {
  private ws: WebSocket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (typeof msg?.id === "number") {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "CDP 错误"));
        else p.resolve(msg.result);
      }
    });
    ws.addEventListener("close", () => {
      this.closed = true;
      for (const [, p] of this.pending) p.reject(new Error("CDP 连接已断开"));
      this.pending.clear();
    });
  }

  static async connect(wsUrl: string): Promise<CdpSession> {
    const WS = (globalThis as any).WebSocket;
    if (!WS) throw new Error("当前 Node 不支持 WebSocket（需要 Node 22+）");
    const ws: WebSocket = new WS(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接调试端口超时")), CONNECT_TIMEOUT_MS);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("无法连接调试端口：浏览器是否用 --remote-debugging-port=9222 启动？"));
      });
    });
    return new CdpSession(ws);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (this.closed) return Promise.reject(new Error("CDP 已关闭"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 调用超时：${method}`));
      }, EVAL_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面里执行一段 JS，返回可序列化结果 */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(`页面脚本报错：${res.exceptionDetails.text || "未知"}`);
    }
    return res?.result?.value as T;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* 关不掉就算了 */
    }
  }
}

async function listTargets(endpoint: string): Promise<CdpTarget[]> {
  const base = endpoint.replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/json`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`调试端口返回 HTTP ${res.status}`);
    const arr = (await res.json()) as CdpTarget[];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    throw new Error(
      `连不上调试端口 ${base}：${(e as Error).message}。请用 --remote-debugging-port=9222 重启浏览器`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 找一个番茄作家后台的页面（优先章节相关页） */
function pickFanqieTarget(targets: CdpTarget[]): CdpTarget | null {
  const pages = targets.filter((t) => t.type === "page" && /fanqienovel\.com/.test(t.url));
  if (pages.length === 0) return null;
  return (
    pages.find((p) => /chapter|write|create|edit/i.test(p.url)) ||
    pages.find((p) => /writer/i.test(p.url)) ||
    pages[0]
  );
}

export interface CdpStatus {
  ok: boolean;
  endpoint: string;
  /** 找到的番茄页面标题与地址 */
  page?: { title: string; url: string };
  /** 页面上是否已就绪（能识别到编辑器） */
  editorReady?: boolean;
  error?: string;
}

/** 检查调试端口与番茄页面是否可用（界面上的「检测浏览器」按钮） */
export async function cdpStatus(endpoint: string): Promise<CdpStatus> {
  try {
    const targets = await listTargets(endpoint);
    const target = pickFanqieTarget(targets);
    if (!target) {
      return { ok: false, endpoint, error: "调试端口通了，但没有打开番茄作家后台的页面" };
    }
    if (!target.webSocketDebuggerUrl) {
      return { ok: false, endpoint, page: { title: target.title, url: target.url }, error: "该页面不支持远程调试" };
    }
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
      const ready = await session.evaluate<boolean>(`!!document.querySelector('[contenteditable="true"], .ProseMirror, .ql-editor, textarea')`);
      return { ok: true, endpoint, page: { title: target.title, url: target.url }, editorReady: ready };
    } finally {
      session.close();
    }
  } catch (e) {
    return { ok: false, endpoint, error: (e as Error).message };
  }
}

export interface DomInspect {
  url: string;
  title: string;
  /** 可编辑元素（选择器 + 类型 + 占位文案） */
  editables: Array<{ selector: string; tag: string; placeholder: string }>;
  /** 按钮文案（用于校准「发布」按钮） */
  buttons: Array<{ selector: string; text: string }>;
  inputs: Array<{ selector: string; type: string; placeholder: string; name: string }>;
}

/**
 * 把页面上真实的可编辑元素、按钮、输入框 dump 出来。
 * 番茄改版后跑一次这个，照着输出改选择器，比对着截图猜快得多。
 */
export async function inspectPage(endpoint: string): Promise<DomInspect> {
  const targets = await listTargets(endpoint);
  const target = pickFanqieTarget(targets);
  if (!target?.webSocketDebuggerUrl) throw new Error("没有找到番茄页面，请先在浏览器里打开作家后台");
  const session = await CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    const script = `(() => {
      const path = (el) => {
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && parts.length < 4) {
          let seg = cur.tagName.toLowerCase();
          if (cur.id) { seg += '#' + cur.id; parts.unshift(seg); break; }
          const cls = (cur.className && typeof cur.className === 'string') ? cur.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
          if (cls) seg += '.' + cls;
          parts.unshift(seg);
          cur = cur.parentElement;
        }
        return parts.join(' > ');
      };
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"], .ProseMirror, .ql-editor, textarea')).slice(0, 12).map(el => ({
        selector: path(el),
        tag: el.tagName.toLowerCase(),
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
      }));
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], .btn')).slice(0, 40)
        .map(el => ({ selector: path(el), text: (el.textContent || '').trim().slice(0, 20) }))
        .filter(b => b.text);
      const inputs = Array.from(document.querySelectorAll('input')).slice(0, 20).map(el => ({
        selector: path(el), type: el.type || '', placeholder: el.getAttribute('placeholder') || '', name: el.getAttribute('name') || '',
      }));
      return { title: document.title, url: location.href, editables, buttons, inputs };
    })()`;
    return await session.evaluate<DomInspect>(script);
  } finally {
    session.close();
  }
}

export interface CdpPublishInput {
  endpoint: string;
  title: string;
  content: string;
  /** 只填不发：安全模式，用于首次校准 */
  fillOnly?: boolean;
  /** 选择器覆盖（用户在界面上校准后传进来） */
  selectors?: {
    title?: string[];
    body?: string[];
    publishButton?: string[];
  };
}

const DEFAULT_TITLE_SELECTORS = [
  'input[placeholder*="章节名"]',
  'input[placeholder*="标题"]',
  'input[name="title"]',
  'input[placeholder*="请输入"]',
];
const DEFAULT_BODY_SELECTORS = [
  ".ProseMirror",
  '[contenteditable="true"]',
  ".ql-editor",
  'textarea[placeholder*="正文"]',
];
const DEFAULT_PUBLISH_BUTTONS = ["发布", "下一步", "提交"];

/**
 * 通过浏览器发布一章。
 *
 * 流程：等编辑器就绪 → 填标题 → 填正文 → 读回校验（round-trip）→
 *       fillOnly 则停在这里（安全模式）→ 否则点发布 → 处理二次弹窗 → 回读结果。
 *
 * 中文/Emoji 输入必须走 execCommand('insertText')，直接改 innerText 在
 * ProseMirror/Quill 里会被框架状态覆盖（社区项目实测的坑，这里照抄结论）。
 */
export async function publishViaCdp(input: CdpPublishInput): Promise<PublishOutcome> {
  const titleSels = input.selectors?.title?.length ? input.selectors.title : DEFAULT_TITLE_SELECTORS;
  const bodySels = input.selectors?.body?.length ? input.selectors.body : DEFAULT_BODY_SELECTORS;
  const btnTexts = input.selectors?.publishButton?.length ? input.selectors.publishButton : DEFAULT_PUBLISH_BUTTONS;

  let session: CdpSession | null = null;
  try {
    const targets = await listTargets(input.endpoint);
    const target = pickFanqieTarget(targets);
    if (!target?.webSocketDebuggerUrl) {
      return {
        ok: false,
        channel: "cdp",
        error: "没找到番茄作家后台页面：请用 --remote-debugging-port=9222 启动浏览器，并打开「新建章节」页",
      };
    }
    session = await CdpSession.connect(target.webSocketDebuggerUrl);
    await session.send("Runtime.enable").catch(() => undefined);

    const payload = JSON.stringify({
      title: input.title,
      content: input.content,
      titleSels,
      bodySels,
      btnTexts,
      fillOnly: !!input.fillOnly,
    });

    // 整个填表流程放进页面里一次执行完：减少往返，也避免中途焦点丢失
    const script = `(async () => {
      const cfg = ${payload};
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const pick = (sels) => { for (const s of sels) { const el = document.querySelector(s); if (el) return el; } return null; };

      // 1. 等编辑器出现（最多 6 秒）
      let bodyEl = null;
      for (let i = 0; i < 30; i++) { bodyEl = pick(cfg.bodySels); if (bodyEl) break; await sleep(200); }
      if (!bodyEl) return { ok: false, stage: 'editor', error: '页面上找不到正文编辑器，请确认已打开「新建章节」页' };

      // 2. 标题
      const titleEl = pick(cfg.titleSels);
      if (!titleEl) return { ok: false, stage: 'title', error: '找不到章节标题输入框，可先用「检查页面」校准选择器' };
      const setNative = (el, val) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      titleEl.focus();
      setNative(titleEl, cfg.title);
      await sleep(120);

      // 3. 正文（走 insertText，兼容 ProseMirror/Quill 的内部状态）
      const fillBody = (el, text) => {
        el.focus();
        if (el.tagName === 'TEXTAREA') { setNative(el, text); return; }
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('delete', false);
          document.execCommand('insertText', false, text);
        } catch (e) { el.textContent = text; }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      fillBody(bodyEl, cfg.content);
      await sleep(400);

      // 4. 读回校验（round-trip）：长度差超过 10% 就认为输入丢失
      const readBody = () => (bodyEl.innerText || bodyEl.value || '').replace(/\\s+/g, '');
      const readTitle = () => (titleEl.value || titleEl.innerText || '').trim();
      let got = readBody();
      const expect = cfg.content.replace(/\\s+/g, '');
      if (Math.abs(got.length - expect.length) > Math.max(30, expect.length * 0.1)) {
        // 再试一次（第一次常常被编辑器初始化吞掉）
        fillBody(bodyEl, cfg.content);
        await sleep(600);
        got = readBody();
      }
      const titleOk = readTitle().length > 0;
      const report = {
        titleFilled: titleOk,
        titleRead: readTitle().slice(0, 40),
        bodyExpected: expect.length,
        bodyActual: got.length,
        bodyHead: got.slice(0, 30),
        bodyTail: got.slice(-30),
      };
      if (!titleOk) return { ok: false, stage: 'verify', error: '标题没有填进去', report };
      if (Math.abs(got.length - expect.length) > Math.max(60, expect.length * 0.15)) {
        return { ok: false, stage: 'verify', error: '正文长度对不上，內容可能在输入时被截断', report };
      }
      if (cfg.fillOnly) return { ok: true, stage: 'filled', report };

      // 5. 点发布
      const clickByText = (texts) => {
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], .btn, a'));
        for (const t of texts) {
          const el = nodes.find(n => (n.textContent || '').trim() === t) || nodes.find(n => (n.textContent || '').includes(t));
          if (el) { el.click(); return t; }
        }
        return null;
      };
      const clicked = clickByText(cfg.btnTexts);
      if (!clicked) return { ok: false, stage: 'submit', error: '没找到发布按钮（可先用「检查页面」校准按钮文案）', report };
      await sleep(1200);

      // 6. 二次弹窗：错别字提醒/内容风险/发布设置，出现「确认」「继续」就点
      const confirmTexts = ['确认发布', '继续发布', '仍然发布', '确认', '确定', '继续'];
      let clicked2 = null;
      for (const t of confirmTexts) {
        const el = Array.from(document.querySelectorAll('button, [role="button"], .btn'))
          .find(n => (n.textContent || '').trim() === t);
        if (el) { el.click(); clicked2 = t; break; }
      }
      await sleep(1500);
      const pageText = (document.body.innerText || '').slice(0, 500);
      return { ok: true, stage: 'submitted', clicked, clickedConfirm: clicked2, report, pageText };
    })()`;

    const result = await session.evaluate<any>(script);

    if (!result?.ok) {
      return {
        ok: false,
        channel: "cdp",
        error: `[${result?.stage || "unknown"}] ${result?.error || "未知失败"}`,
        raw: result?.report ? JSON.stringify(result.report).slice(0, 500) : undefined,
      };
    }

    if (input.fillOnly) {
      return {
        ok: true,
        channel: "cdp",
        note: `安全模式：已填入但未提交（${result.report?.bodyActual ?? 0} 字已上屏）`,
        raw: JSON.stringify(result.report).slice(0, 500),
      };
    }

    return {
      ok: true,
      channel: "cdp",
      note: `已点击「${result.clicked}」${result.clickedConfirm ? ` → 确认「${result.clickedConfirm}」` : ""}，请到章节管理确认状态`,
      raw: (result.pageText || "").slice(0, 300),
    };
  } catch (e) {
    return { ok: false, channel: "cdp", error: (e as Error).message };
  } finally {
    session?.close();
  }
}
