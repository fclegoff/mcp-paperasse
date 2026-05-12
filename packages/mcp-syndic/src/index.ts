#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSyndicTools } from "./tools/syndic.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "syndic", version: "0.1.0" });
  registerSyndicTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[syndic] MCP server v0.1.0 running on stdio");
}
main().catch(err => { console.error("[syndic] fatal:", err); process.exit(1); });
