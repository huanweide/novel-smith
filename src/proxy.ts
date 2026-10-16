// ============================================================
// 本地优先 · 访问控制（Next 16 起 middleware.ts 改名为 proxy.ts）
// ============================================================
//
// 本层是在原有 `shouldBlock(addr, allowPublic)` 最小判定之上，接入加固后的 net-guard：
//   旧判定只回答「是不是内网」，没有「未知来源」的概念，也不支持「只信 Cloudflare」。
//   现在改调 `evaluateRequest(headers, opts)`，一次拿到完整决策（放行/拦截 + 原因）：
//   1. 可按部署环境选信任模型（trust-cf-only / direct / trust-proxy-header）；
//   2. 403 响应体能写清「为什么被拦 + 怎么解除」，而不是只丢一个状态码；
//   3. 未知来源有独立 reason，不再和「公网来源」混为一谈。
//
// 为什么仍然只拦 /api/*：
//   页面与静态资源是公开的展示内容，没有数据；全部数据读写都在 /api/*。
//   拦页面会让误部署时整个站变成白屏，反而更难判断「到底有没有事」。
//
// ⚠️ 公网部署前必读：
//   这层防护是「网段白名单」，不是身份认证。
//   它挡得住误部署到公网/局域网，挡不住「同处一个内网里的其他人」——
//   那种场景要靠最外层只监听 127.0.0.1（Cloudflare Tunnel 方案）或网络隔离。
//   环境变量说明见 SECURITY.md。

import { NextResponse, type NextRequest } from "next/server";

import {
  FORBIDDEN_MESSAGE,
  evaluateRequest,
  type AccessDecision,
} from "@/lib/net-guard";

export const config = {
  matcher: ["/api/:path*"],
};

export default function proxy(req: NextRequest) {
  // 关键：把 env 显式注入，让判定逻辑不依赖 process.env 的读取时机。
  // （Next 在构建期/运行期可能对 process.env 做静态替换，显式传更稳。）
  const decision: AccessDecision = evaluateRequest(req.headers, {
    env: process.env,
    // 注意：Next 的 NextRequest 在多数部署形态下拿不到真实的对端 socket 地址，
    // 所以 socketAddress 这里不传 —— 走 direct 模式时会被判为未知来源并拦下。
    // 这是刻意的保守行为：要开 direct 模式，请确保框架确实提供了该地址再改这里。
  });

  if (decision.blocked) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        // reason 是机器可读的稳定枚举；message 是给人看的说明。
        reason: decision.reason,
        from: decision.address || "(unknown)",
        message: FORBIDDEN_MESSAGE,
      },
      { status: 403 }
    );
  }

  return NextResponse.next();
}