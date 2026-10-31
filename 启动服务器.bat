@echo off
chcp 65001 >nul
cd /d "%~dp0server"
echo 正在启动 邮箱验证工作台 MailVault...
node index.js
pause
