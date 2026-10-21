# Aurora · AI 对话助手

![Aurora · AI 恋爱陪伴概念封面](docs/images/aurora-cover.png)

> 配图为 AI 生成的恋爱陪伴主题概念插画，仓库功能以以下说明和代码为准。

基于 FastAPI 和原生 HTML / CSS / JavaScript 的本地 AI 聊天应用。后端使用 Anthropic Python SDK，可连接支持 Anthropic Messages 协议的模型服务。

## 项目解决什么问题

Aurora 为已有模型 API 凭据的用户提供一个可在本机运行的浏览器聊天界面：无需自己拼装请求，就能连续提问、查看 Markdown 回答并回看历史会话。模型调用集中在 Python 后端，前端无需持有 API 密钥；聊天记录由浏览器保存，无需配置数据库。

适合个人本地使用，以及学习前后端如何对接模型 API。项目本身不提供模型或免费额度，也不在本机运行大模型；实际回答由你配置的远程模型服务生成。

## 主要功能

- 多轮对话、新建与切换会话、删除单条会话和清空全部会话；聊天记录保存在当前浏览器 localStorage，最多保留 40 个会话。
- Markdown 渲染、代码块复制，使用 DOMPurify 净化输出。
- 重新生成回复、停止等待、发送失败回滚。
- 深浅主题、移动端侧栏和键盘快捷键。
- 后端请求校验、超时及常见上游错误处理。
- 本地静态资源、健康检查 API 和 Windows 启动脚本。

## 角色视觉概念

温柔、傲娇、犀利、暴躁、元气、高冷：六种性格的角色视觉设定，用于展示 Aurora 的陪伴主题设计。

![Aurora 六种性格角色概念插画](docs/images/aurora-personalities.png)

## 安装方法

### 1. 准备环境并获取代码

需要 Python 3.11+、Git、uv，以及可用的 Anthropic Messages 协议兼容模型服务凭据。前端没有 Node.js 构建步骤。

如果还没有 uv，可在已安装 Python 的环境中执行：

```bash
python -m pip install uv
uv --version
```

若系统中 Python 命令为 `python3`，将上面的 `python` 替换为 `python3`。确保 `uv` 已加入 PATH。

```bash
git clone https://github.com/throw29/ai-chatbot.git
cd ai-chatbot
uv sync --frozen
```

当前仓库为私有仓库，克隆需要相应 GitHub 账号的访问权限。已有源码时直接进入项目根目录执行 `uv sync --frozen` 即可；该命令按 `uv.lock` 安装依赖到虚拟环境。

### 2. 配置模型

复制 `.env.example` 为 `.env`（PowerShell：`Copy-Item .env.example .env`；macOS/Linux：`cp .env.example .env`），然后在本机编辑 `.env`：

```dotenv
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_BASE_URL=https://your-provider.example
ANTHROPIC_MODEL=your-model-id
ANTHROPIC_MAX_TOKENS=4096
REQUEST_TIMEOUT_SECONDS=180
```

接口地址、模型名与密钥必须来自同一服务商。当前代码使用 Anthropic Messages 协议；接入 DeepSeek 时，需使用支持该协议的服务地址，不能直接将仅支持其他协议的接口地址填入。Bearer 鉴权网关可改用 `ANTHROPIC_AUTH_TOKEN`；两项同时配置时优先使用 `ANTHROPIC_API_KEY`。

## 使用方法

### 启动服务

在项目根目录执行：

```bash
uv run python -m app
```

打开 http://127.0.0.1:8000 。Windows 也可以双击 `start-aurora.bat`。修改 `.env` 后重启后端。开发时可运行 `uv run uvicorn app.main:app --reload --port 8000`。

### 在页面中聊天

1. 打开页面，点击“新对话”或直接在输入框中输入问题。
2. 按 `Enter` 发送，按 `Shift + Enter` 换行；等待完整回复后可继续追问。
3. 使用侧栏切换历史会话或删除会话；`Ctrl + K`（macOS：`⌘ + K`）开启新对话。
4. 使用回复旁的复制、重新生成功能，或在等待时点击停止按钮。代码块提供独立复制按钮。
5. 可切换深浅主题。会话和主题保存在当前浏览器，不会自动同步到其他设备。

未配置凭据时页面仍可打开，但聊天会返回配置错误。健康检查显示 `online` 仅表示后端已配置凭据，并不验证密钥有效性或上游服务可用性。

## 输入输出示例

### 页面对话

输入：

```text
请用一句话解释什么是 API。
```

可能的输出（示意，实际内容由模型生成）：

```text
API 是让不同程序按照约定交换数据和调用功能的接口。
```

随后输入“给我一个生活中的类比”，前端会携带近期对话上下文发送请求。

### 调用聊天 API

服务启动后，可打开 http://127.0.0.1:8000/docs，在 `POST /api/chat` 中点击 **Try it out**，填入以下请求体并执行：

```json
{
  "messages": [
    {"role": "user", "content": "请用一句话解释什么是 API。"}
  ]
}
```

成功响应为 HTTP 200，格式如下（回复、模型名和 token 数仅为示例）：

```json
{
  "reply": "API 是让不同程序按照约定交换数据和调用功能的接口。",
  "model": "your-model-id",
  "usage": {"input_tokens": 32, "output_tokens": 24}
}
```

`model` 来自后端配置；`usage` 是上游返回的用量信息，也可能为 `null`。API 不保存服务端会话，直接调用时需自行携带历史，例如：

```json
{
  "messages": [
    {"role": "user", "content": "什么是 API？"},
    {"role": "assistant", "content": "API 是程序之间交互的接口。"},
    {"role": "user", "content": "给我一个生活中的类比。"}
  ]
}
```

未配置凭据时，聊天接口返回 HTTP 503：

```json
{
  "detail": "尚未配置模型凭据，请在项目根目录的 .env 中填写 ANTHROPIC_API_KEY。"
}
```

空消息、非法角色或超出限制的请求返回 HTTP 422。后端要求消息列表为 1–60 条，每条 1–20,000 字符且不能全为空白，总长度不超过 120,000 字符；第一条和最后一条都必须来自 `user`。

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

`v0.1.1` 完善了安装、使用与输入输出示例，并添加 MIT LICENSE；聊天功能与 `v0.1.0` 保持一致。项目仍面向本地单用户使用，尚未完成生产部署验证。

## 许可证

本项目代码使用 [MIT License](LICENSE)。内置第三方资源仍遵循各自许可证，详见 [vendor README](app/static/vendor/README.md)。
