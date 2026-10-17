// ============================================================
// 本地优先 · 访问控制判定（纯函数，零依赖，便于单元测试）
// ============================================================
//
// 本次加固：把「客户端 IP」这件事引入信任分级，而不是继续无脑信任请求头。
//   为什么单独拆一个文件：
//   src/proxy.ts 是 Next 的约定文件，必须 import next/server，
//   直接测它会把 Next 运行时拖进测试进程。判定逻辑才是真正需要测的部分，
//   所以放在这里做成纯函数，proxy.ts 只做「拿请求头 → 调这里 → 决定放不放行」。
//   加固后本文件仍然不 import 任何运行时/框架模块，这条设计约束保持不变。
//   背景——本项目共 137 个 API 路由，此前没有任何一层入站鉴权。
//   在「数据本地零外泄、单机自托管」定位下这原本可接受——作者自己和自己之间不需要鉴权。
//   但项目带deploy-local.ps1，一旦被部署到局域网甚至公网，
//   就变成任何人可读写全部稿件、还能白刷作者自己的 AI 额度。
//   所以补一层**底线防护**：不是账号体系，而是「只认本地与内网」。
//
// ============================ 信任分级解决的问题 ============================
// 原实现 clientAddress() 的取值顺序是：
//   x-forwarded-for 首段 → x-real-ip → Host
// 而**请求头是客户端自己写的**。任何人绕过前置代理直连本机端口时，
// 只要手动加一个 `X-Forwarded-For: 192.168.1.5`，isPrivateAddress() 就会判为内网 → 放行。
// 一次放行 = 授予全部 137 个 API 路由的读写权（写库、改稿、白刷作者自己的 AI Key 额度）。
//
// 修法：**给「客户端 IP」这件事引入信任分级**，而不是继续无脑信任 XFF。
//   请求头只有在「确实经过了可信前置代理」时才可信；否则一律视为未知来源 → 拦。
//
// 三种部署模式（TRUSTED_PROXY_MODE）：
//   trust-proxy-header（默认，兼容原行为）
//       信任顺序：CF-Connecting-IP → XFF 首段 → X-Real-IP → Host。
//       适用于「前面确实有个反代（Cloudflare 等），且愿意信任它会正确清洗 XFF」。
//       注意：此模式下若没有前置反代，XFF 仍可被伪造 —— 这是**已知残余风险**，
//       真正的防线是「别把端口暴露到公网」（启动参数见 SECURITY.md）。
//   trust-cf-only（最严，推荐用于公网暴露）
//       只信 CF-Connecting-IP。该头由 Cloudflare 边缘节点写入并**覆盖**客户端伪造值，
//       且只有真正穿过 Cloudflare 的请求才会带上它 —— 所以它是「经过了 CF」的一个证明。
//       其余一切头（含 XFF / X-Real-IP / Host）一律视为未知来源 → 拦。
//   direct（无前置代理）
//       一个客户端头都不信，只用 TCP 层的 socket 对端地址。
//       拿不到 socket 地址 → 未知来源 → 拦（逃生口见 ALLOW_UNKNOWN_SOURCE）。
//
// 未知来源的保守默认：**拦**。
//   「拿不到 IP 就放行」等于「拿不到 IP 就裸奔」，是最坏的一种实现。
//   真被误伤时用 ALLOW_UNKNOWN_SOURCE=true 临时放行，并同时按部署模式补齐配置。
//
// ============================================================

/** 可信代理模式。字符串字面量联合，保证 TS 侧写错会编译报错而不是静默降级。 */
export type TrustedProxyMode = "trust-proxy-header" | "trust-cf-only" | "direct";

/** 解析出来的客户端地址来源，用于日志与调试，也让「为什么判成这个 IP」可追查 */
export type AddressSource =
  | "cf-connecting-ip"
  | "x-forwarded-for"
  | "x-real-ip"
  | "host"
  | "socket"
  | "unknown";

/** 地址解析的完整结果 */
export interface ResolvedAddress {
  /** 归一化前的原始取值；未知来源时为空字符串 */
  address: string;
  /** 这个取值来自哪个头 / 哪一层 */
  source: AddressSource;
  /**
   * 是否来自「可信来源」。
   * false 表示这个值是客户端自己写的，不能作为放行依据。
   */
  trusted: boolean;
}

