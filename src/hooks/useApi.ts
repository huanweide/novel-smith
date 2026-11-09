"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 轻量服务端状态层（FE-9 试点）
 * ────────────────────────────────────────────────────────────
 * 自封装的 mini React-Query：进程内缓存 + staleTime + 失效订阅。
 * 不引入新依赖（避免 React Query / SWR 的体积与心智负担），为 70+ API 的
 * 缓存/失效迁移提供统一原语；先在新页面试点，再逐步迁移。
 */

type Entry = { data: unknown; ts: number };

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

/** 失效单个 query key（下次访问重新拉取） */
export function invalidateQuery(key: string): void {
  cache.delete(key);
  listeners.get(key)?.forEach((cb) => cb());
}

/** 按前缀批量失效（如 `invalidateQueries("projects")` 清掉所有 projects:* 缓存） */
export function invalidateQueries(prefix: string): void {
  for (const k of Array.from(cache.keys())) {
    if (k === prefix || k.startsWith(prefix + ":")) cache.delete(k);
  }
  for (const k of Array.from(listeners.keys())) {
    if (k === prefix || k.startsWith(prefix + ":")) listeners.get(k)?.forEach((cb) => cb());
  }
}

export interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * 订阅式查询 hook。
 * @param key      缓存 key（同名即共享缓存）
 * @param fetcher  返回 Promise<T> 的取数函数
 * @param opts     enabled 默认 true；staleTime 默认 30s（ms）
 */
export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { enabled?: boolean; staleTime?: number; initialData?: T } = {}
): QueryResult<T> {
  const initialDataRef = useRef(opts.initialData);
  initialDataRef.current = opts.initialData;

  // 首屏直接用服务端注入的初始数据（SSR 注水），避免客户端二次请求；
  // 同时让客户端首渲染与服务端 HTML 一致，杜绝 hydration mismatch。
  const [data, setData] = useState<T | undefined>(() =>
    (cache.get(key)?.data as T | undefined) ?? (initialDataRef.current as T | undefined)
  );
  const [loading, setLoading] = useState<boolean>(
    () => !cache.has(key) && initialDataRef.current === undefined
  );
  const [error, setError] = useState<unknown>(null);
  const staleTime = opts.staleTime ?? 30_000;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < staleTime) {
      setData(cached.data as T);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const d = await fetcherRef.current();
      cache.set(key, { data: d, ts: Date.now() });
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [key, staleTime]);

  useEffect(() => {
    if (opts.enabled === false) return;
    // 服务端注水：把初始数据写入缓存，使后续 load 命中缓存、不再发请求（仅缓存为空时注入）
    if (initialDataRef.current !== undefined && !cache.has(key)) {
      cache.set(key, { data: initialDataRef.current, ts: Date.now() });
      setData(initialDataRef.current);
      setLoading(false);
    }
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(load);
    load();
    return () => {
      listeners.get(key)?.delete(load);
    };
  }, [key, load, opts.enabled, initialDataRef]);

  return { data, loading, error, refetch: load };
}
