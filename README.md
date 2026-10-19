# Aurora · AI 对话助手

基于 FastAPI 和原生 HTML / CSS / JavaScript 的本地 AI 聊天应用。后端使用 Anthropic Python SDK，可连接支持 Anthropic Messages 协议的模型服务。

## 当前功能

- 多轮对话、新建与管理会话，聊天记录保存在当前浏览器 localStorage。
- Markdown 渲染、代码块复制，使用 DOMPurify 净化输出。
- 重新生成回复、停止等待、发送失败回滚。
- 深浅主题、移动端侧栏和键盘快捷键。
- 后端请求校验、超时及常见上游错误处理。
- 本地静态资源、健康检查 API 和 Windows 启动脚本。

## 快速开始

需要 Python 3.11+ 与 uv。克隆仓库后执行：

```bash
uv sync --frozen
```

复制 `.env.example` 为 `.env`（PowerShell：`Copy-Item .env.example .env`；macOS/Linux：`cp .env.example .env`），然后在本机编辑 `.env`：

```dotenv
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_BASE_URL=https://your-provider.example
ANTHROPIC_MODEL=your-model-id
ANTHROPIC_MAX_TOKENS=4096
REQUEST_TIMEOUT_SECONDS=180
```

接口地址、模型名与密钥必须来自同一服务商。当前代码使用 Anthropic Messages 协议；接入 DeepSeek 时，需使用支持该协议的服务地址，不能直接将仅支持其他协议的接口地址填入。Bearer 鉴权网关可改用 `ANTHROPIC_AUTH_TOKEN`；两项同时配置时优先使用 `ANTHROPIC_API_KEY`。

```bash
uv run python -m app
```

打开 http://127.0.0.1:8000 。Windows 也可以双击 `start-aurora.bat`。修改 `.env` 后重启后端。开发时可运行 `uv run uvicorn app.main:app --reload --port 8000`。

## 项目结构

```text
app/
  config.py          环境变量配置
  main.py            API 路由与静态页面
  schemas.py         请求与响应校验
  service.py         模型调用和错误处理
  __main__.py        启动入口
  static/            页面、样式、脚本与第三方资源
.env.example         无真实凭据的配置模板
pyproject.toml       Python 依赖声明
uv.lock              依赖锁定
start-aurora.bat     Windows 启动脚本
```

## API

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态、是否配置凭据及模型名，不返回密钥 |
| POST | `/api/chat` | 提交多轮消息，返回完整回复与 token 用量 |
| GET | `/docs` | 交互式 API 文档 |

请求示例：

```json
{"messages": [{"role": "user", "content": "你好"}]}
```

后端以流式方式读取上游，完成后一次性返回浏览器；当前不支持向浏览器逐 token 推送。前端最多发送最近 30 条、约 90,000 字符的上下文；后端另有消息数量与长度校验。

## 安全与使用边界

- `.env`、虚拟环境、缓存、日志与常见凭据文件不纳入 Git；`.env.example` 仅包含占位配置。
- API 密钥由后端读取，不应写入前端、截图、提交信息或发布附件。
- 默认仅监听本机。当前没有用户鉴权、限流和多用户数据隔离，定位为本地单用户工具；公网部署前需补齐这些能力并配置 HTTPS。
- 对话记录保存在浏览器，发送的上下文会传给配置的模型服务；清除浏览器数据会丢失本地会话。
- “停止生成”会中止浏览器请求，不保证上游立即停止生成或计费。

## 常见问题

- **无法聊天**：检查 `.env` 的凭据、协议兼容性、接口地址和模型名，重启服务。
- **页面无法连接**：通过后端的 http://127.0.0.1:8000 访问，不要直接打开 HTML 文件。
- **回复截断**：按模型服务限制调整 `ANTHROPIC_MAX_TOKENS`，本项目允许 256–16000。

## 第三方资源

前端内置 Axios、marked 和 DOMPurify，来源与许可证信息见 [vendor README](app/static/vendor/README.md)。模型请求仍需网络连接。

## 版本

`v0.1.0` 为首个本地使用版本。发布检查覆盖配置、路由、敏感文件排除和模拟上游错误；不代表已完成生产部署验证。
