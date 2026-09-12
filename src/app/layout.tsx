import type { Metadata } from "next";
import "./globals.css";
import { SystemStatusBanner } from "@/components/system-status-banner";
import { ToastProvider } from "@/components/ui/toast";
import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutProvider } from "@/components/ShortcutProvider";

export const metadata: Metadata = {
  title: "Novel Smith — AI 小说工匠",
  description: "基于大语言模型的长篇小说智能写作系统",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Novel Smith",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#0B1322" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
/* 首屏前应用主题，避免闪烁（十档主题：夜航/苍青 + GitHub/德古拉/北境/东京夜/古旧 + 白昼/曜石/拿铁） */
(function(){
  try {
    var ALL = ['dark','light','azure','theme-github','theme-dracula','theme-nord','theme-tokyo','theme-gruvbox','theme-solarized','theme-catppuccin'];
    var LIGHT = { light: 1, 'theme-solarized': 1, 'theme-catppuccin': 1 };
    var d = document.documentElement;
    var t = localStorage.getItem('nf-theme') || 'dark';
    if (ALL.indexOf(t) < 0) t = 'dark';
    for (var i = 0; i < ALL.length; i++) d.classList.remove(ALL[i]);
    d.classList.add(t);
    d.classList.add(LIGHT[t] ? 'light' : 'dark');
  } catch(e){}
})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
/* 清除所有 Service Worker——Novel Smith 不需要离线缓存 */
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(regs){
    regs.forEach(function(r){ r.unregister(); });
  });
}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <noscript>
          <div style={{ padding: "1.5rem", textAlign: "center", color: "#F8F7F2", background: "#0E1424", fontFamily: "system-ui, sans-serif" }}>
            本应用需要启用 JavaScript 才能运行。请在现代浏览器中开启 JavaScript 后访问 Novel Smith。
          </div>
        </noscript>
        <SystemStatusBanner />
        <ToastProvider>
          <ShortcutProvider>{children}</ShortcutProvider>
        </ToastProvider>
        <CommandPalette />
      </body>
    </html>
  );
}
