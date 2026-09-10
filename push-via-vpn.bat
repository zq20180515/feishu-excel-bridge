@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  VPN 隧道代理 + git push 一键脚本
REM  作用：RocksVPN 走的是 WireGuard 全局网卡模式，没有本地代理端口，
REM        导致 git 无法走隧道（默认直连被墙拦）。
REM        本脚本起一个本地小代理，把流量绑定到隧道网卡，再让 git 走它。
REM ============================================================

set TUN_IP=192.168.133.2
set BRIDGE_PORT=7899
set PYEXE=C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe
set PROJ=C:\Users\Administrator\WorkBuddy\2026-09-10-16-46-36\feishu-excel-bridge

echo.
echo [1/4] 检查隧道网卡 %TUN_IP% 是否在线...
ping -n 1 -w 1000 %TUN_IP% >nul 2>&1
if errorlevel 1 (
    echo     [!] 隧道网卡没响应。请确认 VPN 软件已连接。
    echo         如果 VPN 重启后网卡 IP 变了，请重新探测后修改本脚本的 TUN_IP。
    pause
    exit /b 1
)
echo     [OK] 隧道网卡在线

echo.
echo [2/4] 启动本地隧道代理 127.0.0.1:%BRIDGE_PORT% ...
start "net-bridge" /min "%PYEXE%" "%PROJ%\test\net-bridge.py" %TUN_IP% %BRIDGE_PORT%
timeout /t 3 /nobreak >nul

netstat -ano | findstr ":%BRIDGE_PORT% " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
    echo     [!] 代理启动失败或端口被占用。换个端口重试。
    pause
    exit /b 1
)
echo     [OK] 代理已监听

echo.
echo [3/4] 验证能否经代理访问 GitHub ...
curl -s -o nul -w "    HTTP %%{http_code}  耗时 %%{time_total}s\n" -x http://127.0.0.1:%BRIDGE_PORT% https://github.com
if errorlevel 1 (
    echo     [!] 访问失败，检查 VPN 是否真的连上。
    pause
    exit /b 1
)

echo.
echo [4/4] 推送到 GitHub ...
cd /d "%PROJ%"
git push -u origin main

echo.
if errorlevel 1 (
    echo [X] push 失败。常见原因：
    echo     1) 没有 token —— 弹出登录框时，用户名填 zq20180515，密码粘贴 PAT
    echo     2) token 过期或权限不足 —— 重新生成，务必勾选 repo 权限
    echo     3) VPN 断开了
) else (
    echo [OK] push 成功！
    echo      接下来去 GitHub 仓库: Settings - Pages - Source 选 "GitHub Actions"
)

echo.
echo 提示：本窗口关掉后代理会一起关闭。push 完可以关。
pause
