import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_MESSAGE,
  TRUSTED_PROXY_MODES,
  checkRateLimit,
  clientAddress,
  createRateLimiterState,
  evaluateRequest,
  isManagedHosting,
  isPrivateAddress,
  normalizeAddress,
  resolveClientAddress,
  resolveProxyMode,
  shouldBlock,
} from "./net-guard";

// ============================================================
// 测试辅助：构造请求头的小工具
// ============================================================
function h(init: Record<string, string>): Headers {
  return new Headers(init);
}

/** 默认环境：一台自托管机器，什么开关都没开 */
const SELF_HOSTED_ENV: Record<string, string | undefined> = {
  TRUSTED_PROXY_MODE: "trust-proxy-header",
};

// ============================================================
// 一、回归：原有行为一条都不能被改坏
// ============================================================

describe("normalizeAddress —— 地址归一化", () => {
  it("IPv4 映射地址还原成 IPv4", () => {
    expect(normalizeAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("普通地址原样返回，不搞意外改写", () => {
    expect(normalizeAddress("192.168.1.5")).toBe("192.168.1.5");
    expect(normalizeAddress("[::1]")).toBe("::1");
  });

  it("像 IPv4 映射但不是合法四段的不还原（防止乱拼绕过）", () => {
    expect(normalizeAddress("::ffff:999.1.1.1.1")).toBe("::ffff:999.1.1.1.1");
  });
});

describe("isPrivateAddress —— 本机与内网放行", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "10.0.0.7",
    "192.168.1.5",
    "169.254.33.7",
    "172.16.0.1",
    "172.31.255.254",
    "my-macbook.local",
  ])("放行 %s", (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  it.each(["8.8.8.8", "1.2.3.4", "172.32.0.1", "172.15.0.1", "203.0.113.9", "example.com"])(
    "拦截 %s",
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(false);
    }
  );

  // 172.16/12 的两端边界：这两个用例原实现就没覆盖，属于本次补的边界固化
  it("172.16.0.0 与 172.31.255.255 在私网段内", () => {
    expect(isPrivateAddress("172.16.0.0")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
  });

  it("172.15.255.255 与 172.32.0.0 已出私网段", () => {
    expect(isPrivateAddress("172.15.255.255")).toBe(false);
    expect(isPrivateAddress("172.32.0.0")).toBe(false);
  });

  // 回归：next start 塞进 x-forwarded-for 的是 ::ffff:127.0.0.1，
  // 少了归一化就会把本机自己拦在门外（v3.1.115 实测踩到）
  it.each(["::ffff:127.0.0.1", "::ffff:192.168.1.5", "::ffff:10.0.0.3"])(
    "放行 IPv4 映射地址 %s",
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(true);
    }
  );

  it("IPv4 映射地址不会把公网 IP 误判成内网", () => {
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("IPv6 链路本地与唯一本地地址放行", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
  });

  it("空地址与脏数据一律当作不安全，不做放行猜测", () => {
    expect(isPrivateAddress("")).toBe(false);
    expect(isPrivateAddress("   ")).toBe(false);
  });

  it("IPv6 字面量带方括号也能识别", () => {
    expect(isPrivateAddress("[::1]")).toBe(true);
  });

  it("大小写与首尾空格不影响判定", () => {
    expect(isPrivateAddress("  LOCALHOST  ")).toBe(true);
    expect(isPrivateAddress("192.168.0.1\n")).toBe(true);
  });
});

describe("isManagedHosting —— 托管平台不做拦截", () => {
  it("Vercel 上视为作者主动公开，放行（否则公开演示会满屏 403）", () => {
    expect(isManagedHosting({ VERCEL: "1" })).toBe(true);
  });

  it("自托管环境（无 VERCEL 变量）照常受保护", () => {
    expect(isManagedHosting({})).toBe(false);
    expect(isManagedHosting({ VERCEL: "" })).toBe(false);
  });
});

describe("shouldBlock —— 向后兼容的旧签名", () => {
  it("默认放行局域网，拦公网", () => {
    expect(shouldBlock("192.168.1.5", false)).toBe(false);
    expect(shouldBlock("8.8.8.8", false)).toBe(true);
  });

  it("ALLOW_PUBLIC 打开后公网也放行（作者自行承担风险）", () => {
    expect(shouldBlock("8.8.8.8", true)).toBe(false);
  });

  it("开关关闭时，哪怕来源为空也拦下（不猜、不默认信任）", () => {
    expect(shouldBlock("", false)).toBe(true);
  });
});

describe("clientAddress —— 向后兼容的旧签名", () => {
  it("默认模式下优先采信 x-forwarded-for 的第一个地址", () => {
    const headers = h({ "x-forwarded-for": "203.0.113.1, 10.0.0.1, 192.168.0.1" });
    expect(clientAddress(headers)).toBe("203.0.113.1");
  });

  it("没有 xff 时退回 x-real-ip", () => {
    expect(clientAddress(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("只有 Host 时去掉端口", () => {
    expect(clientAddress(h({ host: "192.168.1.5:3001" }))).toBe("192.168.1.5");
    expect(clientAddress(h({ host: "localhost:3001" }))).toBe("localhost");
  });

  it("IPv6 的 Host 取方括号内的字面量，不被冒号切碎", () => {
    expect(clientAddress(h({ host: "[::1]:3001" }))).toBe("::1");
  });

  it("xff 为空字符串时不吞掉后面的 x-real-ip", () => {
    expect(clientAddress(h({ "x-forwarded-for": "   ", "x-real-ip": "10.9.8.7" }))).toBe("10.9.8.7");
  });
});

// ============================================================
// 二、本次加固的核心：伪造 XFF 必须被识破
// ============================================================

describe("伪造 X-Forwarded-For —— 本次修复的主缺口", () => {
  it("trust-cf-only 下伪造内网 XFF 一律拿不到地址 → 拦", () => {
    const headers = h({ "x-forwarded-for": "192.168.1.5" });
    const r = resolveClientAddress(headers, { mode: "trust-cf-only" });
    expect(r.address).toBe("");
    expect(r.source).toBe("unknown");
    expect(r.trusted).toBe(false);

    const d = evaluateRequest(headers, { mode: "trust-cf-only", env: {} });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-unknown-source");
  });

  it("trust-cf-only 下伪造 X-Real-IP / Host 同样无效", () => {
    expect(
      evaluateRequest(h({ "x-real-ip": "10.0.0.9", host: "localhost:3001" }), {
        mode: "trust-cf-only",
        env: {},
      }).blocked
    ).toBe(true);
  });

  it("direct 模式下伪造任何客户端头都无效，只认 socket 地址", () => {
    const headers = h({ "x-forwarded-for": "192.168.1.5", host: "localhost:3001" });
    expect(resolveClientAddress(headers, { mode: "direct" }).address).toBe("");
    expect(
      evaluateRequest(headers, { mode: "direct", env: {} }).blocked
    ).toBe(true);

    // 给了 socket 地址就以它为准，伪造头被无视
    const withSocket = resolveClientAddress(headers, {
      mode: "direct",
      socketAddress: "203.0.113.9",
    });
    expect(withSocket.address).toBe("203.0.113.9");
    expect(withSocket.source).toBe("socket");
    expect(evaluateRequest(headers, { mode: "direct", socketAddress: "203.0.113.9", env: {} }).blocked).toBe(
      true
    );
  });

  it("direct 模式下伪造头 + 真实内网 socket → 按 socket 放行（本机正常访问不受影响）", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "8.8.8.8" }), {
      mode: "direct",
      socketAddress: "::ffff:127.0.0.1",
      env: {},
    });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-private");
    // 归一化后的地址是 127.0.0.1，不是带前缀的映射写法
    expect(d.address).toBe("127.0.0.1");
  });

  it("direct 模式下 socket 是公网地址 → 拦（防止只信任伪造头）", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "192.168.1.5" }), {
      mode: "direct",
      socketAddress: "203.0.113.9",
      env: {},
    });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-public-source");
  });

  it("trust-proxy-header（兼容模式）下伪造 XFF 会被标注为不可信", () => {
    const r = resolveClientAddress(h({ "x-forwarded-for": "192.168.1.5" }), {
      mode: "trust-proxy-header",
    });
    expect(r.trusted).toBe(false);
    expect(r.source).toBe("x-forwarded-for");
  });

  it("trust-proxy-header 下伪造 XFF 首段配公网 X-Real-IP 时以 XFF 为准（行为与旧版一致）", () => {
    // 这一条固化「兼容模式就是兼容模式」：它挡不住伪造，是有意保留的残余风险，
    // 由 README 的「别把端口暴露到公网」来兜底。
    const r = resolveClientAddress(
      h({ "x-forwarded-for": "192.168.1.5", "x-real-ip": "203.0.113.9" }),
      { mode: "trust-proxy-header" }
    );
    expect(r.address).toBe("192.168.1.5");
  });
});

