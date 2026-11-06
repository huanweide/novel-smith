// novel-smith 端到端自测：用户视角「创建 → 写 → 删 → 写」流程，跑到第5章
// 真实 HTTP 边界回放 UI 触发的全部操作（无需 LLM Key 即可跑：正文写入用 PUT 模拟用户手打/编辑器自动保存）。
// 用法：node scripts/agent-e2e-chapter-flow.cjs   （需先启动 dev server: npm run dev，默认 3001）
const BASE = "http://localhost:3001";

let pass = 0,
  fail = 0;
const lines = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    lines.push(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    lines.push(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}
// 取某分卷下的章节（按 order 升序）
function chaptersOf(tree, volumeId) {
  return (tree.storyNodes || [])
    .filter((n) => n.parentId === volumeId && n.type === "chapter")
    .sort((a, b) => a.order - b.order);
}
// 解析「第X章」序号：兼容阿拉伯数字与中文数字（一~十 / 十一~十九 / 二十~九十）
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function parseChapterNum(title) {
  if (!title) return null;
  let m = title.match(/^第([0-9]+)章/);
  if (m) return parseInt(m[1], 10);
  m = title.match(/^第([一二三四五六七八九十]+)章/);
  if (!m) return null;
  const s = m[1];
  if (s === "十") return 10;
  if (s.length === 1) return CN[s] || null;
  if (s.length === 2 && s[0] === "十") return 10 + (CN[s[1]] || 0);
  if (s.length === 2 && s[1] === "十") return (CN[s[0]] || 0) * 10;
  if (s.length === 3) return (CN[s[0]] || 0) * 10 + (CN[s[2]] || 0);
  return null;
}
const snapName = (s) => s.name || s.filename;

(async () => {
  console.log("\n=== novel-smith 端到端自测：创建→写→删→写（到第5章） ===");
  console.log(`BASE=${BASE}\n`);

  // 1) 创建项目（用户点「新建项目」）
  const pRes = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: `自测-${Date.now()}` }),
  });
  const projectId = pRes.body?.id;
  check("① 创建项目 → 201", pRes.status === 201 && !!projectId, `projectId=${projectId || ""}`);
  if (!projectId) return finish();

  // 2) 创建分卷（用户点「+ 添加分卷」）
  const vRes = await api("/api/story/nodes", {
    method: "POST",
    body: JSON.stringify({ projectId, type: "volume", title: "第一卷", order: 0 }),
  });
  const volumeId = vRes.body?.id;
  check("② 创建分卷 → 201", vRes.status === 201 && !!volumeId, `volumeId=${volumeId || ""}`);
  if (!volumeId) {
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    return finish();
  }

  // 3) 并行创建 5 章（用户视角「连续/批量建章」并发回放）
  console.log("• 并行创建 第1~5章 …");
  const created = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      api("/api/story/nodes", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          parentId: volumeId,
          type: "chapter",
          title: `第${i + 1}章`,
          order: i,
          status: "outline_only",
        }),
      })
    )
  );
  const chIds = created.map((r) => r.body?.id).filter(Boolean);
  check("③ 并行创建5章 全部201", created.every((r) => r.status === 201) && chIds.length === 5, `chIds=${chIds.length}`);

  // 3.1) 在 ch1 下建子场景，用于验证「删章级联」
  const sceneRes = await api("/api/story/nodes", {
    method: "POST",
    body: JSON.stringify({ projectId, parentId: chIds[0], type: "scene", title: "开篇场景", order: 0 }),
  });
  const sceneId = sceneRes.body?.id;
  check("③.1 ch1 下建子场景 → 201", sceneRes.status === 201 && !!sceneId, `sceneId=${sceneId || ""}`);

  // 4) 写（用户手打正文 → 编辑器自动保存调用 PUT）
  const content = "这是第1章的正文，约一百字。苏砚自万千灯火中苏醒，万象摹写之能于指尖流转，他知道自己再不是凡人。窗外风雪正紧，而他的故事才刚刚开始落笔。";
  const writeRes = await api(`/api/story/nodes/${chIds[0]}`, {
    method: "PUT",
    body: JSON.stringify({ content, title: "第1章" }),
  });
  check("④ 写 ch1 正文 → 200", writeRes.status === 200, `wordCount=${(writeRes.body || {}).wordCount}`);

  // 4.1) 验证正文真落库（再 GET 一次，模拟刷新页面）
  const reGet = await api(`/api/story/nodes/${chIds[0]}`);
  check("④.1 正文持久化（GET 回读一致）", (reGet.body?.content || "").includes("苏砚"), `len=${(reGet.body?.content || "").length}`);

  // 5) 删 ch1（用户点章节删除 → 软删+级联+重编号+删前快照）
  const beforeSnaps = (await api("/api/snapshots").catch(() => ({ body: {} }))).body?.snapshots || [];
  const beforeNames = new Set(beforeSnaps.map(snapName).filter(Boolean));
  const delRes = await api(`/api/story/nodes/${chIds[0]}`, { method: "DELETE" });
  check("⑤ 删除 ch1（级联+重编号） → 200", delRes.status === 200 && delRes.body?.softDeleted === true, JSON.stringify(delRes.body || {}));

  // 5.1) ch1 软删后正常 GET 应 404（防泄漏）
  const gone = await api(`/api/story/nodes/${chIds[0]}`);
  check("⑤.1 ch1 软删后 GET → 404", gone.status === 404, `status=${gone.status}`);

  // 5.2) 子场景被级联软删（子树收集）
  if (sceneId) {
    const sceneGone = await api(`/api/story/nodes/${sceneId}`);
    check("⑤.2 ch1 子场景级联软删 → 404", sceneGone.status === 404, `status=${sceneGone.status}`);
  }

  // 5.3) 删前自动生成快照（Task #1 集成）—— 取本次新增的快照
  const afterSnaps = (await api("/api/snapshots")).body?.snapshots || [];
  const newSnaps = afterSnaps.filter((s) => {
    const n = snapName(s);
    return n && !beforeNames.has(n);
  });
  check(
    "⑤.3 删前自动生成快照(pre-delete)",
    afterSnaps.length > beforeSnaps.length && newSnaps.some((s) => s.label === "pre-delete"),
    `新增=${newSnaps.length}`
  );

  // 5.4) 删除后整卷重编号：剩余 4 章应为连续 第1~4章（兼容中/阿数字）
  const treeAfterDel = (await api(`/api/projects/${projectId}`)).body;
  const afterDel = chaptersOf(treeAfterDel, volumeId);
  const numsDel = afterDel.map((c) => parseChapterNum(c.title));
  const renumberedOk = afterDel.length === 4 && numsDel.join(",") === "1,2,3,4";
  check("⑤.4 删后重编号：剩4章且连续 第1~4章", renumberedOk, afterDel.map((c) => c.title).join(" / "));

  // 6) 写（再建一章，模拟「删了又写」→ 整卷回到 第1~5章）
  const treeNow = (await api(`/api/projects/${projectId}`)).body;
  const curCount = chaptersOf(treeNow, volumeId).length; // 4
  const addRes = await api("/api/story/nodes", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      parentId: volumeId,
      type: "chapter",
      title: `第${curCount + 1}章`,
      order: curCount,
      status: "outline_only",
    }),
  });
  check("⑥ 再建一章 → 201", addRes.status === 201 && !!addRes.body?.id, `newChId=${(addRes.body || {}).id || ""}`);

  // 6.1) 最终态：整卷 5 章，序号严格为连续 第1~5章，无缺口无重复
  const treeFinal = (await api(`/api/projects/${projectId}`)).body;
  const finalCh = chaptersOf(treeFinal, volumeId);
  const numsFinal = finalCh.map((c) => parseChapterNum(c.title));
  const finalOk = finalCh.length === 5 && numsFinal.join(",") === "1,2,3,4,5";
  const ordersOk = finalCh.every((c, i) => c.order === i);
  check("⑥.1 最终整卷5章且连续 第1~5章", finalOk, finalCh.map((c) => c.title).join(" / "));
  check("⑥.2 章节 order 连续升序", ordersOk, finalCh.map((c) => c.order).join(","));

  // ── D1 判别测试：选中即改 的 selectedText 契约（环境无关）──
  // 判别目标：证明 selectedText 不是被 schema 拒绝的未知字段。做法：对比「带/不带 selectedText」
  // 两次请求的状态——若二者同态，则 selectedText 未造成差异化拒绝，契约接通。
  // 断言不绑定 Key 状态：无有效 Key 时二者同为 400 CONFIG；有真 Key 时二者同为 200（SSE）。
  // 早期版本把「必须 400 CONFIG」写死，接入真 Key 真机测试后该断言误报，已修正为环境无关。
  // 后端局部替换引擎由 targeted-fix.test.ts 单测覆盖。
  {
    const chId = chIds[1];
    const selContent = "苏砚站在城头，夜风卷起他的衣袂。";
    const w2 = await api(`/api/story/nodes/${chId}`, {
      method: "PUT",
      body: JSON.stringify({ content: selContent + "远处灯火如星，他握紧了手中的剑。", title: "第2章" }),
    });
    check("D1.0 给第2章写入正文 → 200", w2.status === 200);

    const without = await api("/api/generate/refine", {
      method: "POST",
      body: JSON.stringify({ projectId, nodeId: chId, instruction: "润色这段文字", targetWords: 200 }),
    });
    const withSel = await api("/api/generate/refine", {
      method: "POST",
      body: JSON.stringify({ projectId, nodeId: chId, instruction: "润色选中的这段文字", selectedText: selContent, targetWords: 200 }),
    });
    // 环境无关：带/不带 selectedText 必须同态；且都不能是「schema 拒绝」(400 非 CONFIG)
    // 或「路由缺失」(404)。有真 Key 时二者同为 200(SSE)，无 Key 时同为 400 CONFIG。
    const sameStatus = without.status === withSel.status;
    const noSchemaReject = (r) => !(r.status === 400 && r.body?.code !== "CONFIG") && r.status !== 404;
    const okContract = sameStatus && noSchemaReject(without) && noSchemaReject(withSel)
      && (without.status === 200 || (without.status === 400 && without.body?.code === "CONFIG"));
    check(
      "D1.1 selectedText 未被 schema 拒绝（带/不带同态，环境无关）",
      okContract,
      `without=${without.status}/${without.body?.code} with=${withSel.status}/${withSel.body?.code}`,
    );
  }

  // 7) 清理：仅删「本次测试新增」的快照 + 软删项目（移入回收站，不影响首页）
  for (const s of newSnaps) {
    const n = snapName(s);
    const dSnap = await api(`/api/snapshots/${n}`, { method: "DELETE" });
    check(`⑦ 清理测试快照 ${n} → 200`, dSnap.status === 200, ``);
  }
  const dProj = await api(`/api/projects/${projectId}`, { method: "DELETE" });
  check("⑦.1 清理测试项目（回收站） → 200", dProj.status === 200, `recycled=${(dProj.body || {}).recycled}`);

  finish();
})()
  .catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
  })
  .finally(() => {});

function finish() {
  console.log("\n--- 自测结果 ---");
  for (const l of lines) console.log(l);
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  console.log(fail === 0 ? "✅ 全部通过" : "❌ 存在失败项");
  process.exit(fail === 0 ? 0 : 1);
}
