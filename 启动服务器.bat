@echo off
chcp 65001 >nul
cd /d "%~dp0server"
echo 正在启动 邮箱聚合中心...
node index.js
pause
