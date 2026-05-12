import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Chef {
  axe: string;
  libelle: string;
  base: number;
  taux_is: number;
  rappel_is: number;
  majoration: number;
  total: number;
  risque: "faible" | "moyen" | "eleve";
  base_legale: string;
}

function chef(axe: string, libelle: string, base: number, risque: Chef["risque"], base_legale: string): Chef {
  const taux_is = 0.25;
  const rappel_is = Math.round(base * taux_is * 100) / 100;
  const majoration = Math.round(rappel_is * 0.10 * 100) / 100;
  return { axe, libelle, base, taux_is, rappel_is, majoration, total: rappel_is + majoration, risque, base_legale };
}

export function registerControleTools(server: McpServer): void {

  server.registerTool("fiscal_start_control", {
    description: "Initialise un contrôle fiscal DGFIP simulé. Identifie les zones de risque prioritaires selon le profil de la société.",
    inputSchema: {
      company_name: z.string(),
      siren: z.string(),
      legal_form: z.string().describe("SASU, SAS, SARL, EURL..."),
      regime_tva: z.string().describe("franchise, minireel, reel_simplifie, reel_normal"),
      ca_ht: z.number().describe("CA HT de l'exercice"),
      charges_totales: z.number().describe("Total charges déduites"),
      resultat_fiscal: z.number().describe("Résultat fiscal avant IS"),
      nb_associes: z.number().optional().describe("Nombre d'associés"),
      remuneration_dirigeant: z.number().optional().describe("Rémunération du dirigeant"),
      compte_courant_associe: z.number().optional().describe("Solde compte courant d'associé (positif = dette société)"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const tauxCharges = args.charges_totales / args.ca_ht;
    const zones: string[] = [];

    if (tauxCharges > 0.85) zones.push(`🔴 Taux de charges élevé (${Math.round(tauxCharges * 100)}% du CA) — charges personnelles probables`);
    if (args.remuneration_dirigeant && args.remuneration_dirigeant > args.ca_ht * 0.5) zones.push(`🔴 Rémunération dirigeant > 50% du CA — excessivité potentielle (art. 39-1 CGI)`);
    if (args.compte_courant_associe && args.compte_courant_associe > 46000) zones.push(`🟡 Compte courant d'associé élevé (${args.compte_courant_associe.toLocaleString("fr-FR")} €) — intérêts déductibles plafonnés`);
    if (args.regime_tva === "franchise" && args.ca_ht > 36800) zones.push(`🔴 CA (${args.ca_ht.toLocaleString("fr-FR")} €) dépasse le seuil franchise TVA 2026 (36 800 €)`);

    const text = [
      `# Contrôle Fiscal DGFIP — ${args.company_name}`,
      `SIREN: ${args.siren} | ${args.legal_form} | TVA: ${args.regime_tva}`,
      `CA HT: ${args.ca_ht.toLocaleString("fr-FR")} € | Charges: ${args.charges_totales.toLocaleString("fr-FR")} € | Résultat fiscal: ${args.resultat_fiscal.toLocaleString("fr-FR")} €`,
      ``,
      `## Zones de risque prioritaires`,
      zones.length > 0 ? zones.join("\n") : `🟢 Aucune zone de risque évidente à ce stade`,
      ``,
      `## 8 axes de vérification`,
      `1. \`fiscal_check_charges\` — Déductibilité des charges (art. 39 CGI)`,
      `2. \`fiscal_check_tva\` — Cohérence TVA collectée/déduite`,
      `3. \`fiscal_check_is\` — Calcul IS et acomptes`,
      `4. Compte courant d'associé — Intérêts, avances`,
      `5. Immobilisations — Amortissements, plus-values`,
      `6. Charges de personnel — Salaires excessifs, charges sociales`,
      `7. Opérations avec parties liées — Prix de transfert intragroupes`,
      `8. \`fiscal_generate_report\` — Rapport de contrôle et propositions de rectification`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("fiscal_check_charges", {
    description: "Axe 1 DGFIP — Vérifie la déductibilité des charges. Identifie les charges personnelles, non justifiées, ou contraires à l'intérêt social.",
    inputSchema: {
      charges: z.array(z.object({
        libelle: z.string().describe("Libellé de la charge"),
        montant: z.number().describe("Montant en €"),
        justifie: z.boolean().describe("Justificatif fourni?"),
        nature: z.enum(["transport", "repas", "formation", "materiel", "loyer", "sous_traitance", "publicite", "autre"]),
        mixte: z.boolean().optional().describe("Usage mixte pro/perso?"),
      })).describe("Liste des principales charges"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const chefs: Chef[] = [];
    let totalRisque = 0;

    for (const c of args.charges) {
      if (!c.justifie) {
        const ch = chef("Axe 1", `Charge non justifiée: ${c.libelle}`, c.montant, "eleve", "Art. 39-1 CGI — charge doit être justifiée");
        chefs.push(ch);
        totalRisque += ch.total;
      }
      if (c.mixte) {
        const base = c.montant * 0.5;
        const ch = chef("Axe 1", `Quote-part personnelle: ${c.libelle}`, base, "moyen", "Art. 39-1-1 CGI — charges mixtes à proratiser");
        chefs.push(ch);
        totalRisque += ch.total;
      }
      if (c.nature === "repas" && c.montant > 20 * 200) {
        const exces = c.montant - 20 * 200;
        const ch = chef("Axe 1", `Frais de repas excessifs: ${c.libelle}`, exces, "moyen", "BOFiP BIC-CHG-40-20 — seuil raisonnable");
        chefs.push(ch);
        totalRisque += ch.total;
      }
    }

    const text = [
      `## Axe 1 — Déductibilité des charges`,
      ``,
      chefs.length === 0
        ? `✅ Aucun chef de redressement identifié sur les charges analysées.`
        : [
          `**${chefs.length} chef(s) de redressement potentiel(s)**`,
          ``,
          `| Libellé | Base | IS (25%) | Majoration | Total | Risque |`,
          `|---|---|---|---|---|---|`,
          ...chefs.map(c => `| ${c.libelle} | ${c.base.toFixed(0)} € | ${c.rappel_is.toFixed(0)} € | ${c.majoration.toFixed(0)} € | **${c.total.toFixed(0)} €** | ${c.risque} |`),
          `| **TOTAL** | | | | **${totalRisque.toFixed(0)} €** | |`,
        ].join("\n"),
      ``,
      `→ Utilisez \`fiscal_generate_report\` pour le rapport complet`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("fiscal_check_tva", {
    description: "Axe 2 DGFIP — Rapprochement TVA: cohérence CA déclaré vs TVA collectée, TVA déduite sur charges, taux appliqués.",
    inputSchema: {
      regime_tva: z.string(),
      ca_ht_compta: z.number().describe("CA HT selon comptabilité"),
      tva_collectee_declaree: z.number().describe("TVA collectée selon déclarations CA3/CA12"),
      tva_deductible_declaree: z.number().describe("TVA déductible selon déclarations"),
      taux_tva_principal: z.number().describe("Taux TVA principal appliqué (ex: 0.20)"),
      achats_ht: z.number().optional().describe("Total achats HT"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const tva_theorique = args.ca_ht_compta * args.taux_tva_principal;
    const ecart = Math.abs(tva_theorique - args.tva_collectee_declaree);
    const ecart_pct = tva_theorique > 0 ? (ecart / tva_theorique * 100).toFixed(1) : "0";
    const alert = ecart > 500 && parseFloat(ecart_pct) > 2;

    const tva_theorique_deductible = args.achats_ht ? args.achats_ht * args.taux_tva_principal : null;
    const ecart_deductible = tva_theorique_deductible
      ? Math.abs(tva_theorique_deductible - args.tva_deductible_declaree)
      : null;

    const text = [
      `## Axe 2 — Contrôle TVA`,
      `Régime: ${args.regime_tva}`,
      ``,
      `| | Théorique | Déclaré | Écart | Statut |`,
      `|---|---|---|---|---|`,
      `| TVA collectée | ${tva_theorique.toFixed(2)} € | ${args.tva_collectee_declaree.toFixed(2)} € | ${ecart.toFixed(2)} € (${ecart_pct}%) | ${alert ? "🔴" : "✅"} |`,
      tva_theorique_deductible ? `| TVA déductible | ${tva_theorique_deductible.toFixed(2)} € | ${args.tva_deductible_declaree.toFixed(2)} € | ${(ecart_deductible ?? 0).toFixed(2)} € | ${(ecart_deductible ?? 0) > 500 ? "🟡" : "✅"} |` : "",
      ``,
      alert
        ? `🔴 **Écart significatif TVA collectée** — Rappel potentiel: ${(ecart * 1.10).toFixed(0)} € (TVA + 10% majoration)\nBase légale: Art. 283 CGI`
        : `✅ TVA collectée cohérente avec le CA comptable`,
    ].filter(l => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("fiscal_generate_report", {
    description: "Génère le rapport de contrôle fiscal complet avec tous les chefs de redressement, bases légales et montants totaux.",
    inputSchema: {
      company_name: z.string(),
      siren: z.string(),
      exercice: z.string().describe("Ex: 2025 ou 01/01/2025-31/12/2025"),
      chefs_redressement: z.array(z.object({
        axe: z.string(),
        libelle: z.string(),
        base: z.number(),
        montant_is: z.number(),
        majoration: z.number(),
        base_legale: z.string(),
        risque: z.enum(["faible", "moyen", "eleve"]),
      })).describe("Chefs de redressement identifiés"),
      observations: z.string().optional().describe("Observations générales"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const total_base = args.chefs_redressement.reduce((s, c) => s + c.base, 0);
    const total_is = args.chefs_redressement.reduce((s, c) => s + c.montant_is, 0);
    const total_maj = args.chefs_redressement.reduce((s, c) => s + c.majoration, 0);
    const total = total_is + total_maj;
    const risqueMax = args.chefs_redressement.some(c => c.risque === "eleve") ? "🔴 ÉLEVÉ"
      : args.chefs_redressement.some(c => c.risque === "moyen") ? "🟡 MOYEN" : "🟢 FAIBLE";

    const today = new Date().toISOString().slice(0, 10);

    const text = [
      `# Rapport de Contrôle Fiscal Simulé`,
      `**${args.company_name}** — SIREN ${args.siren}`,
      `Exercice: ${args.exercice} | Rapport établi le ${today}`,
      `Risque global: ${risqueMax}`,
      ``,
      `## Propositions de rectification`,
      ``,
      `| N° | Axe | Chef de redressement | Base | IS (25%) | Maj. 10% | Total | Risque |`,
      `|---|---|---|---|---|---|---|---|`,
      ...args.chefs_redressement.map((c, i) =>
        `| ${i + 1} | ${c.axe} | ${c.libelle} | ${c.base.toFixed(0)} € | ${c.montant_is.toFixed(0)} € | ${c.majoration.toFixed(0)} € | **${(c.montant_is + c.majoration).toFixed(0)} €** | ${c.risque} |`
      ),
      `| | | **TOTAL** | **${total_base.toFixed(0)} €** | **${total_is.toFixed(0)} €** | **${total_maj.toFixed(0)} €** | **${total.toFixed(0)} €** | |`,
      ``,
      `## Bases légales`,
      ...args.chefs_redressement.map(c => `- ${c.libelle}: ${c.base_legale}`),
      ``,
      args.observations ? `## Observations\n${args.observations}` : "",
      ``,
      `---`,
      `*Simulation DGFIP à titre préventif — Ne constitue pas une proposition de rectification officielle.*`,
      `*Consultez un avocat fiscaliste avant toute réponse à l'administration fiscale.*`,
    ].filter(l => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
