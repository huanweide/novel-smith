@echo off
REM ============================================================
REM start-novel-server.cmd —— Novel Smith 3001 服务启动器
REM
REM 为什么需要这个文件：
REM   1. schtasks 的 /TR 有 261 字符上限，装不下带 cd / 日志重定向的完整命令；
REM   2. 计划任务默认工作目录不是仓库根，next 找不到 next.config.ts / .next；
REM      必须在命令里显式 cd /d 到仓库根；
REM   3. 输出要落 server.log，否则任务失败时无处查因（Last Result 只有一个退出码）。
REM
REM ★ 本文件必须是 CRLF 行尾 ——
REM   cmd.exe 直接不执行 LF-only 的批处理文件且不报错，表现是任务 /Run 返回
REM   成功但「上次结果 255」、运行时间不更新、server.log 一行都不写。
REM   仓库根 .gitattributes 已加 `*.cmd text eol=crlf` 兜底。
REM
REM ★ 为什么用 start 分离 ——
REM   计划任务必须用**用户身份**跑（ONSTART + SYSTEM 跑不了 Prisma：
REM   ERR_DLOPEN_FAILED，SYSTEM 加载不了 better-sqlite3 原生模块）。
REM   但用户身份的 ONLOGON 任务，父控制台收到 Ctrl+C 时会连坐杀掉子进程
REM   （上次结果 -2147023829 = 0x8007042B PROCESS_ABORTED，日志末尾一个 ^C）。
REM
REM   ⚠️ 必须用 start（开新窗口）而不是 start /b：
REM      /b 不真正脱离进程树，cmd 退出时 next 被连带结束 ——
REM      表现是日志里有 Ready 但端口根本不监听。
REM      开新窗口后 next 有自己的控制台，Ctrl+C 只打到本 cmd.exe。
REM
REM 用法：双击运行，或由计划任务 NovelSmith-3001 调用
REM ============================================================

setlocal

set "REPO=C:\Users\Administrator\Projects\novel-smith"
set "PORT=3001"
set "LOG=%REPO%\server.log"

REM 端口已被占用说明服务还活着，别重复拉（会撞 EADDRINUSE）
netstat -ano | findstr /R /C:"LISTENING.*:%PORT% " >nul 2>&1
if %errorlevel%==0 (
    echo [%date% %time%] 端口 %PORT% 已有服务在跑，跳过启动。
    exit /b 0
)

cd /d "%REPO%"
echo [%date% %time%] 启动 Novel Smith，端口 %PORT%，工作目录 %REPO%

REM 开新窗口（不是 /b）让 next 彻底脱离本 cmd.exe 的进程树
start "NovelSmith-3001" cmd /c "cd /d ""%REPO%"" && npx next start -p %PORT% >> ""%LOG%"" 2>&1"

REM 给它起来的时间，确认成功再退出
for /l %%i in (1,1,12) do (
    timeout /t 2 /nobreak >nul
    netstat -ano | findstr /R /C:"LISTENING.*:%PORT% " >nul 2>&1
    if not errorlevel 1 (
        echo [%date% %time%] 服务已就绪，端口 %PORT%
        exit /b 0
    )
)

echo [%date% %time%] 警告：24 秒内端口 %PORT% 未就绪，请查 %LOG%
exit /b 1