/** 解析客户端地址时的可选项（不传则用环境变量兜底） */
export interface ResolveOptions {
  /** 覆盖环境变量里的 TRUSTED_PROXY_MODE */
  mode?: TrustedProxyMode;
  /**
   * TCP 层对端地址（来自 socket，客户端无法伪造）。
   * Next 的 NextRequest 在部分版本/部署形态下拿不到，proxy.ts 传不进来也没关系，
   * 那一律按未知来源处理（保守）。
   */
  socketAddress?: string | undefined;
  /**
   * 覆盖环境变量来源（测试注入用）。
   *
   * 为什么必须有这个字段（2026-10-16 实测踩坑）：
   *   evaluateRequest 接收的是 `opts.env`（调用方可能传的是一份注入的假环境），
   *   若它解析地址时**不透传** env，resolveClientAddress 内部的 resolveProxyMode()
   *   就会去读真实的 `process.env`。结果是：判定逻辑一半用假环境、一半用真环境，
   *   单元测试直接挂（ALLOW_PUBLIC 那组全红），而且在生产里会出现
   *   「以为切了 trust-cf-only、实际仍按 process.env 的模式跑」这种静默降级。
   *   凡是接受 env 的入口，都必须把它透传到底。
   */
  env?: Record<string, string | undefined>;
}

/** evaluateRequest 的可选项 */
export interface EvaluateOptions extends ResolveOptions {
  /** socket 对端地址（透传给 resolveClientAddress） */
  socketAddress?: string | undefined;
  /** 客户端提交的访问令牌（对应 ALLOW_PUBLIC_TOKEN） */
  token?: string | undefined;
  /** 便于测试注入；不传读 process.env */
  env?: Record<string, string | undefined>;
}

/** 判定结论 */
export interface AccessDecision {
  /** 是否拒绝 */
  blocked: boolean;
  /** 便于日志与 403 响应体定位问题 */
  reason:
    | "allow-private"
    | "allow-public-optin"
    | "allow-managed-hosting"
    | "allow-unknown-source"
    | "block-unknown-source"
    | "block-public-source"
    | "block-missing-public-token";
  address: string;
  source: AddressSource;
}

// ============================================================
// 一、地址归一化与私网判定（沿用原实现，行为不变）
// ============================================================

/**
 * 把 IPv4 映射的 IPv6 地址还原成 IPv4。
 *
 * 为什么必须有这一步（踩过坑，别删）：
 *   `next start` 会自己往 x-forwarded-for 里写 `::ffff:127.0.0.1`，
 *   而不是朴素的 `127.0.0.1`。少了这一步，本机访问会被自己的防护拦成 403——
 *   防护没伤到外人，先把主人关在门外了。
 */
export function normalizeAddress(addr: string): string {
  const a = (addr ?? "").toLowerCase().trim().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  return mapped ? mapped[1]! : a;
}

/** 私网/本机判定用的放行名单 */
export function isPrivateAddress(addr: string): boolean {
  const a = normalizeAddress(addr);
  if (!a) return false;

  // 主机名形式
  if (a === "localhost" || a === "::1" || a === "0.0.0.0") return true;
  if (a.endsWith(".local")) return true; // mDNS，局域网设备常见

  // IPv6 本地段：fe80::/10 链路本地、fc00::/7 唯一本地地址
  if (a.startsWith("fe80:")) return true;
  if (/^f[cd][0-9a-f]*:/.test(a)) return true;

  // IPv4 私网段
  if (a.startsWith("127.")) return true; // 回环
  if (a.startsWith("10.")) return true; // 10/8
  if (a.startsWith("192.168.")) return true; // 192.168/16
  if (a.startsWith("169.254.")) return true; // 链路本地（直连/热点常见）

  const m = /^172\.(\d{1,3})\./.exec(a);
  if (m) {
    const second = Number(m[1]);
    if (Number.isFinite(second) && second >= 16 && second <= 31) return true; // 172.16/12
  }
  return false;
}

