@echo off
chcp 65001 >nul
REM 自动探测 WireGuard 隧道网卡 IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"WireGuard"') do echo %%a
