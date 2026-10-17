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
call npx next start -p %PORT% >> "%LOG%" 2>&1
echo [%date% %time%] 服务退出，退出码 %errorlevel%