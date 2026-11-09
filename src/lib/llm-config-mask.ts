/**
 * 密钥脱敏工具：GET 接口返回的 llmConfig.apiKey 必须打码，避免公开部署泄露作者密钥。
 * settings 路由与 projects 路由共用此实现（中间打码、只留末 4 位）。
 */

export function maskKey(key: string | null): string {
  if (!key || key.length <= 4) return key ? "****" : "";
  return "*".repeat(key.length - 4) + key.slice(-4);
}

/**
 * 把项目的 llmConfig（Json 列，可能含 apiKey 明文）脱敏。
 * - null / undefined / 非对象：原样返回（结构语义不变）。
 * - 含 apiKey：中间打码只留末 4 位，并附加 hasApiKey 便于前端判断「是否已配置」。
 * 纯函数，便于单测钉死行为。
 */
export function maskLlmConfig(
  config: unknown
): Record<string, unknown> | null {
  if (config == null) return null;
  if (typeof config !== "object") return config as Record<string, unknown>;
  const cfg = config as Record<string, unknown>;
  const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey : "";
  return {
    ...cfg,
    apiKey: apiKey ? maskKey(apiKey) : apiKey,
    hasApiKey: Boolean(apiKey),
  };
}
