import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadCompany } from "../company.js";
import { createInvoice, formatInvoiceNumber, getInvoice, getLastSequential } from "../storage.js";

export function registerCreateAvoir(server: McpServer): void {
  server.registerTool("create_avoir", {
    description: "Crée un avoir (note de crédit) annulant totalement ou partiellement une facture existante.",
    inputSchema: {
      ref_invoice: z.string().describe("Numéro ou ID de la facture à annuler"),
      date: z.string().optional().describe("Date de l'avoir ISO YYYY-MM-DD. Défaut: aujourd'hui."),
      partial_lines: z.array(z.object({
        designation: z.string(),
        quantity: z.number(),
        unit_price: z.number(),
        tva_rate: z.number().min(0).max(1),
      })).optional().describe("Lignes partielles si avoir partiel. Laisser vide pour avoir total."),
      notes: z.string().optional().describe("Motif de l'avoir"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args) => {
    const company = loadCompany();
    const original = getInvoice(args.ref_invoice);

    if (!original) {
      return { content: [{ type: "text" as const, text: `❌ Facture "${args.ref_invoice}" introuvable.` }] };
    }

    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const sequential = getLastSequential() + 1;

    const avoirPrefix = company.invoicing.avoir_prefix ?? "AV";
    const baseFormat = company.invoicing.format ?? "YYYY-MM-NNNNNN";
    const format = `${avoirPrefix}-${baseFormat}`;
    const number = formatInvoiceNumber(sequential, format, date);

    const lines = args.partial_lines?.length
      ? args.partial_lines
      : original.lines.map((l) => ({ ...l, quantity: -Math.abs(l.quantity) }));

    const avoir = createInvoice({
      type: "avoir",
      number,
      sequential,
      date,
      client_name: original.client_name,
      client_siren: original.client_siren,
      client_address: original.client_address,
      lines,
      notes: args.notes ?? `Avoir sur facture ${original.number}`,
      ref_avoir: original.number,
    });

    return {
      content: [{
        type: "text" as const,
        text: [
          `✅ **Avoir créé : ${number}**`,
          `Facture annulée: ${original.number}`,
          `Client: ${avoir.client_name}`,
          `Date: ${avoir.date}`,
          `Montant: ${avoir.total_ttc.toFixed(2)} € TTC`,
          avoir.notes ? `Motif: ${avoir.notes}` : "",
        ].filter(Boolean).join("\n"),
      }],
    };
  });
}
