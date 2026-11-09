/**
 * babylore 共享模型映射工具。
 *
 * 抽出原因：entity-sync.ts 需要调用 fillModelOf，而 fill.ts 又调用 entity-sync.ts 的
 * syncChapterEntities，形成「entity-sync ↔ fill」循环依赖。把纯函数 fillModelOf 下沉到本
 * 模块后，两边各自单向依赖 table-model，环被打破。
 */

/**
 * v1.2.0 实测修复：填表是纯抽取任务，推理模型（deepseek-v4-flash 等）会
 *  - 推理内容过长吃光 max_tokens → content 为空（ops=0）；
 *  - 或生成超长导致 res.json() 长时间挂起（响应体等待服务端生成完）。
 * 故填表统一用同厂商基础对话模型（deepseek-chat），快且输出稳定。
 * 非推理模型原样透传。
 *
 * v2.x 修复（实测抓出）：deepseek-chat 是 DeepSeek 官方 API 的模型 ID，
 * 仅当 baseURL 指向官方（api.deepseek.com）时才做该映射——
 * 默认 provider siliconflow 上没有 deepseek-chat，映射后必报
 * 「400 Model does not exist」，导致默认配置下自动填表 100% 失败。
 * 非 DeepSeek 官方端点一律原样透传（空响应兜底由调用方的 reasoning 提取负责）。
 */
export function fillModelOf(model: string, baseURL?: string): string {
  const m = (model || "").toLowerCase();
  const isOfficialDeepseek = !!baseURL && baseURL.toLowerCase().includes("api.deepseek.com");
  if (!isOfficialDeepseek) return model;
  if (m.includes("reasoner") || m.includes("thinking") || (m.includes("v4") && m.includes("flash"))) {
    return "deepseek-chat";
  }
  return model;
}
