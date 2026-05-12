import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCompany } from "../company.js";

type Urgency = "imminent" | "proche" | "normal";

interface Deadline {
  date: string;
  label: string;
  urgency: Urgency;
}

function getDeadlines(tva_periodicite: string, regime_is: string, today: Date): Deadline[] {
  const deadlines: Array<{ date: string; label: string }> = [];
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  if (tva_periodicite === "mensuelle") {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    deadlines.push({
      date: `${nextYear}-${String(nextMonth).padStart(2, "0")}-24`,
      label: `CA3 TVA — déclaration ${String(month).padStart(2, "0")}/${year}`,
    });
  } else if (tva_periodicite === "trimestrielle") {
    const quarter = Math.ceil(month / 3);
    const endMonth = quarter * 3;
    const dueMonth = endMonth === 12 ? 1 : endMonth + 1;
    const dueYear = endMonth === 12 ? year + 1 : year;
    deadlines.push({
      date: `${dueYear}-${String(dueMonth).padStart(2, "0")}-24`,
      label: `CA3 TVA — déclaration T${quarter} ${year}`,
    });
  } else {
    deadlines.push({
      date: `${year + 1}-05-03`,
      label: `CA12 TVA — déclaration annuelle ${year}`,
    });
  }

  if (regime_is === "reel_simplifie") {
    deadlines.push(
      { date: `${year}-04-30`, label: `IS — 1er acompte (si CA > 763k€)` },
      { date: `${year}-10-31`, label: `IS — 2e acompte (si CA > 763k€)` },
      { date: `${year + 1}-05-15`, label: `IS — solde exercice ${year} + liasse fiscale 2065` }
    );
  }

  deadlines.push(
    { date: `${year}-12-15`, label: `CFE — paiement annuel` },
    { date: "2026-09-01", label: `⚠️ E-FACTURATION — réception obligatoire (toutes entreprises TVA)` }
  );

  const daysDiff = (d: string) => Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000);

  return deadlines
    .filter((d) => daysDiff(d.date) >= -7)
    .map((d): Deadline => {
      const diff = daysDiff(d.date);
      const urgency: Urgency = diff <= 7 ? "imminent" : diff <= 30 ? "proche" : "normal";
      return { date: d.date, label: d.label, urgency };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function registerFiscalDeadlines(server: McpServer): void {
  server.registerTool("get_fiscal_deadlines", {
    description: "Retourne les prochaines échéances fiscales (TVA, IS, CFE, e-facturation) adaptées au régime de la société.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const company = loadCompany();
    const today = new Date();
    const deadlines = getDeadlines(company.tax.tva_periodicite, company.tax.regime_is, today);

    const icon: Record<Urgency, string> = { imminent: "🔴", proche: "🟡", normal: "🟢" };

    const text = [
      `**Échéances fiscales — ${company.name}**`,
      `TVA: ${company.tax.regime_tva} ${company.tax.tva_periodicite} | IS: ${company.tax.regime_is}`,
      ``,
      ...deadlines.map((d) => `${icon[d.urgency]} **${d.date}** — ${d.label}`),
      ``,
      `🔴 ≤7j | 🟡 ≤30j | 🟢 normal`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  });
}
