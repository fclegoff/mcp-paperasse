#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerControleTools } from "./tools/controle.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "controleur-fiscal", version: "0.1.0" });
  registerControleTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[controleur-fiscal] MCP server v0.1.0 running on stdio");
}
main().catch(err => { console.error("[controleur-fiscal] fatal:", err); process.exit(1); });