describe("Cloudflare 环境下按真实 CF-Connecting-IP 判定", () => {
  it("伪造 XFF 首段 + 带真实 CF 头 → 取 CF 的真实公网 IP → 拦", () => {
    const d = evaluateRequest(
      h({ "x-forwarded-for": "192.168.1.5, 203.0.113.9", "cf-connecting-ip": "203.0.113.9" }),
      { mode: "trust-cf-only", env: {} }
    );
    expect(d.address).toBe("203.0.113.9");
    expect(d.source).toBe("cf-connecting-ip");
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-public-source");
  });

  it("伪造 XFF 首段 + CF 头是真实内网 IP → 按 CF 的值放行（家里网络访问的正常情形）", () => {
    const d = evaluateRequest(
      h({ "x-forwarded-for": "8.8.8.8", "cf-connecting-ip": "192.168.1.5" }),
      { mode: "trust-cf-only", env: {} }
    );
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-private");
  });

  it("CF 头排在 XFF 之前，连兼容模式下也不会被伪造首段带偏", () => {
    const r = resolveClientAddress(
      h({ "x-forwarded-for": "192.168.1.5", "cf-connecting-ip": "203.0.113.9" }),
      { mode: "trust-proxy-header" }
    );
    expect(r.address).toBe("203.0.113.9");
    expect(r.source).toBe("cf-connecting-ip");
    expect(r.trusted).toBe(true);
  });

  it("CF 头带 IPv4 映射写法也能正常归一化后判定", () => {
    const d = evaluateRequest(h({ "cf-connecting-ip": "::ffff:192.168.1.5" }), {
      mode: "trust-cf-only",
      env: {},
    });
    expect(d.blocked).toBe(false);
  });
});

