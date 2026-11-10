// ============================================================
// 番茄小说发布 · 凭据加密存取
// ============================================================
//
// 安全边界（必须如实写在产品里，不要吹）：
//   能做到 —— 数据库文件被拷走、被自动同步到云盘、被别人打开时，看不到 Cookie 明文；
//   做不到 —— 挡不住「以你的系统账号运行的程序」，因为密钥就在本机数据目录。
//   这是本机单用户工具的合理边界；真要更强就得走系统钥匙串（Electron safeStorage），
//   那条路在 Web 端（next dev / next start）不可用，所以这里用同构方案。
//
// 方案：AES-256-GCM，密钥首次运行时随机生成并落在 <数据目录>/.publish-key（32 字节）。
//   密文格式：v1:<iv-b64>:<tag-b64>:<cipher-b64>，版本前缀为将来轮换密钥留口。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDbPaths } from "@/lib/db-snapshot";
import type { FanqieCredentials } from "./types";

const KEY_FILE = ".publish-key";
const MAGIC = "v1";

function keyPath(): string {
  const { dir } = getDbPaths();
  return path.join(dir, KEY_FILE);
}

/** 读取或首次生成密钥（32 字节，AES-256） */
function loadKey(): Buffer {
  const p = keyPath();
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p);
      if (raw.length === 32) return raw;
      // 长度不对（被截断/损坏）→ 视为需要重建；旧密文将解不开，界面会提示重新连接
      console.warn("[publish/credentials] 密钥文件长度异常，已重建；旧凭据需要重新填写");
    }
  } catch (e) {
    console.warn("[publish/credentials] 读取密钥失败，将重建：", (e as Error).message);
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, key, { mode: 0o600 });
  return key;
}

/** 加密凭据对象 → 可入库的字符串 */
export function encryptCredentials(cred: FanqieCredentials): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(cred);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    MAGIC,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

/**
 * 解密。失败返回 null（密钥丢失、密文损坏、格式不符都归为「需要重新连接」），
 * 绝不抛异常打断发布调度。
 */
export function decryptCredentials(cipherText: string | null | undefined): FanqieCredentials | null {
  if (!cipherText) return null;
  const parts = cipherText.split(":");
  if (parts.length !== 4 || parts[0] !== MAGIC) return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const key = loadKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    const parsed = JSON.parse(out.toString("utf8")) as FanqieCredentials;
    if (!parsed?.cookie) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 脱敏展示：只留前 6 位与总长度，用于界面确认「确实连上了哪个账号」 */
export function maskCookie(cookie: string): string {
  const s = (cookie || "").trim();
  if (s.length <= 12) return "****";
  return `${s.slice(0, 6)}…（共 ${s.length} 字符）`;
}
