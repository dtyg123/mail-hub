# 邮箱验证工作台 MailVault · 容器镜像
# 构建上下文为 SmsCodeWeb 根目录：
#   docker build -t mail-hub:2.0.0 .
# 依赖均为纯 JS（无原生编译），alpine 小镜像即可运行
FROM node:22-alpine

WORKDIR /app

# 先复制依赖清单安装（利用分层缓存，代码变动不重装依赖）
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund

# 再复制前后端代码
COPY server/ ./server/
COPY client/ ./client/

# 运行期配置（雨云模板中可用环境变量覆盖）
# DB_PATH / SEED_PATH 必须落在持久化卷 /data 内，容器重建后数据与加密种子才不会丢失
ENV NODE_ENV=production \
    PORT=80 \
    HOST=0.0.0.0 \
    DB_PATH=/data/codes.db \
    SEED_PATH=/data/seed.php

# 持久化卷：SQLite 数据库 + 加密种子 seed.php
VOLUME ["/data"]

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server/index.js"]
