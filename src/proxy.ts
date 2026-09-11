import { NextResponse, type NextRequest } from "next/server";

import {
  FORBIDDEN_MESSAGE,
  clientAddress,
  isManagedHosting,
  shouldBlock,
} from "@/lib/net-guard";

// ============================================================
// 本地优先 · 访问控制（Next 16 起 middleware.ts 改名为 proxy.ts）
// ============================================================
//
// 真正的判定逻辑在 src/lib/net-guard.ts（纯函数，带单元测试），
// 这里只做三件事：读请求头 → 问一句该不该拦 → 放行或 403。
//
// 只拦 /api/*：页面与静态资源不受影响，本地使用零感知。

export const config = {
  matcher: ["/api/:path*"],
};

export default function proxy(req: NextRequest) {
  const addr = clientAddress(req.headers);

  // 两条解除条件：作者显式开关，或本来就跑在作者主动公开的托管平台上
  const allowPublic = process.env.ALLOW_PUBLIC === "true" || isManagedHosting();

  if (shouldBlock(addr, allowPublic)) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: FORBIDDEN_MESSAGE, from: addr },
      { status: 403 }
    );
  }

  return NextResponse.next();
}
