import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface CompanyBankDetails {
  iban: string;
  bic: string;
  iban_revolut?: string;
  bic_revolut?: string;
}

export interface CompanyInvoicing {
  prefix: string;
  separator: string;
  year_format: string;
  format: string;
  format_example?: string;
  next_sequential: number;
  avoir_prefix: string;
}

export interface CompanyConfig {
  name: string;
  legal_form: string;
  capital: number;
  address: string;
  siren: string;
  siret: string;
  rcs: string;
  naf: string;
  naf_label?: string;
  tva_intracom: string;
  president: {
    title: string;
    first_name: string;
    last_name: string;
    civility: string;
  };
  fiscal_year: {
    start: string;
    end: string;
    is_first_year: boolean;
    date_creation?: string;
  };
  tax: {
    regime_is: string;
    regime_tva: string;
    tva_declaration: string;
    tva_periodicite: string;
    tva_rate: number;
    rof_tva?: string;
    rof_is?: string;
  };
  banks: Array<{
    id: string;
    name: string;
    account: string;
    fec_account: string;
    type: "api" | "import";
    import_dir?: string;
  }>;
  invoicing: CompanyInvoicing;
  einvoicing: {
    pa: string;
    pa_name: string;
    peppol_id: string;
    reception_ready: boolean;
    emission_ready: boolean;
    ereporting_ready: boolean;
  };
  payment: {
    default_terms: string;
    default_terms_label: string;
    methods: string[];
    bank_details: CompanyBankDetails;
    late_penalty_rate: string;
    late_penalty_label: string;
    escompte: string;
    recovery_fee: number;
  };
}

let _cache: CompanyConfig | null = null;

export function loadCompany(): CompanyConfig {
  if (_cache) return _cache;

  const envPath = process.env.COMPANY_JSON_PATH;
  const candidates = [
    envPath,
    "./company.json",
    "../company.json",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (existsSync(abs)) {
      try {
        _cache = JSON.parse(readFileSync(abs, "utf-8")) as CompanyConfig;
        return _cache;
      } catch (err) {
        throw new Error(`company.json invalide à ${abs}: ${err}`);
      }
    }
  }

  throw new Error(
    "company.json introuvable. Définissez COMPANY_JSON_PATH ou placez company.json dans le répertoire courant. " +
    "Voir https://agentskill.sh/skillsets/paperasse pour le setup."
  );
}

export function getCompanySafe(): CompanyConfig | null {
  try {
    return loadCompany();
  } catch {
    return null;
  }
}