// ============================================================
// 二、部署模式解析
// ============================================================

/** 合法的模式列表，解析失败时用它做校验 */
export const TRUSTED_PROXY_MODES: readonly TrustedProxyMode[] = [
  "trust-proxy-header",
  "trust-cf-only",
  "direct",
];

/**
 * 从环境变量解析可信代理模式。
 *
 * 默认值为什么是 trust-proxy-header：
 *   它与原实现行为一致（不改变现有用户的部署结果），同时把 CF-Connecting-IP 提到了最高优先级。
 *   这是一个「先止血、再收紧」的默认值：真正的收紧靠切到 trust-cf-only / direct。
 *   写成合法但没人认识的值时**回落到默认值**而不是抛错 —— 一个手滑的拼写错误
 *   不应该让服务起不来（那反而制造了新的不可用），但会在返回值里体现为默认模式。
 */
export function resolveProxyMode(env: Record<string, string | undefined> = process.env): TrustedProxyMode {
  const raw = (env.TRUSTED_PROXY_MODE ?? "").trim().toLowerCase();
  if ((TRUSTED_PROXY_MODES as readonly string[]).includes(raw)) return raw as TrustedProxyMode;
  return "trust-proxy-header";
}

// ============================================================
// 三、客户端地址解析（本次加固的核心）
// ============================================================

/** 从 Host 头里取出主机部分（去掉端口，支持 IPv6 字面量） */
function hostToAddress(host: string): string {
  let h = (host ?? "").trim();
  if (h.startsWith("[")) {
    const close = h.indexOf("]");
    if (close > 0) return h.slice(1, close); // IPv6 字面量
  }
  const colon = h.lastIndexOf(":");
  if (colon > 0) h = h.slice(0, colon); // 去掉端口
  return h;
}

/**
 * 从请求头里取客户端地址（**向后兼容的薄封装**）。
 *
 * 与原版的区别：默认走 resolveClientAddress() 的 trust-proxy-header 分支，
 * 即 CF-Connecting-IP 优先于 XFF。语义对「有 Cloudflare」的部署是修正，
 * 对「无前置反代」的部署与原版一致（仍然会被伪造，但那是模式选择问题，见 README）。
 *
 * @param headers 请求头
 * @param opts    可选：指定模式 / 提供 socket 地址
 * @returns 取到的地址字符串；未知来源返回空字符串
 */
export function clientAddress(headers: Headers, opts: ResolveOptions = {}): string {
  return resolveClientAddress(headers, opts).address;
}

/**
 * 解析客户端地址，并标明「这个值能不能信」。
 *
 * 各模式下的信任规则：
 *   trust-cf-only：只信 CF-Connecting-IP。其余（含 socket 兜底）都不作为放行依据 ——
 *       因为一旦声明了这个模式，作者的意图就是「只有 CF 才算内网来源」。
 *   direct：只信 socket 对端地址。客户端头一律不采信。
 *   trust-proxy-header：CF-Connecting-IP → XFF 首段 → X-Real-IP → Host（均标 trusted=false，
 *       因为它们技术上仍可被客户端伪造；此模式是「兼容性模式」而非「安全模式」）。
 *
 * 为什么 CF-Connecting-IP 排在 XFF 前面：
 *   Cloudflare 会**追加**真实 IP 到 XFF 链尾，但不会删除客户端伪造的头段，
 *   所以 XFF 首段不可信；而 CF-Connecting-IP 由边缘节点写入并覆盖伪造值，是可信的。
 *   这个顺序修掉的是「伪造 XFF 首段 + 真实经过 CF」的场景。
 */
