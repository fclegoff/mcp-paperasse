import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { markInvoicePaid } from "../storage.js";

export function registerMarkInvoicePaid(server: McpServer): void {
  server.registerTool("mark_invoice_paid", {
    description: "Marque une facture comme payée. Accepte le numéro de facture (ex: 2026-03-000092) ou l'ID interne.",
    inputSchema: {
      invoice: z.string().describe("Numéro de facture ou ID interne"),
      paid_date: z.string().optional().describe("Date de paiement ISO YYYY-MM-DD. Défaut: aujourd'hui."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async (args) => {
    const paid_date = args.paid_date ?? new Date().toISOString().slice(0, 10);
    const inv = markInvoicePaid(args.invoice, paid_date);

    if (!inv) {
      return { content: [{ type: "text" as const, text: `❌ Facture "${args.invoice}" introuvable.` }] };
    }

    return {
      content: [{
        type: "text" as const,
        text: `✅ **${inv.number}** marquée payée le ${paid_date}\nClient: ${inv.client_name} | Montant: ${inv.total_ttc.toFixed(2)} € TTC`,
      }],
    };
  });
}
