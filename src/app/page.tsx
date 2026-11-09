import { getProjectsForHome, type ProjectSummary } from "@/lib/projects-service";
import HomeDashboard from "./home-dashboard";

// 首页 SSR：服务端预取项目列表并直出首屏，避免浏览器端二次请求（P1-2）。
// 取数失败时 initialProjects 留空，客户端按原逻辑自行 fetch（加载/错误 UI 不变），零回归风险。
export default async function HomePage() {
  let initialProjects: ProjectSummary[] | undefined;
  try {
    initialProjects = await getProjectsForHome();
  } catch {
    initialProjects = undefined;
  }
  return <HomeDashboard initialProjects={initialProjects} />;
}
