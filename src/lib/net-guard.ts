// ============================================================
// 本地优先 · 访问控制判定（纯函数，零依赖，便于单元测试）
// ============================================================
//
// 为什么单独拆一个文件：
//   src/proxy.ts 是 Next 的约定文件，必须 import next/server，
//   直接测它会把 Next 运行时拖进测试进程。判定逻辑才是真正需要测的部分，
//   所以放在这里做成纯函数，proxy.ts 只做「拿请求头 → 调这里 → 决定放不放行」。
//
// 背景：
//   本项目共 137 个 API 路由，此前没有任何一层入站鉴权。
//   在「数据本地零外泄、单机自托管」定位下这原本可接受——作者自己和自己之间不需要鉴权。
//   但项目带 deploy-local.ps1，一旦被部署到局域网甚至公网，
//   就变成任何人可读写全部稿件、还能白刷作者自己的 AI 额度。
//   所以补一层**底线防护**：不是账号体系，而是「只认本地与内网」。
//
// 设计取舍（重要）：
//   - 不引入登录/账号：那是云端产品的做法，违背「本地优先、零配置」的定位。
//   - 放行局域网：手机连家里 WiFi 访问 192.168.x.x 是合理场景，不能误伤。
//   - 拦公网：非私网来源一律拒绝，把「误部署到公网」这个最坏情况堵死。
//   - 留后门开关：确实要公网部署的人显式设 ALLOW_PUBLIC=true 即可解除，
//     属于「自己清楚风险并主动承担」，而不是被默认值坑。

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

/**
 * 从请求头里取客户端地址。
 * 顺序：x-forwarded-for（取第一个）→ x-real-ip → Host（去端口 / 取 IPv6 字面量）。
 */
export function clientAddress(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();

  // 自托管场景（next dev / next start）通常只有 Host，
  // 形如 localhost:3001、192.168.1.5:3001、[::1]:3001
  let host = (headers.get("host") ?? "").trim();
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close > 0) return host.slice(1, close); // IPv6 字面量
  }
  const colon = host.lastIndexOf(":");
  if (colon > 0) host = host.slice(0, colon); // 去掉端口
  return host;
}

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
 * 是否应当拒绝这次访问。
 * @param addr        客户端地址（由 clientAddress 取到）
 * @param allowPublic 显式开关：true 表示作者已确认要对外提供服务
 */
export function shouldBlock(addr: string, allowPublic: boolean): boolean {
  if (allowPublic) return false;
  return !isPrivateAddress(addr);
}

/** 被拦下时回给调用方的说明文案，便于测试固化，也便于界面直接展示 */
export const FORBIDDEN_MESSAGE =
  "Novel Smith 定位为本地单机工具，只接受来自本机或局域网的访问。若确认需要对外提供服务，请自行评估风险后设置环境变量 ALLOW_PUBLIC=true。";
