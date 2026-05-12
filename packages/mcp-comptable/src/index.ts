#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCompanyInfo } from "./tools/company-info.js";
import { registerCreateInvoice } from "./tools/create-invoice.js";
import { registerListInvoices } from "./tools/list-invoices.js";
import { registerMarkInvoicePaid } from "./tools/mark-invoice-paid.js";
import { registerCreateAvoir } from "./tools/create-avoir.js";
import { registerFiscalDeadlines } from "./tools/fiscal-deadlines.js";
import { registerJournalTools } from "./tools/journal.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "comptable", version: "0.1.0" });

  registerCompanyInfo(server);
  registerCreateInvoice(server);
  registerListInvoices(server);
  registerMarkInvoicePaid(server);
  registerCreateAvoir(server);
  registerFiscalDeadlines(server);
  registerJournalTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[comptable] MCP server v0.1.0 running on stdio");
}

main().catch((err) => {
  console.error("[comptable] fatal:", err);
  process.exit(1);
});
