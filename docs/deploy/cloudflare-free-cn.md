# Cloudflare 免费层个人部署

本指南将 SubBoost 管理端部署为 Cloudflare Worker，并使用 Neon PostgreSQL 保存数据。管理页面通过应用密码和签名会话 Cookie 保护；公开订阅由独立的配置 Worker 从 KV 返回预生成 YAML。GitHub Actions 每 6 小时刷新到期订阅，每天刷新规则索引。

适用于个人使用和单个配置少于约 300 个节点的场景。Cloudflare、Neon、GitHub 的免费额度可能调整，部署前请在各自控制台核对当前额度。

Cloudflare 当前 Workers Free 额度包括每天 100,000 次请求、每次请求 10 ms CPU 和每个 Worker 64 MiB 代码体积。配置 Worker 只读取 KV、解密并校验摘要；管理端导入、搜索等 API 的 CPU 使用量需在部署后通过 Cloudflare Analytics 查看。

## 1. 准备仓库和数据库

1. 将 SubBoost 仓库 Fork 到自己的 GitHub 账号，后续从该仓库部署。
2. 在 Neon 创建 PostgreSQL 项目，复制直连连接串，保留其中的 `sslmode=require` 参数。这个地址用于 GitHub Actions 迁移和更新数据库。
3. 在 Cloudflare 的 **Storage & Databases → Hyperdrive** 创建配置，把 Neon 连接串设为来源数据库地址，记下 Hyperdrive ID。
4. 在 Cloudflare **Workers & Pages → KV** 创建两个 namespace，分别用于配置快照和规则索引，记下各自的 ID。
5. 在 Cloudflare 账户启用 `workers.dev` 子域名。部署脚本会从 Cloudflare API 读取该子域名来生成公开订阅地址。

数据库迁移、owner 初始化和周期更新由 GitHub Actions 通过 Neon 直连地址执行。管理 Worker 运行时通过 Hyperdrive 访问同一数据库。

## 2. 设置管理端密码

管理 Worker 名称固定为 `subboost-management`，配置 Worker 名称为 `subboost-config`。为 `APP_PASSWORD` 选择一个唯一且至少 12 个字符的密码，建议使用 16 个以上字符，并把它保存到 GitHub Actions Secret。工作流会把密码写入管理 Worker 的运行时 Secret。登录后使用 HttpOnly、Secure Cookie；密码变更并重新部署后，旧会话会失效。

这套方案不需要配置 Cloudflare Zero Trust 或 Access 应用。`preview_urls` 已在配置中关闭。`subboost-config.<账户子域名>.workers.dev` 保持公开，客户端通过随机订阅 token 获取 YAML。

## 3. 配置 GitHub Actions

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加以下 Repository secrets：

| Secret | 内容 |
| --- | --- |
| `NEON_DATABASE_URL` | Neon PostgreSQL 直连地址，带 `sslmode=require` |
| `ENCRYPTION_KEY` | 随机生成的加密密钥；后续更新必须继续使用同一个值 |
| `APP_PASSWORD` | 管理页面密码，至少 12 个字符；推荐使用 16 个以上字符 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `HYPERDRIVE_ID` | Hyperdrive 配置 ID |
| `CONFIG_KV_NAMESPACE_ID` | 配置快照 KV namespace ID |
| `RULES_KV_NAMESPACE_ID` | 规则索引 KV namespace ID |

加密密钥可在本机用 OpenSSL 生成：

```sh
openssl rand -hex 32
```

Cloudflare API Token 建议限定在目标账户，并授予 `Workers Scripts: Edit`、`Workers KV Storage: Edit` 和 `Account Settings: Read`。本项目使用 `workers.dev`，不需要 Zone 权限。工作流不会读取或打印 Neon 连接串、加密密钥、管理密码和 API Token。

可选地，在 **Variables** 增加 `SUBSCRIPTION_WORKER_URL`，值为 `https://subboost-config.<账户子域名>.workers.dev`。没有设置时，部署脚本会从 Cloudflare API 自动读取账户子域名并组合 URL。

## 4. 首次部署

1. 确认仓库默认分支为 `main`，并已配置上述 Secrets。
2. 打开 GitHub 仓库 **Actions → Deploy to Cloudflare → Run workflow**。
3. 工作流会依次执行数据库迁移、创建固定 owner、部署公开配置 Worker、构建和部署管理 Worker、写入 Worker 加密密钥、回填配置快照和刷新规则索引。
4. 部署完成后访问 `https://subboost-management.<账户子域名>.workers.dev`，输入 `APP_PASSWORD` 进入管理页面。

推送到 `main` 会再次部署。订阅更新工作流每 6 小时运行一次，单条订阅默认至少 12 小时更新一次；规则索引每天刷新。GitHub Actions 的定时任务由默认分支运行。

## 5. 订阅地址和数据维护

- 保存订阅时，浏览器解析节点并生成 YAML；管理 Worker 加密后保存到 Neon 和 `CONFIG_KV`。
- 修改管理密码时，更新 GitHub Secret `APP_PASSWORD` 并重新运行部署工作流；部署完成后旧会话立即失效。
- 配置 Worker 不访问 Neon。它读取 KV 快照、解密 YAML、核验 SHA-256 后返回订阅内容。
- 订阅链接形如 `https://subboost-config.<账户子域名>.workers.dev/subscriptions/<随机token>/config.yaml`。请像密码一样保管该链接。
- 删除订阅时会删除对应 KV 项。Cloudflare KV 全球传播可能需要约 60 秒，旧链接在传播完成前可能仍可用。
- 自动更新失败会保留此前可用的 YAML。Actions 后续运行会重试同步数据库和 KV 快照。
- 如需迁移已有数据，先把原 PostgreSQL 数据和同一 `ENCRYPTION_KEY` 一并迁到 Neon，再运行部署工作流完成迁移和快照回填。新建空数据库时无需迁移旧数据。

这套结构不需要自有服务器。GitHub Actions 负责定时任务；Worker、KV、Hyperdrive 和 Neon 提供应用运行及数据库访问。

参考：[Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[Hyperdrive](https://developers.cloudflare.com/hyperdrive/)。
