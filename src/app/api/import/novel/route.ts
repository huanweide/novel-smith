/**
 * POST /api/import/novel
 *
 * 导入小说 → 落库为 StoryNode 链（Import Novel · M2）
 *
 * 两段式设计（对应 M1 定下的"先解析看清、再落库"）：
 *   mode=preview → 只解析，返回分章报告 + 健康度，不写库
 *   mode=commit  → 解析并落库
 *
 * 前端默认先 preview 给人看，确认无误再 commit——避免"导进去发现分章错了，
 * 要么重导一遍要么手动删几百个节点"。
 *
 * 文件走 multipart/form-data（浏览器 File 只能这么传），解析层已能吃 Buffer。
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-error";
import { badRequest } from "@/lib/validators";
import { parseToNovel } from "@/lib/import/parsers";
import { checkHealth } from "@/lib/import/types";
import { commitImport } from "@/lib/import/commit";

export const maxDuration = 300;

/** 单文件上限 50MB：够放几十万字的长篇，又不至于把内存打爆 */
const MAX_FILE = 50 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const projectId = String(form.get("projectId") ?? "");
    const mode = String(form.get("mode") ?? "preview");
    const encodingHint = form.get("encoding") ? String(form.get("encoding")) : undefined;
    const regexHint = form.get("regex") ? String(form.get("regex")) : undefined;

    if (!projectId) return badRequest("缺少 projectId", "projectId");

    if (!(file instanceof File)) {
      return badRequest("请选择要导入的小说文件（支持 txt / markdown / epub / docx）", "file");
    }
    if (file.size === 0) return badRequest("文件是空的", "file");
    if (file.size > MAX_FILE) {
      return badRequest(
        `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），单本导入上限 50MB`,
        "file",
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || "未命名";

    const novel = await parseToNovel(buf, {
      fileName,
      encoding: encodingHint,
      chapterRegex: regexHint,
      format: undefined,
    });

    if (novel.chapters.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "没能从这个文件里识别出任何章节",
          hint:
            "常见原因：① txt 是图片版（扫描件）需要 OCR；② 章节样式特殊，可点「手动指定章节正则」填规则；③ epub 内容在图片里。",
          warnings: novel.warnings,
          encoding: novel.encoding,
        },
        { status: 422 },
      );
    }

    const health = checkHealth(novel);

    // ─── preview：只报告，不写库 ───
    if (mode !== "commit") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        title: novel.title ?? fileName,
        encoding: novel.encoding,
        health,
        // 只回前 100 章预览，全书可能上千章，回全会撑爆响应
        chapters: novel.chapters.slice(0, 100).map((c) => ({
          index: c.index,
          title: c.title,
          wordCount: c.wordCount,
          preview: c.content.slice(0, 200),
          kind:
            health.frontMatter.includes(c.index)
              ? "frontmatter"
              : health.emptyNodes.includes(c.index)
                ? "volume"
                : "chapter",
        })),
        truncated: novel.chapters.length > 100,
        warnings: novel.warnings,
      });
    }

    // ─── commit：落库 ───
    const result = await commitImport({ projectId, novel, fileName });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.message, health: result.health },
        { status: 422 },
      );
    }

    return NextResponse.json({
      mode: "commit",
      ...result,
      // 续写锚点：阅读器「从此继续写」直接用它
      continueAnchorId: result.lastChapterNodeId,
    });
  } catch (err) {
    return jsonError(err);
  }
}

/** GET /api/import/novel?projectId=xxx —— 查看该项目已导入情况 */
export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return badRequest("缺少 projectId", "projectId");

    const nodes = await prisma.storyNode.findMany({
      where: { projectId, deletedAt: null, source: "imported" },
      select: { id: true, title: true, type: true, order: true, wordCount: true, importKind: true, importSourceKey: true },
      orderBy: { order: "asc" },
    });

    // 按来源指纹分组 = 按"导入了几本书"分组
    const groups = new Map<string, typeof nodes>();
    for (const n of nodes) {
      const k = n.importSourceKey ?? "unknown";
      const list = groups.get(k) ?? [];
      list.push(n);
      groups.set(k, list);
    }

    return NextResponse.json({
      ok: true,
      importedCount: nodes.length,
      sources: Array.from(groups.entries()).map(([key, list]) => ({
        sourceKey: key,
        nodeCount: list.length,
        totalWords: list.reduce((s, n) => s + n.wordCount, 0),
        chapters: list.filter((n) => n.type === "chapter" && n.wordCount > 0).length,
        firstTitle: list[0]?.title ?? "",
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}