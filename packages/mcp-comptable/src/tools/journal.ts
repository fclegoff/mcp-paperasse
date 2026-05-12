import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addJournalEntry, listJournalEntries, getAccountBalance, exportFEC, type JournalCode } from "../storage.js";

const journalCodeEnum = z.enum(["VT", "HA", "BQ", "BQ2", "OD", "AN"]);

export function registerJournalTools(server: McpServer): void {
  server.registerTool("add_journal_entry", {
    description: "Ajoute une écriture comptable au journal (PCG). Chaque écriture doit être équilibrée (débit = crédit sur l'ensemble du mouvement).",
    inputSchema: {
      journal_code: journalCodeEnum.describe("VT=Ventes HA=Achats BQ=Banque OD=Opérations diverses AN=À-nouveaux"),
      ecriture_num: z.string().describe("Numéro d'écriture unique (ex: VT-2026-001)"),
      ecriture_date: z.string().describe("Date YYYYMMDD (ex: 20260315)"),
      compte_num: z.string().describe("Numéro compte PCG (ex: 411000, 706000, 512100)"),
      compte_lib: z.string().describe("Libellé du compte"),
      comp_aux_num: z.string().optional().describe("Compte auxiliaire (numéro client/fournisseur)"),
      comp_aux_lib: z.string().optional().describe("Libellé compte auxiliaire"),
      piece_ref: z.string().optional().describe("Référence pièce justificative (ex: numéro facture)"),
      piece_date: z.string().optional().describe("Date pièce YYYYMMDD"),
      ecriture_lib: z.string().describe("Libellé de l'écriture"),
      debit: z.number().describe("Montant au débit (0 si crédit)"),
      credit: z.number().describe("Montant au crédit (0 si débit)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args) => {
    const entry = addJournalEntry({
      journal_code: args.journal_code as JournalCode,
      ecriture_num: args.ecriture_num,
      ecriture_date: args.ecriture_date,
      compte_num: args.compte_num,
      compte_lib: args.compte_lib,
      comp_aux_num: args.comp_aux_num,
      comp_aux_lib: args.comp_aux_lib,
      piece_ref: args.piece_ref,
      piece_date: args.piece_date,
      ecriture_lib: args.ecriture_lib,
      debit: args.debit,
      credit: args.credit,
    });

    return {
      content: [{
        type: "text" as const,
        text: `✅ Écriture: ${entry.journal_code} | ${entry.ecriture_num} | ${entry.compte_num} ${entry.compte_lib} | D:${entry.debit.toFixed(2)} C:${entry.credit.toFixed(2)}`,
      }],
    };
  });

  server.registerTool("list_journal_entries", {
    description: "Liste les écritures comptables avec filtres. Utile pour vérification et préparation déclarations.",
    inputSchema: {
      journal_code: journalCodeEnum.optional(),
      compte_num: z.string().optional().describe("Préfixe compte (ex: '411' = tous clients, '7' = tous produits)"),
      from: z.string().optional().describe("Date début YYYY-MM-DD"),
      to: z.string().optional().describe("Date fin YYYY-MM-DD"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const entries = listJournalEntries({
      journal_code: args.journal_code as JournalCode | undefined,
      compte_num: args.compte_num,
      from: args.from,
      to: args.to,
    });

    if (entries.length === 0) {
      return { content: [{ type: "text" as const, text: "Aucune écriture trouvée." }] };
    }

    const totalD = entries.reduce((s, e) => s + e.debit, 0);
    const totalC = entries.reduce((s, e) => s + e.credit, 0);

    const rows = entries.slice(0, 50).map((e) =>
      `${e.ecriture_date} | ${e.journal_code} | ${e.ecriture_num} | ${e.compte_num} ${e.compte_lib} | D:${e.debit.toFixed(2)} C:${e.credit.toFixed(2)} | ${e.ecriture_lib}`
    );

    const text = [
      `**${entries.length} écriture(s)** — D: ${totalD.toFixed(2)} € | C: ${totalC.toFixed(2)} € | Solde: ${(totalD - totalC).toFixed(2)} €`,
      entries.length > 50 ? `(50 premières sur ${entries.length})` : "",
      ``,
      ...rows,
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("get_account_balance", {
    description: "Solde d'un compte ou classe PCG. Ex: '411'=tous clients, '7'=tous produits, '512'=banque.",
    inputSchema: {
      compte_prefix: z.string().describe("Préfixe compte PCG (ex: '411', '706', '512', '4456')"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const bal = getAccountBalance(args.compte_prefix);
    return {
      content: [{
        type: "text" as const,
        text: `**Compte ${args.compte_prefix}** — Débit: ${bal.debit.toFixed(2)} € | Crédit: ${bal.credit.toFixed(2)} € | Solde: ${bal.solde.toFixed(2)} €`,
      }],
    };
  });

  server.registerTool("export_fec", {
    description: "Génère le FEC (Fichier des Écritures Comptables) au format DGFiP pour l'exercice demandé. À remettre en cas de contrôle fiscal.",
    inputSchema: {
      year: z.number().describe("Année de l'exercice (ex: 2025)"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const fec = exportFEC(args.year);
    const lines = fec.split("\n").length - 1;
    return {
      content: [{
        type: "text" as const,
        text: `**FEC ${args.year} — ${lines} écriture(s)**\n\nNommer le fichier: ${args.year}FECAAAAMMJJhhmmss.txt\n\n\`\`\`\n${fec.slice(0, 2000)}${fec.length > 2000 ? "\n...(tronqué)" : ""}\n\`\`\``,
      }],
    };
  });
}