// ============================================================
// 三、未知来源的保守行为
// ============================================================

describe("未知来源 —— 绝不默认放行", () => {
  it("trust-cf-only 下没有任何可用头 → 拦", () => {
    const d = evaluateRequest(h({ host: "localhost:3001" }), { mode: "trust-cf-only", env: {} });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-unknown-source");
  });

  it("direct 模式下拿不到 socket 地址 → 拦（而不是回退去信任客户端头）", () => {
    const d = evaluateRequest(h({ host: "192.168.1.5:3001" }), { mode: "direct", env: {} });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-unknown-source");
    expect(d.address).toBe("");
  });

  it("ALLOW_UNKNOWN_SOURCE=true 是显式逃生口，能放行未知来源", () => {
    const d = evaluateRequest(h({}), {
      mode: "trust-cf-only",
      env: { ALLOW_UNKNOWN_SOURCE: "true" },
    });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-unknown-source");
  });

  it("ALLOW_UNKNOWN_SOURCE 只影响未知来源，不会把公网 IP 也放行", () => {
    const d = evaluateRequest(h({ "cf-connecting-ip": "8.8.8.8" }), {
      mode: "trust-cf-only",
      env: { ALLOW_UNKNOWN_SOURCE: "true" },
    });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-public-source");
  });

  it("兼容模式下 Host 存在就不算未知来源（保持旧行为），但 Host 为空才算未知", () => {
    expect(evaluateRequest(h({ host: "192.168.1.5:3001" }), { env: SELF_HOSTED_ENV }).blocked).toBe(
      false
    );
    const empty = evaluateRequest(h({}), { env: SELF_HOSTED_ENV });
    expect(empty.blocked).toBe(true);
    expect(empty.reason).toBe("block-unknown-source");
  });
});

