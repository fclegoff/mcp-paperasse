#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerNotaireTools } from "./tools/calculs.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "notaire", version: "0.1.0" });
  registerNotaireTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[notaire] MCP server v0.1.0 running on stdio");
}
main().catch(err => { console.error("[notaire] fatal:", err); process.exit(1); });
