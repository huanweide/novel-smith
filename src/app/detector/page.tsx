import type { Metadata } from "next";
import { DetectorPanel } from "@/components/detector/DetectorPanel";

/**
 * /detector —— 零门槛「去 AI 味检测」
 *
 * 这是全站唯一一个**不需要 API Key、不需要数据库、不需要项目**就能用的页面：
 * 新用户 clone 完直接打开它，粘贴一段文字就能立刻得到价值，
 * 不必先去注册 LLM 平台、不必先建项目、不必先写章节。
 * 存在意义：把「价值验证」从 30 分钟压缩到 30 秒。
 */
export const metadata: Metadata = {
  title: "去 AI 味检测 · Novel Smith",
  description:
    "纯本地、不联网、不需要 API Key 的 AI 痕迹检测：粘贴一段文字，立刻看它有多像 AI 写的，稿件全程不出本机。",
};

export default function DetectorPage() {
  return (
    <main className="min-h-screen">
      <DetectorPanel />
    </main>
  );
}
