import fs from "fs";
import path from "path";
import { supabaseAdmin } from "./supabase.js";

/**
 * Bump this when you change template or mapping, so you can see what's deployed.
 */
export const HMRC_XML_VERSION = "2026-01-18-v4-split-donor-fields-no-replaceAll";

/**
 * Your portal data model assumptions (based on what you've implemented):
 *
 * - charities:
 *    id (uuid), name, contact_email, charity_id (HMRC CHARID - required)
 *
 * - claims:
 *    id, charity_id, period_start (optional), period_end (required), status...
 *
 * - claim_items (new HMRC-aligned fields):
 *    donor_title (nullable)
 *    donor_first_name (required)
 *    donor_last_name (required)
 *    donor_address (required)
 *    donor_postcode (required)
 *    donation_amount (required)
 *    donation_date (required, YYYY-MM-DD ideally)
 */

type ClaimRow = {
  id: string;
  charity_id: string;
  period_start?: string | null;
  period_end: string;
};

type CharityRow = {
  id: string;
  name: string;
  contact_email: string | null;
  charity_id: string | null; // HMRC CHARID (required)
};

type ClaimItemRow = {
  id: string;
  donor_title: string | null;
  donor_first_name: string;
  donor_last_name: string;
  donor_address: string;
  donor_postcode: string;
  donation_date: string;
  donation_amount: number;
};

