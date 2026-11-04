/**
 * R6 兜底断言：打包产物版本号必须与 package.json 一致。
 *
 * 背景：electron-builder 用 artifactName `NovelSmith-${version}.${ext}` 自动注入版本，
 * 正常情况下不会漂移；但为防止「bump 版本号却忘改 package.json / 改错处」导致
 * 发布出一个文件名版本与实际不符的包，在 dist 末尾加一道外部判据门禁。
 *
 * 判据（Oracle Gate，纯文件检查，不靠自判）：
 *   1) release/ 下必须存在 nsis 安装包（-setup.exe）；只出安装版，
 *      因为 electron-updater 的 latest.yml 只服务安装版，便携版无法自动更新。
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
// 只认 nsis 安装包：portable / zip 没有固定安装目录，无法被 electron-updater 更新，
// 发布到 GitHub Releases 会让用户下到一份永远收不到自动更新的版本。
const installers = files.filter((f) => /^NovelSmith-.*-setup\.exe$/i.test(f));
const portableLeftovers = files.filter((f) => /^NovelSmith-.*(-portable\.exe|\.zip)$/i.test(f));
const latestYml = files.filter((f) => /^latest.*\.yml$/i.test(f));

const errors = [];
if (installers.length === 0) {
  errors.push(`未找到 nsis 安装包（期望 NovelSmith-<version>-setup.exe），release 内容：${files.join(", ")}`);
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
if (portableLeftovers.length > 0) {
  console.warn("[check-dist-version] 注意：release/ 里仍有便携版残留产物，禁止上传到 GitHub Releases：");
  console.warn("  " + portableLeftovers.join(", "));
}
process.exit(0);
