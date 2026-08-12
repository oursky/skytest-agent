import type { Messages } from '../../types';

export const ZH_HANT_MCP_MESSAGES = {
  "mcp.connection.title": "連線資訊",
  "mcp.connection.summary": "使用以下任一方式連接 SkyTest MCP。",
  "mcp.connection.general.title": "通用 MCP 設定",
  "mcp.connection.general.summary": "適用於支援 `mcpServers` 設定檔的 MCP 客戶端。",
  "mcp.connection.claudeCode.title": "安裝到 Claude Code",
  "mcp.connection.claudeCode.summary": "在終端機執行此指令，然後重新啟動 Claude Code。",
  "mcp.connection.codex.title": "安裝到 Codex",
  "mcp.connection.codex.summary": "在終端機執行此指令，然後重新啟動 Codex。",
  "mcp.connection.aiAgent.summary": "使用下方設定連接你的 AI 代理（如 Claude Code/Desktop、Codex、Antigravity 或其他 MCP 客戶端）。此方式透過 mcp-remote 作為橋接，連接到你的 SkyTest MCP 端點。",
  "mcp.connection.aiAgent.step1": "開啟你的 AI 代理 MCP 設定檔。",
  "mcp.connection.aiAgent.step2": "在 \"mcpServers\" 下加入下方範例中的 \"skytest\" 伺服器設定。",
  "mcp.connection.aiAgent.step3": "將 <AGENT_API_KEY> 換成你的金鑰，儲存後重新啟動你的 AI 代理。",
  "mcp.connection.aiAgent.configExample": "MCP 設定",
  "mcp.connection.skillInstall.title": "安裝 SkyTest Skills",
  "mcp.connection.skillInstall.summary": "複製此提示，並傳給你的代理：",
  "mcp.connection.skillInstall.prompt": "將 {link} 的 SkyTest skills 安裝。",
} satisfies Messages;