/** Basic XML escaping */
function xmlEscape(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Normalize date to YYYY-MM-DD (best effort) */
function normalizeDate(d: any): string {
  const s = String(d ?? "").trim();
  if (!s) return "";

  // already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return "";

  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Format numbers as money (two decimals) */
function formatMoney(n: any): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

/**
 * Avoid String.replaceAll so TypeScript target doesn't matter.
 * Replaces all occurrences of {{KEY}} in the template.
 */
function replaceAllPlaceholders(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const token = `{{${k}}}`;
    out = out.split(token).join(v);
  }
  return out;
}

/** Where the template should live */
function templatePath(): string {
  return path.join(process.cwd(), "api", "_hmrc_templates", "giftAidClaimTemplate.xml");
}

/**
 * Read external template if present.
 * If not found, use a built-in sample-style template (so you can deploy safely).
 */
function loadTemplateOrFallback(): string {
  const p = templatePath();
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");

  // Fallback template (matches your sample structure)
  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>HMRC-CHAR-CLM</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <CorrelationID>{{CORRELATION_ID}}</CorrelationID>
      <Transformation>XML</Transformation>
      <GatewayTest>{{GATEWAY_TEST}}</GatewayTest>
      <GatewayTimestamp>{{GATEWAY_TIMESTAMP}}</GatewayTimestamp>
    </MessageDetails>
    <SenderDetails>
      <IDAuthentication>
        <SenderID>{{SENDER_ID}}</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Role>principal</Role>
          <Value>{{AUTH_VALUE}}</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>
  </Header>

  <GovTalkDetails>
    <Keys>
      <Key Type="CHARID">{{CHARID}}</Key>
    </Keys>
    <TargetDetails>
      <Organisation>HMRC</Organisation>
    </TargetDetails>
    <ChannelRouting>
      <Channel>
        <URI>0000</URI>
        <Product>Gift Aided Portal</Product>
        <Version>1.0</Version>
      </Channel>
    </ChannelRouting>
  </GovTalkDetails>

  <Body>
    <IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/charities/r68/2">
      <IRheader>
        <Keys>
          <Key Type="CHARID">{{CHARID}}</Key>
        </Keys>
        <PeriodEnd>{{PERIOD_END}}</PeriodEnd>
        <DefaultCurrency>GBP</DefaultCurrency>
        <IRmark Type="generic">{{IRMARK}}</IRmark>
        <Sender>Individual</Sender>
      </IRheader>

      <R68>
        <AuthOfficial>
          <OffName>
            <Fore>{{OFFICIAL_FORE}}</Fore>
            <Sur>{{OFFICIAL_SUR}}</Sur>
          </OffName>
          <OffID>
            <Postcode>{{OFFICIAL_POSTCODE}}</Postcode>
          </OffID>
          <Phone>{{OFFICIAL_PHONE}}</Phone>
        </AuthOfficial>

        <Declaration>yes</Declaration>

        <Claim>
          <OrgName>{{ORG_NAME}}</OrgName>
          <HMRCref>{{CHARID}}</HMRCref>

          <Regulator>
            <RegName>{{REG_NAME}}</RegName>
            <RegNo>{{REG_NO}}</RegNo>
          </Regulator>

          <Repayment>
{{DONATION_ROWS}}
            <EarliestGAdate>{{EARLIEST_GA_DATE}}</EarliestGAdate>
          </Repayment>

          <GASDS>
            <ConnectedCharities>no</ConnectedCharities>
            <CommBldgs>no</CommBldgs>
          </GASDS>
        </Claim>
      </R68>
    </IRenvelope>
  </Body>
</GovTalkMessage>
`;
}

/** Build a single <GAD> row from one donation item */
function buildGadRowXml(item: ClaimItemRow): string {
  // HMRC expects Fore/Sur; Title is optional and your Title is not mandatory.
  // We'll keep title out of Fore/Sur and only use first/last.
  // If you later decide to include title, we can add it safely.
  const donationDate = normalizeDate(item.donation_date);
  const amount = formatMoney(item.donation_amount);

  return [
    "            <GAD>",
    "              <Donor>",
    `                <Fore>${xmlEscape(item.donor_first_name)}</Fore>`,
    `                <Sur>${xmlEscape(item.donor_last_name)}</Sur>`,
    `                <House>${xmlEscape(item.donor_address)}</House>`,
    `                <Postcode>${xmlEscape(item.donor_postcode)}</Postcode>`,
    "              </Donor>",
    `              <Date>${xmlEscape(donationDate)}</Date>`,
    `              <Total>${xmlEscape(amount)}</Total>`,
    "            </GAD>",
  ].join("\n");
}

/** Determine earliest donation date for <EarliestGAdate> */
function earliestDonationDate(items: ClaimItemRow[], fallback: string): string {
  const dates = items
    .map((it) => normalizeDate(it.donation_date))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return dates[0] || fallback;
}

/**
 * MAIN ENTRYPOINT:
 * Returns a full GovTalk XML payload for a claim
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

  if (claimErr || !claim) throw new Error(claimErr?.message || "Claim not found");
  const claimRow = claim as ClaimRow;

  const periodEnd = normalizeDate(claimRow.period_end);
  if (!periodEnd) throw new Error("Claim period_end is missing or invalid (expected YYYY-MM-DD)");

  // 2) Load charity (needs charity_id for HMRC)
  const { data: charity, error: charityErr } = await supabaseAdmin
    .from("charities")
    .select("id, name, contact_email, charity_id")
    .eq("id", claimRow.charity_id)
    .single();

  if (charityErr || !charity) throw new Error(charityErr?.message || "Charity not found");
  const charityRow = charity as CharityRow;

  const charid = String(charityRow.charity_id || "").trim();
  if (!charid) {
    throw new Error("Charity is missing charity_id (HMRC CHARID). This must be set during charity setup.");
  }

  // 3) Load claim items (split donor fields, no donor_name)
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("claim_items")
    .select(
      "id, donor_title, donor_first_name, donor_last_name, donor_address, donor_postcode, donation_date, donation_amount"
    )
    .eq("claim_id", id)
    .order("donation_date", { ascending: true });

  if (itemsErr) throw new Error(itemsErr.message);

  const itemRows = (items || []) as ClaimItemRow[];
  if (itemRows.length === 0) {
    throw new Error("No donation items found for this claim");
  }

  // 4) Validate required item fields (server-side safety)
  for (let i = 0; i < itemRows.length; i++) {
    const it = itemRows[i];
    if (!String(it.donor_first_name || "").trim()) throw new Error(`Item ${it.id}: donor_first_name is required`);
    if (!String(it.donor_last_name || "").trim()) throw new Error(`Item ${it.id}: donor_last_name is required`);
    if (!String(it.donor_address || "").trim()) throw new Error(`Item ${it.id}: donor_address is required`);
    if (!String(it.donor_postcode || "").trim()) throw new Error(`Item ${it.id}: donor_postcode is required`);
    const d = normalizeDate(it.donation_date);
    if (!d) throw new Error(`Item ${it.id}: donation_date is required (YYYY-MM-DD)`);
    const amt = Number(it.donation_amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error(`Item ${it.id}: donation_amount must be > 0`);
  }

  // 5) Build donation rows XML
  const donationRowsXml = itemRows.map(buildGadRowXml).join("\n");
  const earliestGA = earliestDonationDate(itemRows, periodEnd);

  // 6) Fill template
  const template = loadTemplateOrFallback();

  // These can be configured in Vercel env vars later
  const vars: Record<string, string> = {
    CORRELATION_ID: xmlEscape(claimRow.id),
    GATEWAY_TEST: xmlEscape(process.env.HMRC_GATEWAY_TEST ?? "1"),
    GATEWAY_TIMESTAMP: xmlEscape(new Date().toISOString()),

    // sender/auth
    SENDER_ID: xmlEscape(process.env.HMRC_SENDER_ID ?? "GIFTAIDCHAR"),
    AUTH_VALUE: xmlEscape(process.env.HMRC_AUTH_VALUE ?? "REPLACE_ME"),

    // keys
    CHARID: xmlEscape(charid),

    // IR header
    PERIOD_END: xmlEscape(periodEnd),
    IRMARK: xmlEscape(process.env.HMRC_IRMARK ?? "PENDING_IRMARK"),

    // official (operator)
    OFFICIAL_FORE: xmlEscape(process.env.HMRC_OFFICIAL_FORE ?? "Gift"),
    OFFICIAL_SUR: xmlEscape(process.env.HMRC_OFFICIAL_SUR ?? "Aided"),
    OFFICIAL_POSTCODE: xmlEscape(process.env.HMRC_OFFICIAL_POSTCODE ?? "AA1 1AA"),
    OFFICIAL_PHONE: xmlEscape(process.env.HMRC_OFFICIAL_PHONE ?? "00000000000"),

    // claim
    ORG_NAME: xmlEscape(charityRow.name),
    REG_NAME: xmlEscape(process.env.HMRC_REG_NAME ?? "CCEW"),
    REG_NO: xmlEscape(process.env.HMRC_REG_NO ?? "UNKNOWN"),

    // repayment
    DONATION_ROWS: donationRowsXml ? donationRowsXml : "",
    EARLIEST_GA_DATE: xmlEscape(earliestGA),
  };

  const xml = replaceAllPlaceholders(template, vars);

  // 7) Safety check: no leftover placeholders
  if (xml.includes("{{")) {
    const pos = xml.indexOf("{{");
    const snippet = xml.slice(Math.max(0, pos - 60), Math.min(xml.length, pos + 140));
    throw new Error(`XML template still has unreplaced placeholders. Snippet: ${snippet}`);
  }

  return xml;
}
