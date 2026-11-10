// ============================================================
// 番茄小说发布 · 接口通道（Cookie + X-Secsdk-Csrf-Token 直打后端）
// ============================================================
//
// ⚠️ 诚实声明（不要删这段）：
//   番茄没有公开 API，下列端点路径来自社区开源项目的命名惯例，**未在本机账号上实测**。
//   平台随时可能改版，所以本通道的设计是「可探测 + 可配置 + 失败即降级」：
//     1. 先在界面上点「探测」——真发一次书架请求，把状态码和响应片段原样显示给你；
//     2. 探测通 → 记下真实路径与字段，写进账号配置（endpoints 存 DB）；
//     3. 探测不通 → 自动降级到浏览器通道（cdp），不会在那里反复硬撞。
//   任何结论都必须来自你自己的实测，代码里不写「已验证」。

import type { FanqieCredentials, PublishOutcome } from "./types";

export interface FanqieApiEndpoints {
  /** 书架列表（GET，用于探测登录态是否有效） */
  books: string;
  /** 章节列表（GET） */
  chapters: string;
  /** 发布章节（POST） */
  publish: string;
}

/** 默认端点：社区项目常见命名，**未实测**，探测失败请手动改 */
export const DEFAULT_ENDPOINTS: FanqieApiEndpoints = {
  books: "/api/author/book/list",
  chapters: "/api/author/book/chapter/list",
  publish: "/api/author/book/chapter/publish",
};

const ORIGIN = "https://fanqienovel.com";
const TIMEOUT_MS = 20_000;

/**
 * 真实浏览器 UA。
 * 直打后端时默认 UA（node）是最明显的机器特征——这里不是为了「绕过检测」，
 * 而是平台的风控会把非浏览器流量直接拒掉，带个正常 UA 只是让请求能走通。
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function buildHeaders(cred: FanqieCredentials): Record<string, string> {
  return {
    cookie: cred.cookie,
    "x-secsdk-csrf-token": cred.csrfToken || "",
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": UA,
    referer: `${ORIGIN}/writer/zone`,
    origin: ORIGIN,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function truncate(s: string, n = 400): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  /** 响应片段（人话排查用） */
  sample: string;
  /** 是否判定为登录态失效 */
  unauthorized: boolean;
  error?: string;
}

/**
 * 探测：GET 书架列表。
 *
 * 判据（简单直接，不做花哨推断）：
 *   - 2xx 且响应含 JSON → 通
 *   - 401/403 → 登录态或 CSRF 失效（提示重新复制 Cookie）
 *   - 404 → 端点路径不对（提示改端点）
 *   - 其它 → 原样把状态码与片段带回去
 */
export async function probeAccount(
  cred: FanqieCredentials,
  endpoints: FanqieApiEndpoints = DEFAULT_ENDPOINTS,
): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout(`${ORIGIN}${endpoints.books}`, {
      method: "GET",
      headers: buildHeaders(cred),
    });
    const text = await res.text().catch(() => "");
    const unauthorized = res.status === 401 || res.status === 403;
    return {
      ok: res.ok,
      status: res.status,
      sample: truncate(text),
      unauthorized,
      error: res.ok
        ? undefined
        : unauthorized
          ? "登录态失效：请重新在网页端登录，复制最新 Cookie 与 X-Secsdk-Csrf-Token"
          : res.status === 404
            ? "端点不存在：请在设置里把「书架」路径改成你 F12 里真实看到的那个"
            : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      sample: "",
      unauthorized: false,
      error: `请求失败：${(e as Error).message}`,
    };
  }
}

export interface ApiPublishInput {
  cred: FanqieCredentials;
  endpoints?: FanqieApiEndpoints;
  bookId: string;
  title: string;
  content: string;
  /** publish=直接发 | draft=存草稿 */
  publishType?: "publish" | "draft";
}

/**
 * 通过接口发布一章。
 *
 * body 字段（book_id / title / content / publish_type）同样是社区惯例；
 * 失败时把平台原始响应带回去——这是排查字段不匹配最快的方式，
 * 不要去猜，看一眼真实报错就知道该改成什么。
 */
export async function publishViaApi(input: ApiPublishInput): Promise<PublishOutcome> {
  const endpoints = input.endpoints ?? DEFAULT_ENDPOINTS;
  const body = {
    book_id: input.bookId,
    title: input.title,
    content: input.content,
    publish_type: input.publishType ?? "publish",
  };
  try {
    const res = await fetchWithTimeout(`${ORIGIN}${endpoints.publish}`, {
      method: "POST",
      headers: buildHeaders(input.cred),
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        channel: "api",
        error: `HTTP ${res.status}：${truncate(text, 200)}`,
        raw: truncate(text),
      };
    }
    // 平台常见返回：{code:0,data:{...}} 或 {code:非0,message:"..."}
    let note = "已提交";
    try {
      const j = JSON.parse(text);
      const code = j?.code ?? j?.status_code ?? 0;
      const msg = j?.message || j?.msg || "";
      if (code !== 0 && code !== "0" && code != null) {
        return {
          ok: false,
          channel: "api",
          error: `平台拒绝（code=${code}）：${msg || truncate(text, 200)}`,
          raw: truncate(text),
        };
      }
      note = msg || "已提交";
    } catch {
      // 非 JSON：可能是 HTML（登录跳转），按失败处理但保留证据
      if (/login|passport|登录/i.test(text)) {
        return {
          ok: false,
          channel: "api",
          error: "返回了登录页，Cookie 已失效",
          raw: truncate(text),
        };
      }
    }
    return { ok: true, channel: "api", note, raw: truncate(text) };
  } catch (e) {
    return { ok: false, channel: "api", error: `请求失败：${(e as Error).message}` };
  }
}