// ============================================================
// 四、开关：ALLOW_PUBLIC / 令牌 / VERCEL
// ============================================================

describe("ALLOW_PUBLIC 与访问令牌", () => {
  it("ALLOW_PUBLIC=true 且未配令牌 → 全部放行（与旧版行为一致）", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "8.8.8.8" }), {
      mode: "trust-cf-only",
      env: { ALLOW_PUBLIC: "true" },
    });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-public-optin");

    const d2 = evaluateRequest(h({}), { mode: "trust-cf-only", env: { ALLOW_PUBLIC: "true" } });
    expect(d2.blocked).toBe(false);
  });

  it("ALLOW_PUBLIC=true 且配了令牌 → 令牌不对仍然拦（防手滑裸奔）", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "8.8.8.8" }), {
      mode: "trust-cf-only",
      env: { ALLOW_PUBLIC: "true", ALLOW_PUBLIC_TOKEN: "s3cret-token" },
      token: "wrong",
    });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-missing-public-token");
  });

  it("令牌正确 → 放行", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "8.8.8.8" }), {
      mode: "trust-cf-only",
      env: { ALLOW_PUBLIC: "true", ALLOW_PUBLIC_TOKEN: "s3cret-token" },
      token: "s3cret-token",
    });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-public-optin");
  });

  it("配了令牌但请求没带令牌 → 拦", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "8.8.8.8" }), {
      mode: "trust-cf-only",
      env: { ALLOW_PUBLIC: "true", ALLOW_PUBLIC_TOKEN: "s3cret-token" },
    });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe("block-missing-public-token");
  });

  it("令牌长度不同不会走逐字节比较的坑，且判定为不匹配", () => {
    const d = evaluateRequest(h({}), {
      mode: "trust-cf-only",
      env: { ALLOW_PUBLIC: "true", ALLOW_PUBLIC_TOKEN: "abcdef" },
      token: "abc",
    });
    expect(d.blocked).toBe(true);
  });

  it("没开 ALLOW_PUBLIC 时，令牌不产生任何作用（内网照常放行）", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "192.168.1.5" }), {
      mode: "trust-proxy-header",
      env: { ALLOW_PUBLIC_TOKEN: "s3cret-token" },
      token: "nope",
    });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-private");
  });
});

describe("Vercel 托管环境", () => {
  it("VERCEL 存在时一切放行，包括伪造内网 XFF（托管平台本就没有本地 SQLite）", () => {
    const d = evaluateRequest(h({ "x-forwarded-for": "192.168.1.5" }), {
      mode: "trust-cf-only",
      env: { VERCEL: "1" },
    });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-managed-hosting");
  });

  it("VERCEL 优先于 ALLOW_PUBLIC 令牌判定（不需要令牌）", () => {
    const d = evaluateRequest(h({}), {
      mode: "trust-cf-only",
      env: { VERCEL: "1", ALLOW_PUBLIC: "true", ALLOW_PUBLIC_TOKEN: "t" },
    });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe("allow-managed-hosting");
  });

  it("VERCEL=\"\"（空值）不算托管环境，照常受保护", () => {
    const d = evaluateRequest(h({ "cf-connecting-ip": "8.8.8.8" }), {
      mode: "trust-cf-only",
      env: { VERCEL: "" },
    });
    expect(d.blocked).toBe(true);
  });
});

