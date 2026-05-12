import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCompany } from "../company.js";

export function registerCompanyInfo(server: McpServer): void {
  server.registerTool("company_info", {
    description: "Retourne la configuration complète de la société (SIREN, SIRET, régimes fiscaux, banques, facturation). Appeler en premier pour connaître le contexte.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const c = loadCompany();
    const text = [
      `**${c.name}** — ${c.legal_form}`,
      `SIREN: ${c.siren} | SIRET: ${c.siret} | NAF: ${c.naf}`,
      `Adresse: ${c.address}`,
      `Président: ${c.president.civility} ${c.president.first_name} ${c.president.last_name}`,
      ``,
      `**Fiscal**`,
      `IS: ${c.tax.regime_is} | TVA: ${c.tax.regime_tva} (${c.tax.tva_declaration} ${c.tax.tva_periodicite})`,
      `N° TVA intracom: ${c.tva_intracom}`,
      `Exercice: ${c.fiscal_year.start} → ${c.fiscal_year.end}`,
      ``,
      `**Facturation**`,
      `Format: ${c.invoicing.format ?? c.invoicing.prefix + c.invoicing.separator + c.invoicing.year_format + "-NNN"}`,
      `Exemple: ${c.invoicing.format_example ?? "voir format"}`,
      `Prochain n° séquentiel: ${c.invoicing.next_sequential ?? 1}`,
      `Avoir: préfixe "${c.invoicing.avoir_prefix}"`,
      `Règlement par défaut: ${c.payment.default_terms_label}`,
      ``,
      `**Banques**`,
      ...c.banks.map((b) => `- ${b.name} (compte PCG ${b.account})`),
      `IBAN principal: ${c.payment.bank_details.iban} | BIC: ${c.payment.bank_details.bic}`,
      c.payment.bank_details.iban_revolut ? `IBAN secondaire: ${c.payment.bank_details.iban_revolut}` : "",
      ``,
      `**E-facturation (sept. 2026)**`,
      `PA: ${c.einvoicing.pa_name || "Non configurée ⚠️"}`,
      `Réception prête: ${c.einvoicing.reception_ready ? "✅" : "❌"} | Émission prête: ${c.einvoicing.emission_ready ? "✅" : "❌"}`,
    ].filter((l) => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
