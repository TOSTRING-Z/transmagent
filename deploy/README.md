# TransMAgent Workflow Viewer — 部署指南

## 环境要求

- **Node.js** >= 18.x
- **npm** >= 9.x

## 快速开始

### 1. 安装依赖

```bash
cd transmagent-deploy
npm install
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env，修改以下配置：
#   SESSION_SECRET — 会话加密密钥（必改，使用随机字符串）
#   ADMIN_PASSWORD — 管理员登录密码（可选，不设置则自动生成随机密码）
#   PORT           — 服务端口，默认 3006
```

### 3. 启动服务

```bash
# 生产模式（推荐）
NODE_ENV=production node server/index.js

# 或者使用 npm script
npm start
```

### 4. 访问

| 地址 | 说明 |
|------|------|
| `http://<服务器IP>:3006/` | 公开查看页面 |
| `http://<服务器IP>:3006/admin/login` | 管理后台登录 |

## 目录结构

```
transmagent-deploy/
├── server/              # 后端服务（已编译）
│   ├── index.js         # 入口文件
│   ├── routes/          # API 路由
│   ├── db/              # 数据存储（JSON 文件）
│   ├── extraction/      # 步骤提取引擎
│   └── middleware/      # 认证中间件
├── public/              # 前端静态文件
│   ├── index.html       # 查看器页面
│   ├── assets/          # 查看器资源
│   └── admin/           # 管理后台
│       ├── index.html
│       └── assets/
├── data/                # 运行时数据（自动创建）
│   ├── runs.json        # 运行记录存储
│   ├── admins.json      # 管理员账号
│   └── config.json      # 系统配置
├── package.json
├── .env.example
└── README.md
```

## 使用说明

### 上传运行记录

1. 登录管理后台 `/admin/login`
2. 点击「+ 上传」按钮
3. 选择 TransMAgent 执行日志 JSON 文件
4. 上传后自动提取步骤并分类，跳转到编辑页面
5. 在编辑器中调整步骤内容、类型、顺序
6. 点击「发布」使记录在公开页面可见

### JSON 文件格式要求

上传的 JSON 文件需包含以下字段：

```json
{
  "messages": [
    { "role": "assistant", "content": "...", "tool_calls": [...] },
    { "role": "tool", "content": "...", "name": "..." },
    { "role": "user", "content": "..." }
  ],
  "chat": {
    "id": "chat-xxx",
    "name": "运行标题",
    "agentMode": "transagent",
    "mode": "interactive",
    "seconds": 120,
    "tokens": 50000
  }
}
```

### 数据备份

所有数据存储在 `data/` 目录下的 JSON 文件中：

```bash
# 备份数据
cp -r data/ data-backup-$(date +%Y%m%d)/

# 恢复数据
cp -r data-backup-20260101/* data/
```

### 修改管理员密码

如需重置密码，删除 `data/admins.json` 并重启服务，系统会自动创建新管理员账号。

```bash
rm data/admins.json
# 重启服务
# 如果设置了 ADMIN_PASSWORD 环境变量，新密码即为该值
# 否则会生成随机密码并打印在控制台
```

## 生产部署建议

### 使用 PM2 守护进程

```bash
npm install -g pm2
pm2 start server/index.js --name transmagent --node-args="--env-file .env"
pm2 save
pm2 startup
```

### 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 使用 systemd 服务

```ini
# /etc/systemd/system/transmagent.service
[Unit]
Description=TransMAgent Workflow Viewer
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/transmagent-deploy
Environment=NODE_ENV=production
Environment=PORT=3006
ExecStart=/usr/bin/node server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now transmagent
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 端口被占用 | 修改 `.env` 中的 `PORT` 或 `kill` 占用进程 |
| 无法登录 | 检查 `data/admins.json` 是否存在，或删除后重启 |
| 上传失败 | 检查 JSON 文件格式是否正确，文件大小需 < 50MB |
| 页面空白 | 确认 `NODE_ENV=production`，否则静态文件不会加载 |
