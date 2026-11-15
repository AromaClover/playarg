# PlayARG

一个现代化的算法竞赛平台，基于 Vercel Serverless Functions + Upstash Redis 构建。

## 功能特性

- **用户系统**：注册、登录、个人主页、头像上传、编辑资料
- **题库系统**：题目列表、题目详情、搜索筛选、难度分级
- **提交系统**：代码提交、提交记录、状态追踪
- **比赛系统**：比赛列表、比赛详情、排行榜、报名参赛
- **讨论社区**：讨论版、帖子回复、标签分类、置顶功能
- **动态社区**：犇犇/动态发布、时间线
- **管理后台**：用户管理、题目管理、比赛审核、公告管理、内容审核
- **消息通知**：站内信、系统通知
- **深色主题**：赛博朋克风格深色 UI

## 技术栈

- **前端**：原生 HTML + Tailwind CSS v4 + Lucide Icons
- **后端**：Vercel Serverless Functions (Node.js)
- **数据库**：Upstash Redis
- **部署**：Vercel

## 项目结构

```
playarg-vercel-deploy/
├── public/              # 静态页面
│   ├── index.html       # 首页
│   ├── problems.html    # 题库
│   ├── problem-detail.html
│   ├── contests.html    # 比赛列表
│   ├── contest-detail.html
│   ├── contest-create.html
│   ├── contest-problems.html
│   ├── submissions.html # 提交记录
│   ├── user-profile.html # 个人主页
│   ├── discussion.html  # 讨论列表
│   ├── discussion-detail.html
│   ├── announcement.html # 公告
│   ├── admin.html       # 管理后台
│   ├── messages.html    # 消息
│   ├── notifications.html
│   ├── rules.html
│   ├── sponsors.html
│   ├── auth.js          # 前端认证模块
│   └── assets/          # 静态资源
├── api/                 # Serverless Functions
│   ├── _auth.js         # 认证中间件
│   ├── _redis.js        # Redis 数据层
│   ├── register.js      # 注册
│   ├── login.js         # 登录
│   ├── logout.js        # 登出
│   ├── me.js            # 当前用户
│   ├── user.js          # 用户资料
│   ├── admin.js         # 管理接口
│   ├── data.js          # 通用数据接口
│   ├── submissions.js   # 提交记录
│   ├── submit.js        # 代码提交
│   ├── contests.js      # 比赛
│   ├── contest-leaderboard.js
│   ├── avatar.js        # 头像上传
│   └── ...
├── vercel.json          # Vercel 配置
├── package.json
└── README.md
```

## 本地开发

### 前置要求

- Node.js 24+
- Vercel CLI

### 安装依赖

```bash
npm install
```

### 环境变量

在项目根目录创建 `.env` 文件：

```env
UPSTASH_REDIS_REST_URL=your_upstash_redis_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
ADMIN_SECRET=admin_secret_for_registering_admins
```

### 本地运行

```bash
npx vercel dev
```

访问 `http://localhost:3000` 查看效果。

## 部署到 Vercel

### 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/AromaClover/playarg)

### 手动部署

1. Fork 本仓库
2. 在 Vercel 中导入项目
3. 配置环境变量（`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`）
4. 点击 Deploy

## API 接口

所有接口返回格式：`{ ok: boolean, data?: any, error?: string }`

### 认证相关

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/register` | 用户注册 |
| POST | `/api/login` | 用户登录 |
| POST | `/api/logout` | 用户登出 |
| GET | `/api/me` | 获取当前用户 |
| POST | `/api/me` | 更新当前用户资料 |
| GET | `/api/user?uid=` | 获取用户资料 |

### 内容相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/problems` | 题目列表 |
| GET | `/api/announcements` | 公告列表 |
| GET | `/api/contests` | 比赛列表 |
| GET | `/api/submissions` | 提交记录 |
| GET | `/api/discussions` | 讨论列表 |
| GET | `/api/feed` | 动态列表 |

### 管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/set-role` | 设置用户角色 |
| POST | `/api/admin/set-status` | 封禁/解封用户 |
| POST | `/api/admin/delete-user` | 删除用户 |
| POST | `/api/admin/problems` | 题目管理 |
| POST | `/api/admin/announcements` | 公告管理 |
| POST | `/api/admin/contests` | 比赛审核 |
| POST | `/api/admin/fix-uids` | 修复重复 UID |

## 管理员账号

使用管理员密钥注册的账号自动获得管理员权限：

```bash
curl -X POST https://your-domain/api/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","email":"admin@example.com","password":"your_password","adminSecret":"your_admin_secret"}'
```

## 许可证

MIT License