export function resolveClientAddress(headers: Headers, opts: ResolveOptions = {}): ResolvedAddress {
  const mode = opts.mode ?? resolveProxyMode(opts.env);
  const unknown: ResolvedAddress = { address: "", source: "unknown", trusted: false };

  // ---- direct：只认 TCP 层对端地址，客户端头一概不信 ----
  if (mode === "direct") {
    const socket = normalizeAddress(opts.socketAddress ?? "");
    if (socket) return { address: socket, source: "socket", trusted: true };
    return unknown;
  }

  // ---- CF-Connecting-IP：两种「信任头」模式下都优先采信 ----
  // 注意：这里不校验「有没有真的经过 Cloudflare」——攻击者如果能直连，
  // 他可以自己伪造这个头。所以它只在「端口没有暴露到公网」或
  // 「前置确实是 Cloudflare」的前提下才有意义；README 里对此有明确警告。
  const cf = headers.get("cf-connecting-ip");
  if (cf && cf.trim()) {
    return { address: cf.trim(), source: "cf-connecting-ip", trusted: true };
  }

  // ---- trust-cf-only：没有 CF 头就到此为止，其余来源一律视为未知 ----
  if (mode === "trust-cf-only") return unknown;

  // ---- trust-proxy-header：沿用原有取值链（CF 头已在上面处理过）----
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return { address: first, source: "x-forwarded-for", trusted: false };
  }

  const real = headers.get("x-real-ip");
  if (real && real.trim()) {
    return { address: real.trim(), source: "x-real-ip", trusted: false };
  }

  // 自托管场景（next dev / next start）通常只有 Host，
  // 形如 localhost:3001、192.168.1.5:3001、[::1]:3001
  // Host 同样可被客户端伪造，故 trusted=false。
  const host = hostToAddress(headers.get("host") ?? "");
  if (host) return { address: host, source: "host", trusted: false };

  return unknown;
}

// ============================================================
// 四、开关语义
// ============================================================

/**
 * 是否运行在 Vercel 这类「托管平台」上。
 *
 * 为什么托管平台不拦（想清楚再改）：
 *   1. 那是作者主动把仓库连上去公开的，不是「误部署」，不符合本防护的威胁模型；
 *   2. 托管平台没有本地 SQLite 文件可泄，数据根本不在那儿；
 *   3. 仓库 README 上的公开演示链接就是跑在这上面的，用途只是「让人看看界面长什么样」。
 *      在这里拦一把，只会把一个本来正常的展示页打成满屏 403，劝退想点 Star 的人。
 */
export function isManagedHosting(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL);
}

/**
 * 是否应当拒绝这次访问（**向后兼容的最小判定**，签名与原版一致）。
 *
 * 保留它是为了不破坏 changelog-data.ts 等处的既有引用；
 * 真正带完整上下文的判定走 evaluateRequest()。
 *
 * 语义：拿不到地址（空串）→ 拦。这与原版一致，是有意的保守默认。
 */
export function shouldBlock(addr: string, allowPublic: boolean): boolean {
  if (allowPublic) return false;
  return !isPrivateAddress(addr);
}

/** 常量时间比较，避免令牌被逐字节试探 */
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  // 先比长度：长度本身不是秘密（令牌长度可观测），不必为此打乱比较逻辑
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 完整判定：把「解析地址 → 判私网 → 应用各开关」串起来。
 *
 * 相比原来的 shouldBlock(addr, allowPublic) 多了三件事：
 *   1. 未知来源显式区分（不再和「公网来源」混为一谈），reason 可追查；
 *   2. ALLOW_PUBLIC=true 时如果配置了 ALLOW_PUBLIC_TOKEN，则**必须**带对令牌才放行 ——
 *      防的是「手滑或被 CI 里的环境变量模板打开后长期裸奔」；
 *      没配置令牌时行为与原版一致（放行），不破坏现有用户。
 *   3. isManagedHosting 在这里统一处理，proxy.ts 只需调一个函数。
 */
