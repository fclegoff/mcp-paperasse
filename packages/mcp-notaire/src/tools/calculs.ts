import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerNotaireTools(server: McpServer): void {

  server.registerTool("notaire_frais_achat", {
    description: "Calcule les frais de notaire pour un achat immobilier (DMTO, émoluments, débours, CSI). Distingue neuf/ancien, Paris/province.",
    inputSchema: {
      prix_achat: z.number().describe("Prix de vente en €"),
      neuf: z.boolean().describe("Bien neuf (< 5 ans) ou ancien"),
      departement: z.string().optional().describe("Numéro de département (ex: '75', '69'). Défaut: taux standard"),
      pret_montant: z.number().optional().describe("Montant du prêt immobilier (pour frais de garantie)"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const p = args.prix_achat;
    const neuf = args.neuf;

    // DMTO (droits de mutation)
    let dmto = 0;
    if (!neuf) {
      // Taux ancien: ~5.80% (taux normal) ou 5.09% (départements non majorés)
      const dept = args.departement ?? "std";
      const taux = ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","21","22","23","24","25","26","27","28","29","2A","2B","30","31","32","33","34","35","36","37","38","39","40","41","42","43","44","45","46","47","48","49","50","51","52","53","54","55","56","57","58","59","60","61","62","63","64","65","66","67","68","69","70","71","72","73","74","75","76","77","78","79","80","81","82","83","84","85","86","87","88","89","90","91","92","93","94","95","971","972","973","974"].includes(dept) ? 0.0580 : 0.0580;
      dmto = p * taux;
    } else {
      dmto = p * 0.007; // TVA payée, DMTO réduit ~0.7%
    }

    // Émoluments notaire (barème 2024, dégressif)
    let emoluments = 0;
    const tranches = [
      { seuil: 6_500, taux: 0.03945 },
      { seuil: 17_000, taux: 0.01627 },
      { seuil: 60_000, taux: 0.01085 },
      { seuil: Infinity, taux: 0.00814 },
    ];
    let reste = p;
    let precedent = 0;
    for (const t of tranches) {
      const tranche = Math.min(reste, t.seuil - precedent);
      if (tranche <= 0) break;
      emoluments += tranche * t.taux;
      reste -= tranche;
      precedent = t.seuil;
      if (reste <= 0) break;
    }
    emoluments = Math.max(emoluments, 90); // minimum légal

    // CSI (contribution de sécurité immobilière) = 0.1% du prix
    const csi = p * 0.001;

    // Débours (forfait estimatif)
    const debours = 800 + (p > 500000 ? 500 : 0);

    // Frais de garantie prêt (estimation hypothèque ou caution)
    const frais_garantie = args.pret_montant ? args.pret_montant * 0.015 : 0;

    const total = dmto + emoluments + csi + debours + frais_garantie;
    const pctPrix = (total / p * 100).toFixed(1);

    const text = [
      `## Frais de Notaire — Achat Immobilier`,
      `Prix: ${p.toLocaleString("fr-FR")} € | ${neuf ? "Bien neuf (TVA)" : "Bien ancien"} | Dept: ${args.departement ?? "standard"}`,
      ``,
      `| Poste | Montant | % prix |`,
      `|---|---|---|`,
      `| DMTO (droits mutation) | ${dmto.toFixed(0)} € | ${(dmto/p*100).toFixed(2)}% |`,
      `| Émoluments notaire | ${emoluments.toFixed(0)} € | ${(emoluments/p*100).toFixed(2)}% |`,
      `| CSI | ${csi.toFixed(0)} € | 0.10% |`,
      `| Débours | ${debours.toFixed(0)} € | forfait |`,
      args.pret_montant ? `| Frais garantie prêt | ${frais_garantie.toFixed(0)} € | estimatif |` : "",
      `| **TOTAL** | **${total.toFixed(0)} €** | **${pctPrix}%** |`,
      ``,
      `Budget total acquisition: **${(p + total).toLocaleString("fr-FR")} €**`,
      ``,
      `⚠️ *Estimation — les frais exacts dépendent de la nature du bien, de la commune et des actes annexes. Vérifier avec le notaire.*`,
    ].filter(l => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("notaire_plus_value_immo", {
    description: "Calcule la plus-value immobilière nette imposable et l'impôt dû (IR 19% + PS 17.2%). Abattements pour durée de détention.",
    inputSchema: {
      prix_acquisition: z.number().describe("Prix d'achat initial en €"),
      frais_acquisition: z.number().optional().describe("Frais d'acquisition (notaire, agence). Défaut: forfait 7.5%"),
      travaux: z.number().optional().describe("Travaux capitalisables en €. Défaut: forfait 15% si >5 ans"),
      prix_cession: z.number().describe("Prix de vente en €"),
      frais_cession: z.number().optional().describe("Frais de vente (agence...) en €"),
      duree_detention_ans: z.number().describe("Durée de détention en années"),
      residence_principale: z.boolean().describe("Résidence principale au moment de la vente?"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    if (args.residence_principale) {
      return { content: [{ type: "text" as const, text: "✅ **Exonération totale** — Résidence principale (art. 150 U II 1° CGI)" }] };
    }

    const fraisAcq = args.frais_acquisition ?? args.prix_acquisition * 0.075;
    const travaux = args.travaux ?? (args.duree_detention_ans > 5 ? args.prix_acquisition * 0.15 : 0);
    const fraisCession = args.frais_cession ?? 0;

    const prix_revient = args.prix_acquisition + fraisAcq + travaux;
    const pv_brute = args.prix_cession - fraisCession - prix_revient;

    if (pv_brute <= 0) {
      return { content: [{ type: "text" as const, text: `✅ **Moins-value** de ${Math.abs(pv_brute).toFixed(0)} € — Pas d'imposition` }] };
    }

    // Abattements IR (19%)
    const abatIR = (ans: number) => {
      if (ans <= 5) return 0;
      if (ans <= 21) return (ans - 5) * 0.06;
      if (ans === 22) return 0.96;
      return 1.00; // exonération totale à 22 ans pour IR
    };

    // Abattements PS (17.2%)
    const abatPS = (ans: number) => {
      if (ans <= 5) return 0;
      if (ans <= 21) return (ans - 5) * 0.0165;
      if (ans === 22) return 0.264;
      if (ans <= 29) return 0.264 + (ans - 22) * 0.09;
      return 1.00; // exonération totale à 30 ans pour PS
    };

    const d = Math.floor(args.duree_detention_ans);
    const pvNetIR = pv_brute * (1 - abatIR(d));
    const pvNetPS = pv_brute * (1 - abatPS(d));
    const impotIR = pvNetIR > 0 ? pvNetIR * 0.19 : 0;
    const impotPS = pvNetPS > 0 ? pvNetPS * 0.172 : 0;
    const total = impotIR + impotPS;

    const text = [
      `## Plus-Value Immobilière`,
      ``,
      `| | Montant |`,
      `|---|---|`,
      `| Prix de revient | ${prix_revient.toFixed(0)} € |`,
      `| Prix de cession net | ${(args.prix_cession - fraisCession).toFixed(0)} € |`,
      `| **Plus-value brute** | **${pv_brute.toFixed(0)} €** |`,
      ``,
      `**Détention: ${d} ans**`,
      `| | PV imposable | Abattement | Impôt |`,
      `|---|---|---|---|`,
      `| IR (19%) | ${pvNetIR.toFixed(0)} € | ${Math.round(abatIR(d)*100)}% | ${impotIR.toFixed(0)} € |`,
      `| Prélèvements sociaux (17.2%) | ${pvNetPS.toFixed(0)} € | ${Math.round(abatPS(d)*100)}% | ${impotPS.toFixed(0)} € |`,
      `| **TOTAL IMPÔT** | | | **${total.toFixed(0)} €** |`,
      ``,
      `Net vendeur après impôt: **${(args.prix_cession - fraisCession - total).toFixed(0)} €**`,
      d >= 22 && d < 30 ? `\nℹ️ Exonération IR totale depuis ${22} ans de détention. Exonération PS totale à 30 ans.` : "",
    ].filter(l => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("notaire_droits_succession", {
    description: "Calcule les droits de succession ou donation selon le lien de parenté et les abattements légaux (2026).",
    inputSchema: {
      valeur_nette: z.number().describe("Valeur nette de la succession/donation en €"),
      lien: z.enum(["enfant", "conjoint_partenaire", "frere_soeur", "neveu_niece", "autre_parent", "tiers"]).describe("Lien entre défunt/donateur et bénéficiaire"),
      dons_anterieurs: z.number().optional().describe("Dons rapportables consentis dans les 15 ans en €"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const abattements: Record<string, number> = {
      enfant: 100_000,
      conjoint_partenaire: 80_724,
      frere_soeur: 15_932,
      neveu_niece: 7_967,
      autre_parent: 1_594,
      tiers: 1_594,
    };

    const baremes: Record<string, Array<[number, number]>> = {
      enfant: [[8_072, 0.05],[12_109, 0.10],[15_932, 0.15],[552_324, 0.20],[902_838, 0.30],[1_805_677, 0.40],[Infinity, 0.45]],
      conjoint_partenaire: [[0, 0]], // exonéré totalement
      frere_soeur: [[24_430, 0.35],[Infinity, 0.45]],
      neveu_niece: [[Infinity, 0.55]],
      autre_parent: [[Infinity, 0.55]],
      tiers: [[Infinity, 0.60]],
    };

    if (args.lien === "conjoint_partenaire") {
      return { content: [{ type: "text" as const, text: "✅ **Exonération totale** — Conjoint ou partenaire PACS (art. 796-0 bis CGI)" }] };
    }

    const abattement = abattements[args.lien] ?? 1_594;
    const dons = args.dons_anterieurs ?? 0;
    const abat_restant = Math.max(0, abattement - dons);
    const base_taxable = Math.max(0, args.valeur_nette - abat_restant);

    const bareme = baremes[args.lien] ?? baremes.tiers;
    let droits = 0;
    let reste = base_taxable;
    let prev = 0;

    if (bareme.length === 1 && bareme[0][0] === 0) {
      droits = 0;
    } else {
      for (const [seuil, taux] of bareme) {
        const tranche = Math.min(reste, seuil - prev);
        if (tranche <= 0) break;
        droits += tranche * taux;
        reste -= tranche;
        prev = seuil;
        if (reste <= 0) break;
      }
    }

    const text = [
      `## Droits de Succession/Donation`,
      `Lien: ${args.lien} | Valeur nette: ${args.valeur_nette.toLocaleString("fr-FR")} €`,
      ``,
      `| | Montant |`,
      `|---|---|`,
      `| Abattement légal | ${abattement.toLocaleString("fr-FR")} € |`,
      dons > 0 ? `| Dons rapportables (15 ans) | ${dons.toLocaleString("fr-FR")} € |` : "",
      `| Abattement restant | ${abat_restant.toLocaleString("fr-FR")} € |`,
      `| **Base taxable** | **${base_taxable.toLocaleString("fr-FR")} €** |`,
      `| **Droits à payer** | **${droits.toFixed(0)} €** |`,
      `| Taux effectif | ${base_taxable > 0 ? (droits/base_taxable*100).toFixed(1) : 0}% |`,
      ``,
      `⚠️ *Ces calculs sont indicatifs. Consultez un notaire pour les successions complexes (usufruit, PACS, testament, donations-partages).*`,
    ].filter(l => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("notaire_demembrement", {
    description: "Calcule la valeur de l'usufruit et de la nue-propriété selon le barème fiscal (art. 669 CGI) et l'âge de l'usufruitier.",
    inputSchema: {
      valeur_pleine_propriete: z.number().describe("Valeur en pleine propriété en €"),
      age_usufruitier: z.number().describe("Âge de l'usufruitier au jour de la donation"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const bareme = [
      [20, 0.90], [30, 0.80], [40, 0.70], [50, 0.60],
      [60, 0.50], [70, 0.40], [80, 0.30], [90, 0.20], [Infinity, 0.10],
    ] as [number, number][];

    const taux_usufruit = bareme.find(([age]) => args.age_usufruitier < age)?.[1] ?? 0.10;
    const taux_nue = 1 - taux_usufruit;
    const val_usuf = args.valeur_pleine_propriete * taux_usufruit;
    const val_nue = args.valeur_pleine_propriete * taux_nue;

    const text = [
      `## Démembrement de Propriété`,
      `Valeur PP: ${args.valeur_pleine_propriete.toLocaleString("fr-FR")} € | Âge usufruitier: ${args.age_usufruitier} ans`,
      ``,
      `| | Taux (art. 669 CGI) | Valeur |`,
      `|---|---|---|`,
      `| Usufruit | ${Math.round(taux_usufruit * 100)}% | ${val_usuf.toFixed(0)} € |`,
      `| Nue-propriété | ${Math.round(taux_nue * 100)}% | **${val_nue.toFixed(0)} €** |`,
      ``,
      `La donation de la nue-propriété (${val_nue.toFixed(0)} €) sera la base de calcul des droits de donation.`,
      `À l'extinction de l'usufruit, le nu-propriétaire récupère la pleine propriété sans impôt supplémentaire.`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });

  server.registerTool("notaire_frais_sci", {
    description: "Estime les frais de création d'une SCI (statuts, enregistrement, publication, immatriculation) et les apports.",
    inputSchema: {
      apport_numeraire: z.number().optional().describe("Apport en numéraire en €"),
      apport_immobilier: z.number().optional().describe("Apport d'immeuble en € (génère des DMTO si à titre onéreux)"),
      nb_associes: z.number().describe("Nombre d'associés"),
      type_sci: z.enum(["IR", "IS"]).describe("Régime fiscal de la SCI"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const frais_statuts = 1_500; // rédaction notaire ou avocat
    const enregistrement = 125; // droit fixe enregistrement
    const publication_journal = 150;
    const greffe = 66.77;
    const apport_immo = args.apport_immobilier ?? 0;
    const dmto_apport = apport_immo > 0 ? apport_immo * 0.005 : 0; // droit fixe 500€ si apport pur

    const total = frais_statuts + enregistrement + publication_journal + greffe + dmto_apport;

    const text = [
      `## Création SCI — Frais estimés`,
      `${args.nb_associes} associés | Régime: SCI à l'${args.type_sci}`,
      ``,
      `| Poste | Montant |`,
      `|---|---|`,
      `| Rédaction statuts | ${frais_statuts} € |`,
      `| Enregistrement | ${enregistrement} € |`,
      `| Publication JAL | ${publication_journal} € |`,
      `| Immatriculation greffe | ${greffe.toFixed(2)} € |`,
      apport_immo > 0 ? `| Frais apport immobilier | ${dmto_apport.toFixed(0)} € |` : "",
      `| **TOTAL** | **${total.toFixed(0)} €** |`,
      ``,
      `Capital: ${((args.apport_numeraire ?? 0) + apport_immo).toLocaleString("fr-FR")} €`,
      ``,
      args.type_sci === "IS"
        ? `ℹ️ SCI à l'IS: amortissement possible des immeubles, mais imposition des plus-values comme une société (pas d'abattement durée).`
        : `ℹ️ SCI à l'IR: transparence fiscale, associés imposés à titre personnel. Plus-values immobilières privées avec abattements pour durée.`,
    ].filter(l => l !== "").join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
