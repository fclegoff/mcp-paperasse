import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type InvoiceType = "facture" | "avoir";

export interface InvoiceLine {
  designation: string;
  quantity: number;
  unit_price: number;
  tva_rate: number;
}

export interface Invoice {
  id: string;
  type: InvoiceType;
  number: string;
  date: string;           // YYYY-MM-DD
  due_date?: string;
  paid_date?: string;
  status: InvoiceStatus;
  client_name: string;
  client_siren?: string;
  client_address?: string;
  lines: InvoiceLine[];
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  notes?: string;
  ref_avoir?: string;     // for avoir: reference to original invoice
  sequential: number;
}

export type JournalCode = "VT" | "HA" | "BQ" | "BQ2" | "OD" | "AN";

export interface JournalEntry {
  id: string;
  journal_code: JournalCode;
  journal_lib: string;
  ecriture_num: string;
  ecriture_date: string;  // YYYYMMDD for FEC
  compte_num: string;
  compte_lib: string;
  comp_aux_num?: string;
  comp_aux_lib?: string;
  piece_ref?: string;
  piece_date?: string;
  ecriture_lib: string;
  debit: number;
  credit: number;
  lettrage?: string;
  date_lettrage?: string;
  valid_date?: string;
}

interface Store {
  invoices: Invoice[];
  journal_entries: JournalEntry[];
  last_sequential: number;
  updatedAt: string;
}

// ─── Storage path ─────────────────────────────────────────────────────────────

const DEFAULT_PATH = join(homedir(), ".mcp-comptable", "data.json");

