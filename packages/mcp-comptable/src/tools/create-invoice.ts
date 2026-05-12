import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadCompany } from "../company.js";
import { createInvoice, formatInvoiceNumber, getLastSequential, type InvoiceLine } from "../storage.js";

export function registerCreateInvoice(server: McpServer): void {
  server.registerTool("create_invoice", {
    description: "Crée une nouvelle facture client avec numérotation automatique conforme. Génère toutes les mentions légales obligatoires (TVA, pénalités, IBAN).",
    inputSchema: {
      date: z.string().optional().describe("Date d'émission ISO YYYY-MM-DD. Défaut: aujourd'hui."),
      due_date: z.string().optional().describe("Date d'échéance ISO. Défaut: selon payment.default_terms."),
      client_name: z.string().describe("Nom ou raison sociale du client"),
      client_siren: z.string().optional().describe("SIREN client (obligatoire B2B à partir de sept. 2026)"),
      client_address: z.string().optional().describe("Adresse complète du client"),
      lines: z.array(z.object({
        designation: z.string().describe("Description de la prestation"),
        quantity: z.number().positive().describe("Quantité"),
        unit_price: z.number().describe("Prix unitaire HT en euros"),
        tva_rate: z.number().min(0).max(1).describe("Taux TVA (0.20 = 20%, 0 = exonéré)"),
      })).describe("Lignes de facturation"),
      notes: z.string().optional().describe("Notes ou conditions particulières"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args) => {
    const company = loadCompany();
    const today = new Date().toISOString().slice(0, 10);
    const date = args.date ?? today;

    const lastSeq = getLastSequential();
    const configSeq = company.invoicing.next_sequential ?? 1;
    const sequential = Math.max(lastSeq + 1, configSeq);

    const format = company.invoicing.format
      ?? `${company.invoicing.prefix}${company.invoicing.separator}YYYY${company.invoicing.separator}NNN`;
    const number = formatInvoiceNumber(sequential, format, date);

    let due_date = args.due_date;
    if (!due_date) {
      if (company.payment.default_terms === "a_reception") {
        due_date = date;
      } else if (company.payment.default_terms === "net_30") {
        const d = new Date(date);
        d.setDate(d.getDate() + 30);
        due_date = d.toISOString().slice(0, 10);
      }
    }

    const invoice = createInvoice({
      type: "facture",
      number,
      sequential,
      date,
      due_date,
      client_name: args.client_name,
      client_siren: args.client_siren,
      client_address: args.client_address,
      lines: args.lines as InvoiceLine[],
      notes: args.notes,
    });

    const tvaApplicable = invoice.total_tva > 0;
    const tvaLines = (args.lines as InvoiceLine[]).reduce((acc, l) => {
      const key = `${Math.round(l.tva_rate * 100)}%`;
      const base = l.quantity * l.unit_price;
      acc[key] = (acc[key] ?? 0) + base * l.tva_rate;
      return acc;
    }, {} as Record<string, number>);

    const text = [
      `✅ **Facture créée : ${number}**`,
      ``,
      `**${company.name}** — ${company.legal_form}`,
      `${company.address}`,
      `SIREN ${company.siren} — RCS ${company.rcs} — NAF ${company.naf}`,
      `TVA intracom: ${company.tva_intracom}`,
      ``,
      `**Client:** ${invoice.client_name}`,
      invoice.client_siren ? `SIREN: ${invoice.client_siren}` : "",
      invoice.client_address ?? "",
      ``,
      `Date: ${invoice.date} | Échéance: ${invoice.due_date ?? "À réception"}`,
      ``,
      `| Désignation | Qté | PU HT | TVA | Montant HT |`,
      `|---|---|---|---|---|`,
      ...(args.lines as InvoiceLine[]).map((l) =>
        `| ${l.designation} | ${l.quantity} | ${l.unit_price.toFixed(2)} € | ${Math.round(l.tva_rate * 100)}% | ${(l.quantity * l.unit_price).toFixed(2)} € |`
      ),
      ``,
      `**Total HT : ${invoice.total_ht.toFixed(2)} €**`,
      tvaApplicable
        ? Object.entries(tvaLines).map(([r, m]) => `TVA ${r} : ${m.toFixed(2)} €`).join("\n")
        : "TVA non applicable",
      `**Total TTC : ${invoice.total_ttc.toFixed(2)} €**`,
      ``,
      `Règlement: ${company.payment.default_terms_label}`,
      `IBAN: ${company.payment.bank_details.iban} | BIC: ${company.payment.bank_details.bic}`,
      ``,
      `${company.payment.late_penalty_label}`,
      `Indemnité forfaitaire de recouvrement: ${company.payment.recovery_fee} €`,
      args.notes ? `\n${args.notes}` : "",
    ].filter((l) => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
