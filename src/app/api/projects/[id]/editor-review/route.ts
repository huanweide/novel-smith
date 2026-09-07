/**
 * 模拟编辑审稿 —— 调用本地 LLM 扮演番茄/起点/晋江/公众号编辑或爽文读者做一审
 *
 * 返回结构化修改建议（维度评分 + 具体修改位置 + 给微调 AI 的改写指令 + 一键复制文本）。
 * 提示词（systemPrompt）由前端传来自定义/可编辑，后端只负责按范围取章节并调用 LLM。
 *
 * 请求体：{ platform, role, systemPrompt, scope: { mode: "all"|"recent"|"single", count?, nodeId? } }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runEditorReview, type ReviewChapterInput } from "@/core/editor/review";

const SCOPE_PLATFORMS = ["fanqie", "qidian", "jjwxc", "wechat", "general"];

/** 单章送审字数上限 + 总预算，避免超长书把 prompt 撑爆 */
const PER_CHAPTER_CAP = 6000;
const TOTAL_BUDGET = 40000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let platform = "general";
  let role = "fanqie";
  let systemPrompt = "";
  let scope: { mode?: string; count?: number; nodeId?: string } = { mode: "recent", count: 5 };
  try {
    const body = (await request.json()) as {
      platform?: unknown;
      role?: unknown;
      systemPrompt?: unknown;
      scope?: unknown;
    };
    if (typeof body?.platform === "string" && SCOPE_PLATFORMS.includes(body.platform)) platform = body.platform;
    if (typeof body?.role === "string") role = body.role;
    if (typeof body?.systemPrompt === "string") systemPrompt = body.systemPrompt;
    if (body?.scope && typeof body.scope === "object") scope = body.scope as typeof scope;
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!systemPrompt || !systemPrompt.trim()) {
    return NextResponse.json({ error: "提示词为空，请先选择或填写审稿角色提示词" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // ── 按范围选章节 ──
  let where: { projectId: string; deletedAt: null; content?: { not: null } } = { projectId: id, deletedAt: null };
  if (scope.mode === "single" && typeof scope.nodeId === "string") {
    where = { ...where, content: { not: null } } as typeof where;
    const single = await prisma.storyNode.findFirst({
      where: { projectId: id, id: scope.nodeId, deletedAt: null },
      select: { id: true, order: true, title: true, content: true },
    });
    if (!single || !single.content?.trim()) {
      return NextResponse.json({ error: "该章节无正文，无法审稿" }, { status: 422 });
    }
    const chapters = [single];
    return runAndRespond(chapters, platform, role, systemPrompt);
  }

  const all = await prisma.storyNode.findMany({
    where: { projectId: id, deletedAt: null },
    select: { id: true, order: true, title: true, content: true },
    orderBy: { order: "asc" },
  });
  const withContent = (all || []).filter((n) => (n.content || "").trim());

  let selected = withContent;
  if (scope.mode === "recent") {
    const count = Math.max(1, Math.min(20, Number(scope.count) || 5));
    selected = withContent.slice(-count);
  }
  // all 模式：按总预算裁剪（优先保留较新的章节）
  if (scope.mode === "all") {
    let budget = 0;
    const kept: typeof withContent = [];
    for (let i = withContent.length - 1; i >= 0; i--) {
      const len = Math.min(withContent[i].content!.length, PER_CHAPTER_CAP);
      if (budget + len > TOTAL_BUDGET) break;
      budget += len;
      kept.unshift(withContent[i]);
    }
    selected = kept;
  }

  if (selected.length === 0) {
    return NextResponse.json({ error: "项目里没有带正文的章节，无法审稿" }, { status: 422 });
  }

  return runAndRespond(selected, platform, role, systemPrompt);
}

async function runAndRespond(
  nodes: { id: string; order: number; title: string; content: string | null }[],
  platform: string,
  role: string,
  systemPrompt: string,
) {
  const chapters: ReviewChapterInput[] = nodes.map((n, i) => ({
    ref: `章${i + 1}`,
    nodeId: n.id,
    title: n.title,
    content: (n.content || "").slice(0, PER_CHAPTER_CAP),
  }));

  try {
    const result = await runEditorReview({ chapters, roleId: role, systemPrompt });
    return NextResponse.json({
      ...result,
      meta: { platform, role, reviewedChapters: chapters.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `审稿失败：${msg}` }, { status: 502 });
  }
}
