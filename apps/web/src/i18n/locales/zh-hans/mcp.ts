import type { Messages } from '../../types';

export const ZH_HANS_MCP_MESSAGES = {
  "mcp.connection.title": "连接信息",
  "mcp.connection.summary": "使用以下任一方式连接 SkyTest MCP。",
  "mcp.connection.general.title": "通用 MCP 配置",
  "mcp.connection.general.summary": "适用于支持 `mcpServers` 配置文件的 MCP 客户端。",
  "mcp.connection.claudeCode.title": "安装到 Claude Code",
  "mcp.connection.claudeCode.summary": "在终端执行此命令，然后重启 Claude Code。",
  "mcp.connection.codex.title": "安装到 Codex",
  "mcp.connection.codex.summary": "在终端执行此命令，然后重启 Codex。",
  "mcp.connection.aiAgent.summary": "使用以下配置连接你的 AI 代理（如 Claude Code/Desktop、Codex、Antigravity 或其他 MCP 客户端）。此方式通过 mcp-remote 作为桥接，连接到你的 SkyTest MCP 端点。",
  "mcp.connection.aiAgent.step1": "打开你的 AI 代理 MCP 配置文件。",
  "mcp.connection.aiAgent.step2": "在 \"mcpServers\" 下添加下方示例里的 \"skytest\" 服务配置。",
  "mcp.connection.aiAgent.step3": "将 <AGENT_API_KEY> 替换为你的密钥，保存后重启你的 AI 代理。",
  "mcp.connection.aiAgent.configExample": "MCP 配置",
  "mcp.connection.skillInstall.title": "安装 SkyTest Skills",
  "mcp.connection.skillInstall.summary": "复制此提示，并发送给你的代理：",
  "mcp.connection.skillInstall.prompt": "安装 {link} 的 SkyTest skills。",
} satisfies Messages;
