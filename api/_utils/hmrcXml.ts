import fs from "fs";
import path from "path";
import { supabaseAdmin } from "./supabase.js";

export const HMRC_XML_VERSION = "2026-01-18-v3-no-replaceAll-no-title";

function xmlEscape(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readTemplate(): string {
  const templatePath = path.join(
    process.cwd(),
    "api",
    "_hmrc_templates",
    "giftAidClaimTemplate.xml"
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error("HMRC XML template not found at api/_hmrc_templates/giftAidClaimTemplate.xml");
  }

  return fs.readFileSync(templatePath, "utf8");
}

function formatMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function normalizeDate(d: any): string {
  const s = String(d ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return "";

  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

type ClaimRow = {
  id: string;
  charity_id: string;
  period_end: string;
};

type CharityRow = {
  id: string;
  name: string;
  charity_id: string; // HMRC CHARID (mandatory)
  contact_email?: string | null;
};

type ClaimItemRow = {
  id: string;
  donor_title: string | null;
  donor_first_name: string;
  donor_last_name: string;
  donor_address: string;
  donor_postcode: string;
  donation_amount: number;
  donation_date: string;
};

function buildGadRowXml(item: ClaimItemRow): string {
  return [
    "<GAD>",
    "  <Donor>",
    `    <Fore>${xmlEscape(item.donor_first_name)}</Fore>`,
    `    <Sur>${xmlEscape(item.donor_last_name)}</Sur>`,
    `    <House>${xmlEscape(item.donor_address)}</House>`,
    `    <Postcode>${xmlEscape(item.donor_postcode)}</Postcode>`,
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

function replaceAllPlaceholders(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const token = `{{${k}}}`;
    // ✅ works without String.replaceAll
    out = out.split(token).join(v);
  }
  return out;
}

export async function generateHmrcGiftAidXml(claimId: string): Promise<string> {
  const id = String(claimId || "").trim();
  if (!id) throw new Error("claimId is required");

  // Claim
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("id, charity_id, period_end")
    .eq("id", id)
    .single();

  if (claimErr || !claim) throw new Error(claimErr?.message || "Claim not found");
  const claimRow = claim as ClaimRow;

  // Charity
  const { data: charity, error: charityErr } = await supabaseAdmin
    .from("charities")
    .select("id, name, charity_id, contact_email")
    .eq("id", claimRow.charity_id)
    .single();

  if (charityErr || !charity) throw new Error(charityErr?.message || "Charity not found");
  const charityRow = charity as CharityRow;

  if (!charityRow.charity_id || !String(charityRow.charity_id).trim()) {
    throw new Error("Charity is missing charity_id (required for HMRC CHARID).");
  }

  // Items (✅ no title column)
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("claim_items")
    .select(
      "id, donor_title, donor_first_name, donor_last_name, donor_address, donor_postcode, donation_amount, donation_date"
    )
    .eq("claim_id", id)
    .order("donation_date", { ascending: true });

  if (itemsErr) throw new Error(itemsErr.message);

  const itemRows = (items || []) as ClaimItemRow[];

  const donationRowsXml = itemRows.map(buildGadRowXml).join("\n");

  const periodEnd = normalizeDate(claimRow.period_end);
  if (!periodEnd) throw new Error("Claim period_end is missing/invalid");

  const earliestGA = earliestDonationDate(itemRows) || periodEnd;

  // Template variables (matches your sample style)
  const vars: Record<string, string> = {
    CORRELATION_ID: xmlEscape(claimRow.id),
    GATEWAY_TIMESTAMP: xmlEscape(nowIso()),

    SENDER_ID: xmlEscape(process.env.HMRC_SENDER_ID || "GIFTAIDCHAR"),
    AUTH_VALUE: xmlEscape(process.env.HMRC_AUTH_VALUE || "REPLACE_ME"),

    CHARID: xmlEscape(charityRow.charity_id),
    PERIOD_END: xmlEscape(periodEnd),

    IRMARK: xmlEscape("PENDING_IRMARK"),

    OFFICIAL_FORE: xmlEscape(process.env.HMRC_OFFICIAL_FORE || "Portal"),
    OFFICIAL_SUR: xmlEscape(process.env.HMRC_OFFICIAL_SUR || "Operator"),
    OFFICIAL_POSTCODE: xmlEscape(process.env.HMRC_OFFICIAL_POSTCODE || "AA1 1AA"),
    OFFICIAL_PHONE: xmlEscape(process.env.HMRC_OFFICIAL_PHONE || "00000000000"),

    ORG_NAME: xmlEscape(charityRow.name),
    HMRC_REF: xmlEscape(charityRow.charity_id),

    REG_NAME: xmlEscape(process.env.HMRC_REG_NAME || "CCEW"),
    REG_NO: xmlEscape(process.env.HMRC_REG_NO || "UNKNOWN"),

    DONATION_ROWS: donationRowsXml ? `\n${donationRowsXml}\n` : "\n",
    EARLIEST_GA_DATE: xmlEscape(earliestGA),
  };

  const template = readTemplate();
  const filled = replaceAllPlaceholders(template, vars);

  if (filled.includes("{{")) {
    const pos = filled.indexOf("{{");
    const snippet = filled.slice(Math.max(0, pos - 40), Math.min(filled.length, pos + 120));
    throw new Error(`Template still contains unreplaced placeholders. Snippet: ${snippet}`);
  }

  return filled;
}