// ============================================================
// 五、模式解析
// ============================================================

describe("resolveProxyMode", () => {
  it("默认值是 trust-proxy-header（与旧行为兼容）", () => {
    expect(resolveProxyMode({})).toBe("trust-proxy-header");
    expect(resolveProxyMode({ TRUSTED_PROXY_MODE: "" })).toBe("trust-proxy-header");
  });

  it("三种模式都能正确解析（含大小写与空格容错）", () => {
    expect(resolveProxyMode({ TRUSTED_PROXY_MODE: "direct" })).toBe("direct");
    expect(resolveProxyMode({ TRUSTED_PROXY_MODE: "  Trust-CF-Only " })).toBe("trust-cf-only");
    expect(resolveProxyMode({ TRUSTED_PROXY_MODE: "trust-proxy-header" })).toBe("trust-proxy-header");
  });

  it("写了不认识的模式 → 回落到默认值，而不是抛错让服务起不来", () => {
    expect(resolveProxyMode({ TRUSTED_PROXY_MODE: "trust-everything" })).toBe("trust-proxy-header");
  });

  it("导出的模式清单与解析逻辑一致", () => {
    expect(TRUSTED_PROXY_MODES).toEqual(["trust-proxy-header", "trust-cf-only", "direct"]);
    for (const m of TRUSTED_PROXY_MODES) {
      expect(resolveProxyMode({ TRUSTED_PROXY_MODE: m })).toBe(m);
    }
  });
});

// ============================================================
// 六、限流
// ============================================================

describe("checkRateLimit —— 骚扰级缓解", () => {
  it("窗口内未超阈值时一直放行", () => {
    const state = createRateLimiterState();
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimit(state, "1.1.1.1", 1000 + i, { max: 5, windowMs: 1000 })).toBe(true);
    }
  });

  it("同一 IP 超阈值后被限，不同 IP 互不影响", () => {
    const state = createRateLimiterState();
    for (let i = 0; i < 3; i += 1) checkRateLimit(state, "1.1.1.1", 1000 + i, { max: 3, windowMs: 1000 });
    expect(checkRateLimit(state, "1.1.1.1", 1010, { max: 3, windowMs: 1000 })).toBe(false);
    expect(checkRateLimit(state, "2.2.2.2", 1010, { max: 3, windowMs: 1000 })).toBe(true);
  });

  it("窗口滑出后恢复（不是永久封禁）", () => {
    const state = createRateLimiterState();
    checkRateLimit(state, "1.1.1.1", 1000, { max: 1, windowMs: 1000 });
    expect(checkRateLimit(state, "1.1.1.1", 1500, { max: 1, windowMs: 1000 })).toBe(false);
    expect(checkRateLimit(state, "1.1.1.1", 2500, { max: 1, windowMs: 1000 })).toBe(true);
  });

  it("max<=0 视为关闭限流", () => {
    const state = createRateLimiterState();
    for (let i = 0; i < 20; i += 1) {
      expect(checkRateLimit(state, "1.1.1.1", 1000 + i, { max: 0 })).toBe(true);
    }
  });
});

// ============================================================
// 七、文案
// ============================================================

describe("被拦下的提示文案", () => {
  it("必须说清「为什么」和「怎么解除」，不能只丢一个 403", () => {
    expect(FORBIDDEN_MESSAGE).toContain("本地单机工具");
    expect(FORBIDDEN_MESSAGE).toContain("ALLOW_PUBLIC=true");
  });

  it("要顺带告诉作者该配哪个部署模式，否则 403 只会让人干瞪眼", () => {
    expect(FORBIDDEN_MESSAGE).toContain("TRUSTED_PROXY_MODE=trust-cf-only");
    expect(FORBIDDEN_MESSAGE).toContain("TRUSTED_PROXY_MODE=direct");
  });
});
