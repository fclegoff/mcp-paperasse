#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAuditTools } from "./tools/audit.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "cac", version: "0.1.0" });
  registerAuditTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[cac] MCP server v0.1.0 running on stdio");
}
main().catch(err => { console.error("[cac] fatal:", err); process.exit(1); });
