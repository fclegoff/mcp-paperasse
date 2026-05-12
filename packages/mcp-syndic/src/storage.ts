import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface Lot {
  id: string;
  numero: string;
  type: "appartement" | "parking" | "cave" | "commerce" | "autre";
  tantieme: number;
  proprietaire: string;
  email?: string;
  solde_charges: number; // positif = doit de l'argent
}

export interface AppelFonds {
  id: string;
  date: string;
  libelle: string;
  montant_total: number;
  lignes: Array<{ lot_id: string; montant: number; paye: boolean; date_paiement?: string }>;
}

export interface Copro {
  id: string;
  slug: string;
  nom: string;
  adresse: string;
  nb_lots: number;
  tantieme_total: number;
  lots: Lot[];
  appels_fonds: AppelFonds[];
  syndicats_nom?: string;
  immatriculation_rnc?: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_PATH = join(homedir(), ".mcp-syndic", "data.json");

function getStorePath(): string { return process.env.MCP_SYNDIC_STORE ?? DEFAULT_PATH; }

function ensureDir(p: string) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function load(): { copros: Copro[] } {
  const p = getStorePath();
  if (!existsSync(p)) return { copros: [] };
  try { return JSON.parse(readFileSync(p, "utf-8")); }
  catch { return { copros: [] }; }
}

function save(data: { copros: Copro[] }) {
  const p = getStorePath();
  ensureDir(p);
  writeFileSync(p, JSON.stringify(data, null, 2));
}

export function listCopros(): Copro[] { return load().copros; }

export function getCopro(slug: string): Copro | null {
  return load().copros.find(c => c.slug === slug || c.id === slug || c.nom.toLowerCase().includes(slug.toLowerCase())) ?? null;
}

export function createCopro(data: Omit<Copro, "id" | "createdAt" | "updatedAt" | "lots" | "appels_fonds">): Copro {
  const db = load();
  const copro: Copro = { ...data, id: randomUUID(), lots: [], appels_fonds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.copros.push(copro);
  save(db);
  return copro;
}

export function addLot(copro_slug: string, lot: Omit<Lot, "id">): Lot | null {
  const db = load();
  const copro = db.copros.find(c => c.slug === copro_slug);
  if (!copro) return null;
  const l: Lot = { ...lot, id: randomUUID() };
  copro.lots.push(l);
  copro.updatedAt = new Date().toISOString();
  save(db);
  return l;
}

export function createAppelFonds(copro_slug: string, libelle: string, date: string, budget_total: number): AppelFonds | null {
  const db = load();
  const copro = db.copros.find(c => c.slug === copro_slug);
  if (!copro) return null;

  const total_tantiemes = copro.lots.reduce((s, l) => s + l.tantieme, 0) || copro.tantieme_total;
  const lignes = copro.lots.map(l => ({
    lot_id: l.id,
    montant: Math.round(budget_total * (l.tantieme / total_tantiemes) * 100) / 100,
    paye: false,
  }));

  const appel: AppelFonds = { id: randomUUID(), date, libelle, montant_total: budget_total, lignes };
  copro.appels_fonds.push(appel);
  copro.updatedAt = new Date().toISOString();
  save(db);
  return appel;
}

export function markLotPaid(copro_slug: string, appel_id: string, lot_id: string, date: string): boolean {
  const db = load();
  const copro = db.copros.find(c => c.slug === copro_slug);
  if (!copro) return false;
  const appel = copro.appels_fonds.find(a => a.id === appel_id);
  if (!appel) return false;
  const ligne = appel.lignes.find(l => l.lot_id === lot_id);
  if (!ligne) return false;
  ligne.paye = true;
  ligne.date_paiement = date;
  // update lot solde
  const lot = copro.lots.find(l => l.id === lot_id);
  if (lot) lot.solde_charges = Math.max(0, lot.solde_charges - ligne.montant);
  copro.updatedAt = new Date().toISOString();
  save(db);
  return true;
}

export function getImpayes(copro_slug: string): Array<{ lot: Lot; montant: number; nb_appels: number }> {
  const copro = getCopro(copro_slug);
  if (!copro) return [];

  const map = new Map<string, { montant: number; nb: number }>();
  for (const appel of copro.appels_fonds) {
    for (const ligne of appel.lignes) {
      if (!ligne.paye) {
        const cur = map.get(ligne.lot_id) ?? { montant: 0, nb: 0 };
        map.set(ligne.lot_id, { montant: cur.montant + ligne.montant, nb: cur.nb + 1 });
      }
    }
  }

  return Array.from(map.entries())
    .map(([lot_id, data]) => {
      const lot = copro.lots.find(l => l.id === lot_id);
      return lot ? { lot, montant: data.montant, nb_appels: data.nb } : null;
    })
    .filter(Boolean) as Array<{ lot: Lot; montant: number; nb_appels: number }>;
}
