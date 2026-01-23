import fs from "fs";
import path from "path";
import { supabaseAdmin } from "./supabase.js";

/**
 * Escapes XML special characters in text nodes.
 */
function xmlEscape(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Reads your template from:
 * api/_hmrc_templates/giftAidClaimTemplate.xml
 */
function readTemplate(): string {
  const templatePath = path.join(
    process.cwd(),
    "api",
    "_hmrc_templates",
    "giftAidClaimTemplate.xml"
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      "HMRC XML template not found. Create api/_hmrc_templates/giftAidClaimTemplate.xml"
    );
  }

  return fs.readFileSync(templatePath, "utf8");
}

/**
 * Format number to 2dp without currency symbols.
 */
function formatMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

/**
 * Ensure date is YYYY-MM-DD. (Assumes you store ISO dates already.)
 */
function normalizeDate(d: any): string {
  const s = String(d ?? "").trim();
  // If already YYYY-MM-DD, keep it
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try parse
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return "";

  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowIsoNoMillis(): string {
  const d = new Date();
  // HMRC sample had milliseconds, but this is ok for template use
  // If you want milliseconds, remove split(".")[0]
  return d.toISOString();
}

type ClaimRow = {
  id: string;
  charity_id: string; // DB uuid foreign key to charities.id
  period_start?: string | null;
  period_end: string;
};

type CharityRow = {
  id: string;
  name: string;
  charity_id: string; // ✅ mandatory charity identifier for HMRC XML (your new field)
  contact_email?: string | null;
};

type ClaimItemRow = {
  id: string;
  title?: string | null; // ignored in sample style
  first_name: string;
  last_name: string;
  address: string;
  postcode: string;
  donation_amount: number;
  donation_date: string; // YYYY-MM-DD
};

/**
 * Build one GAD donation row (matches the sample style you posted).
 */
function buildGadRowXml(item: ClaimItemRow): string {
  return [
    "<GAD>",
    "  <Donor>",
    `    <Fore>${xmlEscape(item.first_name)}</Fore>`,
    `    <Sur>${xmlEscape(item.last_name)}</Sur>`,
    `    <House>${xmlEscape(item.address)}</House>`,
    `    <Postcode>${xmlEscape(item.postcode)}</Postcode>`,
    "  </Donor>",
    `  <Date>${xmlEscape(normalizeDate(item.donation_date))}</Date>`,
    `  <Total>${xmlEscape(formatMoney(item.donation_amount))}</Total>`,
    "</GAD>",
  ].join("\n");
}

function earliestDonationDate(items: ClaimItemRow[]): string {
  const dates = items
    .map((it) => normalizeDate(it.donation_date))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return dates[0] || "";
}

/**
 * Replace placeholders safely and ensure none remain.
 */
function replaceAllPlaceholders(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

/**
 * Step 1 main function:
 * Generate HMRC XML for a claimId using your saved template.
 *
 * IRmark is not calculated yet (we set a placeholder). That's Step 2/3 later.
 */
export async function generateHmrcGiftAidXml(claimId: string): Promise<string> {
  const id = String(claimId || "").trim();
  if (!id) throw new Error("claimId is required");

  // 1) Load claim
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("id, charity_id, period_start, period_end")
    .eq("id", id)
    .single();

  if (claimErr || !claim) {
    throw new Error(claimErr?.message || "Claim not found");
  }

  const claimRow = claim as ClaimRow;

  // 2) Load charity (needs charity_id field you made mandatory)
  const { data: charity, error: charityErr } = await supabaseAdmin
    .from("charities")
    .select("id, name, charity_id, contact_email")
    .eq("id", claimRow.charity_id)
    .single();

  if (charityErr || !charity) {
    throw new Error(charityErr?.message || "Charity not found");
  }

  const charityRow = charity as CharityRow;

  if (!charityRow.charity_id || !String(charityRow.charity_id).trim()) {
    throw new Error(
      "Charity is missing charity_id (mandatory). Please set it on the charity record."
    );
  }

  // 3) Load claim items (adjust table name/columns here if yours differ)
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("claim_items")
    .select(
      "id, title, first_name, last_name, address, postcode, donation_amount, donation_date"
    )
    .eq("claim_id", id)
    .order("donation_date", { ascending: true });

  if (itemsErr) {
    throw new Error(itemsErr.message);
  }

  const itemRows = (items || []) as ClaimItemRow[];

  // 4) Build donation rows XML
  const donationRowsXml = itemRows.map(buildGadRowXml).join("\n");

  // 5) Compute basic derived fields
  const periodEnd = normalizeDate(claimRow.period_end);
  if (!periodEnd) throw new Error("Claim period_end is missing/invalid");

  const earliestGA = earliestDonationDate(itemRows) || periodEnd;

  // 6) Prepare template variables
  // NOTE:
  // - HMRC_REF in your sample XML refers to the charity identifier in that schema.
  // - Your portal’s claim.hmrc_reference stays separate and is filled after submission.
  const vars: Record<string, string> = {
    CORRELATION_ID: xmlEscape(claimRow.id), // safe default
    GATEWAY_TIMESTAMP: xmlEscape(nowIsoNoMillis()),

    // Sender/auth placeholders for now — later you’ll align with your transport method
    SENDER_ID: xmlEscape(process.env.HMRC_SENDER_ID || "GIFTAIDCHAR"),
    AUTH_VALUE: xmlEscape(process.env.HMRC_AUTH_VALUE || "REPLACE_ME"),

    // Charity identifier used by HMRC XML schema
    CHARID: xmlEscape(charityRow.charity_id),

    PERIOD_END: xmlEscape(periodEnd),

    // IRmark is a placeholder in Step 1 (we implement it later)
    IRMARK: xmlEscape("PENDING_IRMARK"),

    // “AuthOfficial” details:
    // Use env vars if set, else fall back to generic values.
    OFFICIAL_FORE: xmlEscape(process.env.HMRC_OFFICIAL_FORE || "Portal"),
    OFFICIAL_SUR: xmlEscape(process.env.HMRC_OFFICIAL_SUR || "Operator"),
    OFFICIAL_POSTCODE: xmlEscape(process.env.HMRC_OFFICIAL_POSTCODE || "AA1 1AA"),
    OFFICIAL_PHONE: xmlEscape(process.env.HMRC_OFFICIAL_PHONE || "00000000000"),

    // Org name
    ORG_NAME: xmlEscape(charityRow.name),

    // In this sample schema, HMRCref matches the Charity ID used in Keys/CHARID
    HMRC_REF: xmlEscape(charityRow.charity_id),

    // Regulator info — you can later store these on charities if required
    REG_NAME: xmlEscape(process.env.HMRC_REG_NAME || "CCEW"),
    REG_NO: xmlEscape(process.env.HMRC_REG_NO || "UNKNOWN"),

    DONATION_ROWS: donationRowsXml ? `\n${donationRowsXml}\n` : "\n",
    EARLIEST_GA_DATE: xmlEscape(earliestGA),
  };

  // 7) Load and fill template
  const template = readTemplate();
  const filled = replaceAllPlaceholders(template, vars);

  // 8) Safety: if any placeholders remain, fail loudly (prevents bad HMRC XML)
  if (filled.includes("{{")) {
    const snippet = filled.slice(Math.max(0, filled.indexOf("{{") - 30), filled.indexOf("{{") + 80);
    throw new Error(
      `HMRC template still contains unreplaced placeholders. Example snippet: ${snippet}`
    );
  }

  return filled;
}
