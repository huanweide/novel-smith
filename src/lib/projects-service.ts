import { prisma } from "@/lib/prisma";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  genre: string[];
  targetWordCount: number;
  synopsis: string;
  toneKeywords: string[];
  updatedAt: string;
  _count: {
    characters: number;
    lorebookEntries: number;
    storyNodes: number;
  };
}

/**
 * 服务端取数：首页项目列表（与 GET /api/projects 返回的形状完全一致）。
 * 抽出来让「首页 SSR 预取」和「客户端接口」共用同一份取数逻辑，避免漂移。
 * updatedAt 统一转 ISO 字符串，与 /api/projects 的 JSON 形状保持一致（prisma 返回 Date，JSON 序列化后也是 ISO 串）。
 *
 * 仅可在服务端调用（route handler / Server Component）——内部依赖 prisma（better-sqlite3 原生模块）。
 */
export async function getProjectsForHome(): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          characters: true,
          lorebookEntries: true,
          storyNodes: true,
        },
      },
    },
  });
  return projects.map((p) => ({
    ...p,
    updatedAt:
      p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
  })) as ProjectSummary[];
}
