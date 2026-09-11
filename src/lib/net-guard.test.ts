import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_MESSAGE,
  clientAddress,
  isManagedHosting,
  isPrivateAddress,
  normalizeAddress,
  shouldBlock,
} from "./net-guard";

describe("isPrivateAddress —— 本机与内网放行", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "10.0.0.7",
    "192.168.1.5",
    "169.254.33.7",
    "172.16.0.1",
    "172.31.255.254",
    "my-macbook.local",
  ])("放行 %s", (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  it.each(["8.8.8.8", "1.2.3.4", "172.32.0.1", "172.15.0.1", "203.0.113.9", "example.com"])(
    "拦截 %s",
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(false);
    }
  );

  // 回归：next start 塞进 x-forwarded-for 的是 ::ffff:127.0.0.1，
  // 少了归一化就会把本机自己拦在门外（v3.1.115 实测踩到）
  it.each(["::ffff:127.0.0.1", "::ffff:192.168.1.5", "::ffff:10.0.0.3"])(
    "放行 IPv4 映射地址 %s",
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(true);
    }
  );

  it("IPv4 映射地址不会把公网 IP 误判成内网", () => {
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("IPv6 链路本地与唯一本地地址放行", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
  });

  it("空地址与脏数据一律当作不安全，不做放行猜测", () => {
    expect(isPrivateAddress("")).toBe(false);
    expect(isPrivateAddress("   ")).toBe(false);
  });

  it("IPv6 字面量带方括号也能识别", () => {
    expect(isPrivateAddress("[::1]")).toBe(true);
  });

  it("大小写与首尾空格不影响判定", () => {
    expect(isPrivateAddress("  LOCALHOST  ")).toBe(true);
    expect(isPrivateAddress("192.168.0.1\n")).toBe(true);
  });
});

describe("clientAddress —— 取真实来源", () => {
  it("优先采信 x-forwarded-for 的第一个地址（后面是代理链，不可信）", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.1, 10.0.0.1, 192.168.0.1" });
    expect(clientAddress(h)).toBe("203.0.113.1");
  });

  it("没有 xff 时退回 x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(clientAddress(h)).toBe("198.51.100.7");
  });

  it("只有 Host 时去掉端口", () => {
    expect(clientAddress(new Headers({ host: "192.168.1.5:3001" }))).toBe("192.168.1.5");
    expect(clientAddress(new Headers({ host: "localhost:3001" }))).toBe("localhost");
  });

  it("IPv6 的 Host 取方括号内的字面量，不被冒号切碎", () => {
    expect(clientAddress(new Headers({ host: "[::1]:3001" }))).toBe("::1");
  });

  it("xff 为空字符串时不吞掉后面的 x-real-ip", () => {
    const h = new Headers({ "x-forwarded-for": "   ", "x-real-ip": "10.9.8.7" });
    expect(clientAddress(h)).toBe("10.9.8.7");
  });
});

describe("normalizeAddress", () => {
  it("IPv4 映射地址还原成 IPv4", () => {
    expect(normalizeAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("普通地址原样返回，不搞意外改写", () => {
    expect(normalizeAddress("192.168.1.5")).toBe("192.168.1.5");
    expect(normalizeAddress("[::1]")).toBe("::1");
  });

  it("像 IPv4 映射但不是合法四段的不还原（防止乱拼绕过）", () => {
    expect(normalizeAddress("::ffff:999.1.1.1.1")).toBe("::ffff:999.1.1.1.1");
  });
});

describe("shouldBlock —— 开关语义", () => {
  it("默认放行局域网，拦公网", () => {
    expect(shouldBlock("192.168.1.5", false)).toBe(false);
    expect(shouldBlock("8.8.8.8", false)).toBe(true);
  });

  it("ALLOW_PUBLIC 打开后公网也放行（作者自行承担风险）", () => {
    expect(shouldBlock("8.8.8.8", true)).toBe(false);
  });

  it("开关关闭时，哪怕来源为空也拦下（不猜、不默认信任）", () => {
    expect(shouldBlock("", false)).toBe(true);
  });
});

describe("isManagedHosting —— 托管平台不做拦截", () => {
  it("Vercel 上视为作者主动公开，放行（否则公开演示会满屏 403）", () => {
    expect(isManagedHosting({ VERCEL: "1" })).toBe(true);
  });

  it("自托管环境（无 VERCEL 变量）照常受保护", () => {
    expect(isManagedHosting({})).toBe(false);
    expect(isManagedHosting({ VERCEL: "" })).toBe(false);
  });
});

describe("被拦下的提示文案", () => {
  it("必须说清「为什么」和「怎么解除」，不能只丢一个 403", () => {
    expect(FORBIDDEN_MESSAGE).toContain("本地单机工具");
    expect(FORBIDDEN_MESSAGE).toContain("ALLOW_PUBLIC=true");
  });
});
