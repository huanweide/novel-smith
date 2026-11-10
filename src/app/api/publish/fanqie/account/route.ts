/**
 * 番茄小说发布 · 账号配置
 *
 * GET  /api/publish/fanqie/account
 *   → 返回账号配置（凭据只回报「已连接/更新时间」，永不回传明文）
 *
 * POST /api/publish/fanqie/account
 *   { action: "connect", cookie, csrfToken }  保存凭据（加密入库）
 *   { action: "update", ...字段 }             改配置（绑定书/通道/时段/上限/自动模式）
 *   { action: "disconnect" }                  断开（清空凭据）
 *   { action: "probe" }                       用接口探测书架（返回状态码与响应片段）
 *   { action: "cdp" }                         检测调试端口与番茄页面
 *   { action: "inspect" }                     dump 页面真实可编辑元素与按钮
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeJson } from "@/lib/api-body";
import { encryptCredentials, decryptCredentials, maskCookie } from "@/core/publish/fanqie/credentials";
import { probeAccount, DEFAULT_ENDPOINTS } from "@/core/publish/fanqie/api-channel";
import { cdpStatus, inspectPage } from "@/core/publish/fanqie/cdp";
import { FANQIE_DAILY_HARD_CAP } from "@/core/publish/fanqie/types";

async function ensureAccount() {
  const existing = await prisma.publishAccount.findFirst({ where: { platform: "fanqie" } });
  if (existing) return existing;
  return prisma.publishAccount.create({
    data: { platform: "fanqie", label: "我的番茄账号" },
  });
}

function toPublic(a: Awaited<ReturnType<typeof ensureAccount>>) {
  const cred = decryptCredentials(a.credentialCipher);
  return {
    id: a.id,
    platform: a.platform,
    label: a.label,
    connected: !!cred,
    cookieHint: cred ? maskCookie(cred.cookie) : null,
    credentialUpdatedAt: a.credentialUpdatedAt,
    bookId: a.bookId,
    bookTitle: a.bookTitle,
    channel: a.channel,
    cdpEndpoint: a.cdpEndpoint,
    autoMode: a.autoMode,
    dailyLimit: a.dailyLimit,
    windowStartMin: a.windowStartMin,
    windowEndMin: a.windowEndMin,
    dailyHardCap: FANQIE_DAILY_HARD_CAP,
  };
}

export async function GET() {
  try {
    const account = await ensureAccount();
    return NextResponse.json({ ok: true, account: toPublic(account) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "读取账号失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const parsed = await safeJson(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as any;
  try {
    const account = await ensureAccount();
    const action = String(body.action || "");

    if (action === "connect") {
      const cookie = String(body.cookie || "").trim();
      const csrfToken = String(body.csrfToken || "").trim();
      if (!cookie) return NextResponse.json({ error: "Cookie 不能为空" }, { status: 400 });
      // 只做最基础的形状校验：能省掉一整类「复制少了半截」的无效调试
      if (!/sessionid|passport|sid_/i.test(cookie) && !/=/.test(cookie)) {
        return NextResponse.json(
          { error: "这串不像 Cookie：它应该是从 Request Headers 里复制的 `sessionid=...; ...` 形式" },
          { status: 400 },
        );
      }
      const cipher = encryptCredentials({
        cookie,
        csrfToken,
        capturedAt: new Date().toISOString(),
      });
      const updated = await prisma.publishAccount.update({
        where: { id: account.id },
        data: { credentialCipher: cipher, credentialUpdatedAt: new Date() },
      });
      return NextResponse.json({ ok: true, account: toPublic(updated) });
    }

    if (action === "disconnect") {
      const updated = await prisma.publishAccount.update({
        where: { id: account.id },
        data: { credentialCipher: null, credentialUpdatedAt: null },
      });
      return NextResponse.json({ ok: true, account: toPublic(updated) });
    }

    if (action === "update") {
      const data: any = {};
      if (typeof body.label === "string" && body.label.trim()) data.label = body.label.trim();
      if (typeof body.bookId === "string") data.bookId = body.bookId.trim() || null;
      if (typeof body.bookTitle === "string") data.bookTitle = body.bookTitle.trim() || null;
      if (body.channel === "api" || body.channel === "cdp" || body.channel === "auto") data.channel = body.channel;
      if (typeof body.cdpEndpoint === "string" && body.cdpEndpoint.trim()) data.cdpEndpoint = body.cdpEndpoint.trim();
      if (body.autoMode === "confirm" || body.autoMode === "auto") data.autoMode = body.autoMode;
      if (typeof body.dailyLimit === "number") {
        // 硬顶：配置再怎么填也不允许超过 3，这是「不碰量产红线」的代码级保证
        data.dailyLimit = Math.max(1, Math.min(FANQIE_DAILY_HARD_CAP, Math.floor(body.dailyLimit)));
      }
      if (typeof body.windowStartMin === "number") data.windowStartMin = Math.max(0, Math.min(1439, Math.floor(body.windowStartMin)));
      if (typeof body.windowEndMin === "number") data.windowEndMin = Math.max(0, Math.min(1439, Math.floor(body.windowEndMin)));
      if (Object.keys(data).length === 0) return NextResponse.json({ error: "没有可更新字段" }, { status: 400 });
      const updated = await prisma.publishAccount.update({ where: { id: account.id }, data });
      return NextResponse.json({ ok: true, account: toPublic(updated) });
    }

    if (action === "probe") {
      const cred = decryptCredentials(account.credentialCipher);
      if (!cred) return NextResponse.json({ error: "还没连接账号" }, { status: 400 });
      const endpoints = {
        books: typeof body.booksPath === "string" && body.booksPath.trim() ? body.booksPath.trim() : DEFAULT_ENDPOINTS.books,
        chapters: DEFAULT_ENDPOINTS.chapters,
        publish: typeof body.publishPath === "string" && body.publishPath.trim() ? body.publishPath.trim() : DEFAULT_ENDPOINTS.publish,
      };
      const probe = await probeAccount(cred, endpoints);
      return NextResponse.json({ ok: true, probe, usedEndpoints: endpoints });
    }

    if (action === "cdp") {
      const status = await cdpStatus(account.cdpEndpoint);
      return NextResponse.json({ ok: true, cdp: status });
    }

    if (action === "inspect") {
      const dom = await inspectPage(account.cdpEndpoint);
      return NextResponse.json({ ok: true, dom });
    }

    return NextResponse.json({ error: `未知 action：${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "操作失败" }, { status: 500 });
  }
}