function getStorePath(): string {
  return process.env.MCP_COMPTABLE_STORE ?? DEFAULT_PATH;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadStore(): Store {
  const path = getStorePath();
  if (!existsSync(path)) {
    return { invoices: [], journal_entries: [], last_sequential: 0, updatedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Store;
  } catch {
    return { invoices: [], journal_entries: [], last_sequential: 0, updatedAt: new Date().toISOString() };
  }
}

function saveStore(store: Store): void {
  const path = getStorePath();
  ensureDir(path);
  store.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Invoice number generation ────────────────────────────────────────────────

export function formatInvoiceNumber(
  sequential: number,
  format: string,
  date: string
): string {
  const d = new Date(date);
  const yyyy = d.getFullYear().toString();
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const seq = sequential.toString().padStart(6, "0");

  return format
    .replace("YYYY", yyyy)
    .replace("MM", mm)
    .replace("NNNNNN", seq)
    .replace("NNN", sequential.toString().padStart(3, "0"));
}

export function nextSequential(): number {
  const store = loadStore();
  return store.last_sequential + 1;
}

// ─── Invoice CRUD ─────────────────────────────────────────────────────────────

function computeTotals(lines: InvoiceLine[]): { ht: number; tva: number; ttc: number } {
  const ht = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const tva = lines.reduce((s, l) => s + l.quantity * l.unit_price * l.tva_rate, 0);
  return { ht: Math.round(ht * 100) / 100, tva: Math.round(tva * 100) / 100, ttc: Math.round((ht + tva) * 100) / 100 };
}

function refreshStatus(inv: Invoice): Invoice {
  if (inv.status === "paid" || inv.status === "cancelled" || inv.status === "draft") return inv;
  if (inv.paid_date) return { ...inv, status: "paid" };
  if (inv.due_date && new Date(inv.due_date) < new Date()) return { ...inv, status: "overdue" };
  return inv;
}

export function createInvoice(data: {
  type: InvoiceType;
  number: string;
  sequential: number;
  date: string;
  due_date?: string;
  client_name: string;
  client_siren?: string;
  client_address?: string;
  lines: InvoiceLine[];
  notes?: string;
  ref_avoir?: string;
}): Invoice {
  const store = loadStore();
  const totals = computeTotals(data.lines);
  const invoice: Invoice = {
    id: randomUUID(),
    type: data.type,
    number: data.number,
    sequential: data.sequential,
    date: data.date,
    due_date: data.due_date,
    status: "sent",
    client_name: data.client_name,
    client_siren: data.client_siren,
    client_address: data.client_address,
    lines: data.lines,
    total_ht: totals.ht,
    total_tva: totals.tva,
    total_ttc: totals.ttc,
    notes: data.notes,
    ref_avoir: data.ref_avoir,
  };
  store.invoices.push(invoice);
  if (data.sequential > store.last_sequential) store.last_sequential = data.sequential;
  saveStore(store);
  return invoice;
}

export function listInvoices(filter?: {
  status?: InvoiceStatus;
  type?: InvoiceType;
  client_name?: string;
  year?: number;
}): Invoice[] {
  const store = loadStore();
  return store.invoices
    .map(refreshStatus)
    .filter((inv) => {
      if (filter?.status && inv.status !== filter.status) return false;
      if (filter?.type && inv.type !== filter.type) return false;
      if (filter?.client_name && !inv.client_name.toLowerCase().includes(filter.client_name.toLowerCase())) return false;
      if (filter?.year && !inv.date.startsWith(filter.year.toString())) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getInvoice(id_or_number: string): Invoice | null {
  const store = loadStore();
  return store.invoices.find((i) => i.id === id_or_number || i.number === id_or_number) ?? null;
}

export function markInvoicePaid(id_or_number: string, paid_date: string): Invoice | null {
  const store = loadStore();
  const inv = store.invoices.find((i) => i.id === id_or_number || i.number === id_or_number);
  if (!inv) return null;
  inv.paid_date = paid_date;
  inv.status = "paid";
  saveStore(store);
  return inv;
}

export function cancelInvoice(id_or_number: string): Invoice | null {
  const store = loadStore();
  const inv = store.invoices.find((i) => i.id === id_or_number || i.number === id_or_number);
  if (!inv) return null;
  inv.status = "cancelled";
  saveStore(store);
  return inv;
}

export function getLastSequential(): number {
  return loadStore().last_sequential;
}

// ─── Journal entries ──────────────────────────────────────────────────────────

const JOURNAL_LABELS: Record<JournalCode, string> = {
  VT: "Ventes",
  HA: "Achats",
  BQ: "Banque principale",
  BQ2: "Banque secondaire",
  OD: "Opérations diverses",
  AN: "À-nouveaux",
};

export function addJournalEntry(data: Omit<JournalEntry, "id" | "journal_lib">): JournalEntry {
  const store = loadStore();
  const entry: JournalEntry = {
    ...data,
    id: randomUUID(),
    journal_lib: JOURNAL_LABELS[data.journal_code] ?? data.journal_code,
  };
  store.journal_entries.push(entry);
  saveStore(store);
  return entry;
}

export function listJournalEntries(filter?: {
  journal_code?: JournalCode;
  compte_num?: string;
  from?: string;
  to?: string;
}): JournalEntry[] {
  const store = loadStore();
  return store.journal_entries.filter((e) => {
    if (filter?.journal_code && e.journal_code !== filter.journal_code) return false;
    if (filter?.compte_num && !e.compte_num.startsWith(filter.compte_num)) return false;
    if (filter?.from && e.ecriture_date < filter.from.replace(/-/g, "")) return false;
    if (filter?.to && e.ecriture_date > filter.to.replace(/-/g, "")) return false;
    return true;
  });
}

export function getAccountBalance(compte_prefix: string): { debit: number; credit: number; solde: number } {
  const entries = listJournalEntries({ compte_num: compte_prefix });
  const debit = entries.reduce((s, e) => s + e.debit, 0);
  const credit = entries.reduce((s, e) => s + e.credit, 0);
  return {
    debit: Math.round(debit * 100) / 100,
    credit: Math.round(credit * 100) / 100,
    solde: Math.round((debit - credit) * 100) / 100,
  };
}

export function exportFEC(year: number): string {
  const from = `${year}0101`;
  const to = `${year}1231`;
  const entries = listJournalEntries({ from: `${year}-01-01`, to: `${year}-12-31` });

  const header = "JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise";
  const rows = entries.map((e) =>
    [
      e.journal_code,
      e.journal_lib,
      e.ecriture_num,
      e.ecriture_date,
      e.compte_num,
      e.compte_lib,
      e.comp_aux_num ?? "",
      e.comp_aux_lib ?? "",
      e.piece_ref ?? "",
      e.piece_date ?? "",
      e.ecriture_lib,
      e.debit.toFixed(2).replace(".", ","),
      e.credit.toFixed(2).replace(".", ","),
      e.lettrage ?? "",
      e.date_lettrage ?? "",
      e.valid_date ?? "",
      "",
      "",
    ].join("\t")
  );

  return [header, ...rows].join("\n");
}
