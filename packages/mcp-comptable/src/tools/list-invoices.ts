import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listInvoices, type InvoiceStatus, type InvoiceType } from "../storage.js";

export function registerListInvoices(server: McpServer): void {
  server.registerTool("list_invoices", {
    description: "Liste les factures et avoirs avec filtres optionnels. Retourne totaux et statuts.",
    inputSchema: {
      status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]).optional().describe("Filtrer par statut"),
      type: z.enum(["facture", "avoir"]).optional().describe("Filtrer par type"),
      client_name: z.string().optional().describe("Filtrer par nom client (recherche partielle)"),
      year: z.number().optional().describe("Filtrer par année (ex: 2026)"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const invoices = listInvoices({
      status: args.status as InvoiceStatus | undefined,
      type: args.type as InvoiceType | undefined,
      client_name: args.client_name,
      year: args.year,
    });

    if (invoices.length === 0) {
      return { content: [{ type: "text" as const, text: "Aucune facture trouvée avec ces critères." }] };
    }

    const totalHT = invoices.reduce((s, i) => s + i.total_ht, 0);
    const totalTTC = invoices.reduce((s, i) => s + i.total_ttc, 0);
    const byStatus = invoices.reduce((acc, i) => {
      acc[i.status] = (acc[i.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const statusEmoji: Record<string, string> = {
      draft: "📝", sent: "📤", paid: "✅", overdue: "🔴", cancelled: "❌",
    };

    const rows = invoices.map((inv) =>
      `${statusEmoji[inv.status] ?? "?"} **${inv.number}** | ${inv.client_name} | ${inv.date} | ${inv.total_ttc.toFixed(2)} € TTC | ${inv.status}`
    );

    const text = [
      `**${invoices.length} document(s)** — Total HT: ${totalHT.toFixed(2)} € | Total TTC: ${totalTTC.toFixed(2)} €`,
      Object.entries(byStatus).map(([s, n]) => `${statusEmoji[s] ?? s} ${s}: ${n}`).join(" | "),
      ``,
      ...rows,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
