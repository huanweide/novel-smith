// ============================================================
// 番茄小说发布 · 双通道编排（接口优先，CDP 兜底）
// ============================================================
//
// 通道选择规则（与账号配置一一对应，不做隐式行为）：
//   api  → 只走接口。失败就是失败，不偷偷换浏览器（便于定位是 Cookie 问题还是内容问题）。
//   cdp  → 只走浏览器。最稳，但要求浏览器开着且有番茄页面。
//   auto → 先接口；接口失败且失败原因像「通道问题」（Cookie/端点/HTTP）时，
//          自动降级 CDP 再试一次。内容类失败（平台明确拒绝内容）不降级——
//          换通道也不会让内容通过，反而会在浏览器里再撞一次。

import { DEFAULT_ENDPOINTS, publishViaApi, type FanqieApiEndpoints } from "./api-channel";
import { publishViaCdp } from "./cdp";
import type { FanqieCredentials, PublishOutcome } from "./types";

export interface PublishRequest {
  channel: "api" | "cdp" | "auto";
  endpoints?: FanqieApiEndpoints;
  cdpEndpoint: string;
  cred: FanqieCredentials | null;
  bookId: string;
  title: string;
  content: string;
  /** 安全模式：只填不发（仅 CDP 支持） */
  fillOnly?: boolean;
}

/** 判断接口失败是否属于「换通道可能救回来」的类型 */
function isChannelFailure(outcome: PublishOutcome): boolean {
  const msg = outcome.error || "";
  if (/登录|Cookie|未授权|HTTP 40[134]|端点|请求失败|超时|ECONN|ENOTFOUND/i.test(msg)) return true;
  // 平台明确拒绝内容（code 非 0 但带了具体文案）→ 不换通道
  if (/平台拒绝/.test(msg)) return false;
  return false;
}

export async function publishChapter(req: PublishRequest): Promise<PublishOutcome> {
  const wantCdpOnly = req.channel === "cdp";
  const wantApiOnly = req.channel === "api";

  if (!req.bookId) {
    return { ok: false, channel: wantCdpOnly ? "cdp" : "api", error: "还没绑定目标作品（bookId 白名单），为避免误发到别的书，已拦下" };
  }

  // 安全模式只可能走 CDP（接口没有「只填不发」的语义）
  if (req.fillOnly) {
    return publishViaCdp({
      endpoint: req.cdpEndpoint,
      title: req.title,
      content: req.content,
      fillOnly: true,
    });
  }

  if (wantCdpOnly) {
    return publishViaCdp({ endpoint: req.cdpEndpoint, title: req.title, content: req.content });
  }

  if (!req.cred) {
    if (wantApiOnly) {
      return { ok: false, channel: "api", error: "还没连接账号：请在发布台填 Cookie 与 X-Secsdk-Csrf-Token" };
    }
    // auto 且没凭据 → 直接走浏览器
    return publishViaCdp({ endpoint: req.cdpEndpoint, title: req.title, content: req.content });
  }

  const apiOutcome = await publishViaApi({
    cred: req.cred,
    endpoints: req.endpoints ?? DEFAULT_ENDPOINTS,
    bookId: req.bookId,
    title: req.title,
    content: req.content,
  });

  if (apiOutcome.ok || wantApiOnly) return apiOutcome;

  if (req.channel === "auto" && isChannelFailure(apiOutcome)) {
    const cdpOutcome = await publishViaCdp({
      endpoint: req.cdpEndpoint,
      title: req.title,
      content: req.content,
    });
    if (cdpOutcome.ok) {
      return {
        ...cdpOutcome,
        note: `接口通道失败（${apiOutcome.error?.slice(0, 80)}），已自动改走浏览器通道：${cdpOutcome.note || "成功"}`,
      };
    }
    return {
      ok: false,
      channel: "cdp",
      error: `接口与浏览器都失败。接口：${apiOutcome.error?.slice(0, 120)}；浏览器：${cdpOutcome.error?.slice(0, 120)}`,
      raw: cdpOutcome.raw,
    };
  }

  return apiOutcome;
}
