import type { Messages } from '../../types';

export const EN_MCP_MESSAGES = {
  "mcp.connection.title": "Connection Details",
  "mcp.connection.summary": "Use one of the following methods to connect SkyTest MCP.",
  "mcp.connection.general.title": "General MCP Configuration",
  "mcp.connection.general.summary": "Use this JSON snippet for MCP clients that support a `mcpServers` config file.",
  "mcp.connection.claudeCode.title": "Install to Claude Code",
  "mcp.connection.claudeCode.summary": "Run this command in your terminal, then restart Claude Code.",
  "mcp.connection.codex.title": "Install to Codex",
  "mcp.connection.codex.summary": "Run this command in your terminal, then restart Codex.",
  "mcp.connection.aiAgent.summary": "Connect your AI agent (Claude Code/Desktop, Codex, Antigravity, or other MCP clients) by adding the configuration below. It uses mcp-remote as a bridge to your SkyTest MCP endpoint.",
  "mcp.connection.aiAgent.step1": "Open your AI agent's MCP configuration file.",
  "mcp.connection.aiAgent.step2": "Add the \"skytest\" server entry under \"mcpServers\" using the sample below.",
  "mcp.connection.aiAgent.step3": "Replace <AGENT_API_KEY> with your key, save the file, then restart your AI agent.",
  "mcp.connection.aiAgent.configExample": "MCP configuration",
  "mcp.connection.skillInstall.title": "Install SkyTest Skills",
  "mcp.connection.skillInstall.summary": "Copy this prompt and send it to your agent:",
  "mcp.connection.skillInstall.prompt": "Install SkyTest skills from {link}.",
} satisfies Messages;
