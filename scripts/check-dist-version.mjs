/**
 * R6 兜底断言：打包产物版本号必须与 package.json 一致。
 *
 * 背景：electron-builder 用 artifactName `NovelSmith-${version}.${ext}` 自动注入版本，
 * 正常情况下不会漂移；但为防止「bump 版本号却忘改 package.json / 改错处」导致
 * 发布出一个文件名版本与实际不符的包，在 dist 末尾加一道外部判据门禁。
 *
 * 判据（Oracle Gate，纯文件检查，不靠自判）：
 *   1) release/ 下必须存在至少 1 个安装包（portable/setup/zip 其一即可）
 *   2) 每个安装包文件名必须包含 package.json.version
 *   3) 必须存在 latest.yml（electron-updater 的版本清单）
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
let version;
try {
  version = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version;
} catch (e) {
  console.error("[check-dist-version] 无法读取 package.json version：", e.message);
  process.exit(1);
}

const releaseDir = join(cwd, "release");
if (!existsSync(releaseDir)) {
  console.error(`[check-dist-version] release/ 目录不存在，dist 似乎未产出任何包（version=${version}）`);
  process.exit(1);
}

const files = readdirSync(releaseDir);
// 安装包：三种形态的产物文件名（不含 blockmap / yml / 符号链接）
const installers = files.filter((f) => /^NovelSmith-.*\.(exe|zip)$/i.test(f));
const latestYml = files.filter((f) => /^latest.*\.yml$/i.test(f));

const errors = [];
if (installers.length === 0) {
  errors.push(`未找到任何安装包（期望 NovelSmith-*.exe / NovelSmith-*.zip），release 内容：${files.join(", ")}`);
}
for (const f of installers) {
  if (!f.includes(version)) {
    errors.push(`安装包 "${f}" 文件名不含版本号 v${version}，可能版本漂移`);
  }
}
if (latestYml.length === 0) {
  errors.push("未生成 latest.yml（自动更新版本清单缺失）");
}

if (errors.length > 0) {
  console.error("[check-dist-version] FAIL（版本一致性断言未通过）：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log(
  `[check-dist-version] OK：version=v${version}，安装包 ${installers.length} 个均含版本号，latest.yml 已生成`,
);
console.log("  安装包：" + installers.join(", "));
process.exit(0);