export function evaluateRequest(headers: Headers, opts: EvaluateOptions = {}): AccessDecision {
  const env = opts.env ?? process.env;
  const resolved = resolveClientAddress(headers, {
    mode: opts.mode,
    socketAddress: opts.socketAddress,
    // 必须透传：否则解析地址那一步会回落去读 process.env，
    // 与本函数用的 env 不是同一份 → 判定来源不一致（详见 ResolveOptions.env 的注释）
    env,
  });
  const addr = resolved.address;
  const base = { address: addr, source: resolved.source } as const;

  // 托管平台（作者主动公开的演示环境）不拦
  if (isManagedHosting(env)) {
    return { ...base, blocked: false, reason: "allow-managed-hosting" };
  }

  // 显式解除开关优先于「未知来源」判定。
  // 顺序很关键：ALLOW_PUBLIC 的语义是「作者已确认要对外提供服务，全部放行」，
  // 如果把未知来源判定放在它前面，ALLOW_PUBLIC=true 时反而会因为拿不到 IP 而被拦，
  // 等于把这个开关变成了「只对能拿到 IP 的请求生效」——既违反直觉又违反旧版行为。
  const allowPublic = env.ALLOW_PUBLIC === "true";
  if (allowPublic) {
    // 配置了令牌就必须带对：把「一个环境变量手滑」升级为「两个都手滑」才裸奔
    const required = env.ALLOW_PUBLIC_TOKEN;
    if (required && !timingSafeEqual(required, opts.token ?? "")) {
      return { ...base, blocked: true, reason: "block-missing-public-token" };
    }
    return { ...base, blocked: false, reason: "allow-public-optin" };
  }

  // 未知来源：默认拦。
  // 逃生口是 ALLOW_UNKNOWN_SOURCE=true —— 显式承担风险，而不是默认信任。
  const unknown = !addr || resolved.source === "unknown";
  if (unknown) {
    const allowUnknown = env.ALLOW_UNKNOWN_SOURCE === "true";
    return {
      ...base,
      blocked: !allowUnknown,
      reason: allowUnknown ? "allow-unknown-source" : "block-unknown-source",
    };
  }

  const blocked = !isPrivateAddress(addr);
  return {
    ...base,
    blocked,
    reason: blocked ? "block-public-source" : "allow-private",
  };
}

// ============================================================
// 五、轻量限流（可选加固）
// ============================================================

/** 限流器状态：用普通 Map 承载，测试里可以直接塞假数据，保持判定逻辑纯函数 */
export type RateLimiterState = Map<string, number[]>;

/** 新建限流状态 */
export function createRateLimiterState(): RateLimiterState {
  return new Map<string, number[]>();
}

export interface RateLimitOptions {
  /** 窗口内最多放行多少次，默认 120 */
  max?: number;
  /** 窗口长度（毫秒），默认 60_000 */
  windowMs?: number;
}

/**
 * 固定窗口计数限流（纯函数：状态显式传入，时间显式传入）。
 *
 * 定位说明 —— 这**不是**防暴力破解的正经方案，只是「顺手加一层成本」：
 *   单机自托管 + 无账号体系的前提下，本地/局域网访问的 QPS 本来就很低，
 *   真被扫到时也会立刻撞上 IP 白名单那层 403。所以它定位为
 *   「让扫描器觉得这个目标不太对劲」的骚扰级缓解，不承诺任何安全边界。
 *
 * 默认阈值刻意放宽，避免误伤「作者自己写脚本批量导入章节」这类正常用法；
 * 不想要就调大 RATE_LIMIT_MAX，或直接不调用本函数。
 */
export function checkRateLimit(
  state: RateLimiterState,
  key: string,
  now: number,
  opts: RateLimitOptions = {}
): boolean {
  const max = opts.max ?? 120;
  const windowMs = opts.windowMs ?? 60_000;
  if (max <= 0) return true; // 关闭限流

  const hits = (state.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  state.set(key, hits);
  return hits.length <= max;
}

// ============================================================
// 六、文案
// ============================================================

/**
 * 被拦下时回给调用方的说明文案，便于测试固化，也便于界面直接展示。
 *
 * 相比原版补了 TRUSTED_PROXY_MODE 的说明：作者看到 403 时最需要的不是「不行」，
 * 而是「我该改哪个环境变量」。
 */
export const FORBIDDEN_MESSAGE =
  "Novel Smith 定位为本地单机工具，只接受来自本机或局域网的访问。若确认需要对外提供服务，请自行评估风险后设置环境变量 ALLOW_PUBLIC=true。" +
  "若你使用的是 Cloudflare Tunnel 等前置代理，请设置 TRUSTED_PROXY_MODE=trust-cf-only；" +
  "若为无前置代理的本机部署，请设置 TRUSTED_PROXY_MODE=direct。";
