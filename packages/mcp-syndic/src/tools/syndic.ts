import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listCopros, getCopro, createCopro, addLot, createAppelFonds, markLotPaid, getImpayes } from "../storage.js";

export function registerSyndicTools(server: McpServer): void {

  server.registerTool("syndic_list_copros", {
    description: "Liste toutes les copropriétés du portfolio avec tableau de bord consolidé (impayés, prochains appels).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const copros = listCopros();
    if (copros.length === 0) {
      return { content: [{ type: "text" as const, text: "Aucune copropriété configurée. Utilisez `syndic_create_copro` pour commencer." }] };
    }
    const rows = copros.map(c => {
      const impayes = getImpayes(c.slug);
      const total_impayes = impayes.reduce((s, i) => s + i.montant, 0);
      return `**${c.nom}** (${c.slug}) | ${c.nb_lots} lots | ${c.adresse} | Impayés: ${total_impayes > 0 ? `🔴 ${total_impayes.toFixed(0)} €` : "✅ 0 €"}`;
    });
    return { content: [{ type: "text" as const, text: `# Portfolio — ${copros.length} copropriété(s)\n\n${rows.join("\n")}` }] };
  });

  server.registerTool("syndic_create_copro", {
    description: "Crée une nouvelle copropriété dans le portfolio.",
    inputSchema: {
      nom: z.string().describe("Nom de la copropriété (ex: '12 rue des Fleurs')"),
      slug: z.string().describe("Identifiant court sans espaces (ex: 'fleurs-12')"),
      adresse: z.string(),
      nb_lots: z.number().describe("Nombre total de lots"),
      tantieme_total: z.number().optional().describe("Total des tantièmes. Défaut: 10000"),
      immatriculation_rnc: z.string().optional().describe("Numéro RNC (registre national copropriétés)"),
    },
    annotations: { readOnlyHint: false },
  }, async (args) => {
    const copro = createCopro({
      slug: args.slug, nom: args.nom, adresse: args.adresse,
      nb_lots: args.nb_lots, tantieme_total: args.tantieme_total ?? 10000,
      immatriculation_rnc: args.immatriculation_rnc,
    });
    return { content: [{ type: "text" as const, text: `✅ Copropriété créée: **${copro.nom}** (${copro.slug})\nAjoutez les lots avec \`syndic_add_lot\`` }] };
  });

  server.registerTool("syndic_add_lot", {
    description: "Ajoute un lot (appartement, parking, cave...) à une copropriété.",
    inputSchema: {
      copro_slug: z.string(),
      numero: z.string().describe("Numéro ou référence du lot (ex: 'A12', '3ème gauche')"),
      type: z.enum(["appartement", "parking", "cave", "commerce", "autre"]),
      tantieme: z.number().describe("Tantièmes du lot"),
      proprietaire: z.string().describe("Nom du propriétaire"),
      email: z.string().optional(),
    },
    annotations: { readOnlyHint: false },
  }, async (args) => {
    const lot = addLot(args.copro_slug, {
      numero: args.numero, type: args.type, tantieme: args.tantieme,
      proprietaire: args.proprietaire, email: args.email, solde_charges: 0,
    });
    if (!lot) return { content: [{ type: "text" as const, text: `❌ Copropriété "${args.copro_slug}" introuvable.` }] };
    return { content: [{ type: "text" as const, text: `✅ Lot ${args.numero} (${args.type}, ${args.tantieme} tantièmes) ajouté — Propriétaire: ${args.proprietaire}` }] };
  });

  server.registerTool("syndic_create_appel_fonds", {
    description: "Crée un appel de fonds et répartit les montants entre les lots selon les tantièmes.",
    inputSchema: {
      copro_slug: z.string(),
      libelle: z.string().describe("Libellé (ex: 'Appel T1 2026 — charges courantes')"),
      date: z.string().describe("Date de l'appel YYYY-MM-DD"),
      budget_total: z.number().describe("Montant total à répartir en €"),
    },
    annotations: { readOnlyHint: false },
  }, async (args) => {
    const appel = createAppelFonds(args.copro_slug, args.libelle, args.date, args.budget_total);
    if (!appel) return { content: [{ type: "text" as const, text: `❌ Copropriété "${args.copro_slug}" introuvable.` }] };

    const copro = getCopro(args.copro_slug)!;
    const rows = appel.lignes.slice(0, 10).map(l => {
      const lot = copro.lots.find(lo => lo.id === l.lot_id);
      return `- ${lot?.numero ?? l.lot_id} (${lot?.proprietaire ?? "?"}) : ${l.montant.toFixed(2)} €`;
    });

    return {
      content: [{
        type: "text" as const,
        text: [
          `✅ **Appel créé: ${appel.libelle}**`,
          `Date: ${appel.date} | Total: ${appel.montant_total.toFixed(2)} € | ${appel.lignes.length} lots`,
          ``,
          ...rows,
          appel.lignes.length > 10 ? `... et ${appel.lignes.length - 10} autres` : "",
        ].filter(Boolean).join("\n"),
      }],
    };
  });

  server.registerTool("syndic_mark_paid", {
    description: "Marque un lot comme ayant payé un appel de fonds.",
    inputSchema: {
      copro_slug: z.string(),
      appel_id: z.string().describe("ID de l'appel de fonds"),
      lot_numero: z.string().describe("Numéro du lot"),
      date_paiement: z.string().optional().describe("Date YYYY-MM-DD. Défaut: aujourd'hui"),
    },
    annotations: { readOnlyHint: false },
  }, async (args) => {
    const copro = getCopro(args.copro_slug);
    if (!copro) return { content: [{ type: "text" as const, text: `❌ Copropriété introuvable.` }] };
    const lot = copro.lots.find(l => l.numero === args.lot_numero);
    if (!lot) return { content: [{ type: "text" as const, text: `❌ Lot "${args.lot_numero}" introuvable.` }] };

    const date = args.date_paiement ?? new Date().toISOString().slice(0, 10);
    const ok = markLotPaid(args.copro_slug, args.appel_id, lot.id, date);
    return { content: [{ type: "text" as const, text: ok ? `✅ Lot ${args.lot_numero} — paiement enregistré le ${date}` : `❌ Appel ou lot introuvable.` }] };
  });

  server.registerTool("syndic_impayes", {
    description: "Liste tous les impayés d'une copropriété avec propriétaire, montant et nombre d'appels non réglés.",
    inputSchema: {
      copro_slug: z.string(),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const impayes = getImpayes(args.copro_slug);
    if (impayes.length === 0) return { content: [{ type: "text" as const, text: `✅ Aucun impayé pour "${args.copro_slug}"` }] };

    const total = impayes.reduce((s, i) => s + i.montant, 0);
    const rows = impayes
      .sort((a, b) => b.montant - a.montant)
      .map(i => `🔴 Lot **${i.lot.numero}** — ${i.lot.proprietaire}${i.lot.email ? ` (${i.lot.email})` : ""} — **${i.montant.toFixed(2)} €** (${i.nb_appels} appel(s))`);

    return {
      content: [{
        type: "text" as const,
        text: [`**${impayes.length} lot(s) en impayé — Total: ${total.toFixed(2)} €**`, ``, ...rows].join("\n"),
      }],
    };
  });

  server.registerTool("syndic_prepare_ag", {
    description: "Prépare le squelette d'une convocation d'Assemblée Générale avec ordre du jour et majorités requises.",
    inputSchema: {
      copro_slug: z.string(),
      date_ag: z.string().describe("Date de l'AG YYYY-MM-DD"),
      heure: z.string().describe("Heure (ex: '19h00')"),
      lieu: z.string().describe("Lieu de l'AG"),
      type_ag: z.enum(["ordinaire", "extraordinaire"]).describe("Type d'AG"),
      points_ordre_du_jour: z.array(z.object({
        titre: z.string(),
        type_vote: z.enum(["art24", "art25", "art25-1", "art26", "unanimite"]).describe("art24=majorité simple, art25=majorité absolue, art25-1=double vote, art26=double majorité"),
      })).describe("Points à l'ordre du jour avec type de vote requis"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const copro = getCopro(args.copro_slug);
    const nom = copro?.nom ?? args.copro_slug;

    const majorites: Record<string, string> = {
      art24: "Art. 24 — Majorité simple des voix exprimées des présents et représentés",
      art25: "Art. 25 — Majorité absolue des voix de tous les copropriétaires",
      "art25-1": "Art. 25-1 — Double vote: si 1/3 atteint en 1er tour, 2e vote à l'art. 24",
      art26: "Art. 26 — Double majorité: 2/3 des voix + majorité en nombre de copropriétaires",
      unanimite: "Unanimité de tous les copropriétaires",
    };

    const points = args.points_ordre_du_jour.map((p, i) =>
      `${i + 1}. **${p.titre}**\n   ${majorites[p.type_vote]}`
    );

    const text = [
      `# Convocation AG ${args.type_ag.toUpperCase()} — ${nom}`,
      ``,
      `**Date:** ${args.date_ag} à ${args.heure}`,
      `**Lieu:** ${args.lieu}`,
      ``,
      `Madame, Monsieur,`,
      `Vous êtes convoqué(e) à l'Assemblée Générale ${args.type_ag} de la copropriété **${nom}**.`,
      ``,
      `## Ordre du jour`,
      ...points,
      ``,
      `## Rappel des majorités`,
      Object.entries(majorites).map(([k, v]) => `- **${k.toUpperCase()}**: ${v}`).join("\n"),
      ``,
      `*Tout copropriétaire peut se faire représenter par mandataire (art. 22). Les pouvoirs en blanc reviennent au syndic.*`,
      `*Délai légal de convocation: 21 jours minimum avant l'AG.*`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
