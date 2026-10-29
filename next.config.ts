import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 显式声明 Turbopack 根目录，避免在上层目录发现多余 lockfile 时误判 workspace root
  turbopack: {
    root: process.cwd(),
  },
  // 允许通过 127.0.0.1 访问 dev 资源（HMR/webpack-hmr）。
  // Next.js 16 默认仅允许 localhost，用 IP 访问会被 CORS 拦截导致客户端无法 hydrate。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // better-sqlite3 是原生模块，必须排除在打包之外、运行时直接 require，否则构建/启动会失败
  // 关键修复：@prisma/client 也必须显式列为外部包。
  // 现象：打包后的 server chunk 里，src/generated/prisma/client.ts（首方代码，被 Turbopack 打进 .next）
  //   内部 `import ... from "@prisma/client/runtime/client"` 被 Turbopack 标记成「合成哈希外部模块」
  //   （@prisma/client-<hash>/runtime/client），运行时 require 该哈希 id 直接找不到模块 → 所有 DB 路由 500，
  //   表现为「程序能开、但数据库全挂」。显式列入 serverExternalPackages 后，Turbopack 会按真实包名
  //   "@prisma/client/runtime/client" 解析，运行时从 node_modules 正常 require。
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/client",
  ],
};

export default nextConfig;
