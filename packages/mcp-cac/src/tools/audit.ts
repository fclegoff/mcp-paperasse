import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const RISK = { faible: "🟢", moyen: "🟡", eleve: "🔴" } as const;
type Risk = keyof typeof RISK;

function riskLabel(r: Risk) { return `${RISK[r]} ${r}`; }

export function registerAuditTools(server: McpServer): void {

  server.registerTool("cac_start_audit", {
    description: "Initialise un audit CAC (NEP). Vérifie les prérequis, identifie les documents disponibles et produit le plan d'audit 7 phases.",
    inputSchema: {
      company_name: z.string().describe("Raison sociale"),
      siren: z.string().describe("SIREN (9 chiffres)"),
      legal_form: z.string().describe("Forme juridique (SASU, SAS, SARL...)"),
      regime_is: z.string().describe("Régime IS: reel_simplifie ou reel_normal"),
      capital: z.number().describe("Capital social en euros"),
      fiscal_year_start: z.string().describe("Début exercice YYYY-MM-DD"),
      fiscal_year_end: z.string().describe("Fin exercice YYYY-MM-DD"),
      ca_ht: z.number().optional().describe("Chiffre d'affaires HT estimé"),
      total_bilan: z.number().optional().describe("Total bilan estimé"),
      effectif: z.number().optional().describe("Effectif moyen"),
      documents: z.array(z.string()).optional().describe("Documents disponibles (FEC, bilan, liasse, relevés...)"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const seuils = [];
    if (args.total_bilan && args.total_bilan > 4_000_000) seuils.push("bilan > 4M€ ✅");
    if (args.ca_ht && args.ca_ht > 8_000_000) seuils.push("CA > 8M€ ✅");
    if (args.effectif && args.effectif >= 50) seuils.push("effectif ≥ 50 ✅");
    const obligatoire = seuils.length >= 2;

    const docs = args.documents ?? [];
    const hasFEC = docs.some(d => d.toLowerCase().includes("fec"));
    const hasBilan = docs.some(d => d.toLowerCase().includes("bilan"));
    const hasLiasse = docs.some(d => d.toLowerCase().includes("liasse"));

    const text = [
      `# Audit CAC — ${args.company_name}`,
      `SIREN: ${args.siren} | ${args.legal_form} | Capital: ${args.capital.toLocaleString("fr-FR")} €`,
      `Exercice: ${args.fiscal_year_start} → ${args.fiscal_year_end}`,
      ``,
      `## Obligation légale`,
      obligatoire
        ? `✅ **CAC obligatoire** (${seuils.join(", ")})`
        : `ℹ️ CAC volontaire (seuils non atteints — audit de bonne pratique)`,
      ``,
      `## Documents`,
      `- FEC: ${hasFEC ? "✅" : "❌ manquant — critique"}`,
      `- Bilan/CR: ${hasBilan ? "✅" : "❌ manquant — critique"}`,
      `- Liasse fiscale: ${hasLiasse ? "✅" : "⚠️ manquant — important"}`,
      ``,
      `## Programme d'audit — 7 phases NEP`,
      `1. **Prise de connaissance** — Secteur, risques métier, contrôle interne`,
      `2. **Contrôle du FEC** — Structure, équilibre, intégrité des données`,
      `3. **Vérification bilan** — Actif (immobilisations, créances) + Passif (dettes, capitaux)`,
      `4. **Compte de résultat** — CA, charges, résultat, variations N/N-1`,
      `5. **Balance et grand livre** — Lettrage, comptes d'attente, écarts`,
      `6. **Liasse fiscale** — Concordance comptabilité/fiscal, retraitements`,
      `7. **Contrôles transversaux** — TVA, opérations avec parties liées, provisions`,
      ``,
      `## Prochaine étape`,
      hasFEC
        ? `→ Lancez \`cac_analyze_fec\` avec le contenu ou le résumé du FEC`
        : `→ Fournissez le FEC (export depuis votre logiciel comptable) pour démarrer l'analyse`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("cac_analyze_fec", {
    description: "Phase 2 NEP — Analyse le FEC pour détecter anomalies structurelles, écritures déséquilibrées, comptes d'attente, écritures en date de clôture.",
    inputSchema: {
      total_lignes: z.number().describe("Nombre total de lignes dans le FEC"),
      total_debit: z.number().describe("Total colonne Débit du FEC"),
      total_credit: z.number().describe("Total colonne Crédit du FEC"),
      nb_journaux: z.number().optional().describe("Nombre de journaux distincts"),
      has_compte_attente: z.boolean().optional().describe("Présence de comptes 471/472 non apurés"),
      ecritures_cloture: z.number().optional().describe("Nb écritures datées au 31/12 (date de clôture)"),
      anomalies: z.array(z.string()).optional().describe("Anomalies déjà détectées"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const equilibre = Math.abs(args.total_debit - args.total_credit) < 0.01;
    const risques: string[] = [];

    if (!equilibre) risques.push(`🔴 FEC déséquilibré: D ${args.total_debit.toFixed(2)} ≠ C ${args.total_credit.toFixed(2)} — écart ${Math.abs(args.total_debit - args.total_credit).toFixed(2)} €`);
    if (args.has_compte_attente) risques.push(`🟡 Comptes d'attente (471/472) non apurés — à analyser`);
    if (args.ecritures_cloture && args.ecritures_cloture > 50) risques.push(`🟡 ${args.ecritures_cloture} écritures en date de clôture — risque cut-off`);
    for (const a of args.anomalies ?? []) risques.push(`🟡 ${a}`);

    const text = [
      `## Phase 2 — Analyse FEC`,
      ``,
      `| Indicateur | Valeur | Statut |`,
      `|---|---|---|`,
      `| Lignes | ${args.total_lignes.toLocaleString("fr-FR")} | ✅ |`,
      `| Équilibre D/C | ${equilibre ? "Équilibré" : "⚠️ Déséquilibré"} | ${equilibre ? "✅" : "🔴"} |`,
      `| Journaux | ${args.nb_journaux ?? "?"} | ${(args.nb_journaux ?? 0) >= 3 ? "✅" : "⚠️"} |`,
      `| Comptes attente | ${args.has_compte_attente ? "Oui ⚠️" : "Non"} | ${args.has_compte_attente ? "🟡" : "✅"} |`,
      `| Écritures clôture | ${args.ecritures_cloture ?? "?"} | ${(args.ecritures_cloture ?? 0) > 50 ? "🟡" : "✅"} |`,
      ``,
      risques.length > 0 ? `## Points d'attention\n${risques.join("\n")}` : `## Conclusion\n✅ FEC structurellement conforme — passer à la Phase 3 (bilan)`,
      ``,
      `→ Lancez \`cac_check_balance_sheet\` pour la Phase 3`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("cac_check_balance_sheet", {
    description: "Phase 3 NEP — Vérifie le bilan : cohérence actif/passif, provisions, amortissements, capitaux propres.",
    inputSchema: {
      total_actif: z.number().describe("Total actif en €"),
      total_passif: z.number().describe("Total passif en €"),
      capitaux_propres: z.number().describe("Capitaux propres en €"),
      capital_social: z.number().describe("Capital social en €"),
      resultat_net: z.number().describe("Résultat net en €"),
      dettes_total: z.number().describe("Total dettes en €"),
      tresorerie: z.number().describe("Trésorerie nette en €"),
      immobilisations_nettes: z.number().optional().describe("Immobilisations nettes en €"),
      creances_clients: z.number().optional().describe("Créances clients en €"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const equilibre = Math.abs(args.total_actif - args.total_passif) < 1;
    const fpcNegatifs = args.capitaux_propres < 0;
    const fpcSousCapital = args.capitaux_propres < args.capital_social / 2;
    const risques: string[] = [];

    if (!equilibre) risques.push(`🔴 Bilan déséquilibré: A ${args.total_actif} ≠ P ${args.total_passif}`);
    if (fpcNegatifs) risques.push(`🔴 Capitaux propres négatifs (${args.capitaux_propres.toLocaleString("fr-FR")} €) — procédure alerte CAC obligatoire`);
    else if (fpcSousCapital) risques.push(`🟡 Capitaux propres < ½ capital social — risque de continuité d'exploitation`);
    if (args.tresorerie < 0) risques.push(`🟡 Trésorerie négative (${args.tresorerie.toLocaleString("fr-FR")} €)`);

    const ratioEndettement = args.capitaux_propres > 0 ? (args.dettes_total / args.capitaux_propres).toFixed(2) : "N/A";

    const text = [
      `## Phase 3 — Vérification Bilan`,
      ``,
      `| Poste | Montant | Statut |`,
      `|---|---|---|`,
      `| Total Actif | ${args.total_actif.toLocaleString("fr-FR")} € | ${equilibre ? "✅" : "🔴"} |`,
      `| Total Passif | ${args.total_passif.toLocaleString("fr-FR")} € | ${equilibre ? "✅" : "🔴"} |`,
      `| Capitaux propres | ${args.capitaux_propres.toLocaleString("fr-FR")} € | ${fpcNegatifs ? "🔴" : fpcSousCapital ? "🟡" : "✅"} |`,
      `| Résultat net | ${args.resultat_net.toLocaleString("fr-FR")} € | ℹ️ |`,
      `| Trésorerie | ${args.tresorerie.toLocaleString("fr-FR")} € | ${args.tresorerie < 0 ? "🟡" : "✅"} |`,
      `| Ratio D/CP | ${ratioEndettement} | ${parseFloat(ratioEndettement) > 3 ? "🟡" : "✅"} |`,
      ``,
      risques.length > 0
        ? `## Points d'attention\n${risques.join("\n")}`
        : `## Conclusion\n✅ Bilan cohérent — passer Phase 4 (compte de résultat)`,
      ``,
      `→ Lancez \`cac_generate_opinion\` après les phases 4-7 pour l'opinion finale`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("cac_generate_opinion", {
    description: "Phase 7 NEP — Synthèse et émission de l'opinion d'audit (certification, réserves, refus). Produit le rapport CAC structuré.",
    inputSchema: {
      company_name: z.string().describe("Raison sociale"),
      siren: z.string(),
      fiscal_year_end: z.string().describe("Date de clôture YYYY-MM-DD"),
      total_bilan: z.number(),
      ca_ht: z.number(),
      resultat_net: z.number(),
      anomalies_critiques: z.array(z.string()).optional().describe("Anomalies critiques détectées"),
      anomalies_mineures: z.array(z.string()).optional().describe("Anomalies mineures / points d'attention"),
      capitaux_propres_negatifs: z.boolean().optional(),
      fec_equilibre: z.boolean().optional().describe("FEC équilibré?"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const critiques = args.anomalies_critiques ?? [];
    const mineures = args.anomalies_mineures ?? [];
    const opinion = critiques.length > 2 ? "refus" : critiques.length > 0 ? "reserves" : "certification";

    const opinionLabel = {
      certification: "✅ CERTIFICATION SANS RÉSERVE",
      reserves: "⚠️ CERTIFICATION AVEC RÉSERVES",
      refus: "❌ REFUS DE CERTIFIER",
    }[opinion];

    const today = new Date().toISOString().slice(0, 10);

    const text = [
      `# Rapport du Commissaire aux Comptes`,
      `**${args.company_name}** — SIREN ${args.siren}`,
      `Exercice clos le ${args.fiscal_year_end} | Rapport établi le ${today}`,
      ``,
      `## Opinion`,
      `### ${opinionLabel}`,
      ``,
      opinion === "certification"
        ? `Les comptes annuels sont réguliers et sincères et donnent une image fidèle du résultat des opérations de l'exercice ainsi que de la situation financière et du patrimoine de la société au ${args.fiscal_year_end}.`
        : opinion === "reserves"
        ? `Sous réserve des points mentionnés ci-après, les comptes annuels sont réguliers et sincères.`
        : `En raison des anomalies significatives décrites ci-après, nous ne sommes pas en mesure de certifier les comptes annuels.`,
      ``,
      `## Données financières auditées`,
      `| | Montant |`,
      `|---|---|`,
      `| Total bilan | ${args.total_bilan.toLocaleString("fr-FR")} € |`,
      `| Chiffre d'affaires HT | ${args.ca_ht.toLocaleString("fr-FR")} € |`,
      `| Résultat net | ${args.resultat_net.toLocaleString("fr-FR")} € |`,
      ``,
      critiques.length > 0 ? `## Anomalies critiques\n${critiques.map(a => `- 🔴 ${a}`).join("\n")}` : "",
      mineures.length > 0 ? `## Points d'attention\n${mineures.map(a => `- 🟡 ${a}`).join("\n")}` : "",
      args.capitaux_propres_negatifs ? `\n⚠️ **Procédure d'alerte déclenchée** — Capitaux propres négatifs (art. L234-1 Code de commerce)` : "",
      ``,
      `---`,
      `*Ce rapport est produit par un audit IA à titre indicatif. Il ne se substitue pas à l'opinion d'un CAC inscrit à la CNCC.*`,
    ].filter(l => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
