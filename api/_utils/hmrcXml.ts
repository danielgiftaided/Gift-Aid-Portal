// api/_utils/hmrcXml.ts
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "./supabase.js";

/**
 * ✅ Exported constant so other modules can import it.
 */
export const HMRC_XML_VERSION = "2026-01-27-v3-correlationid-empty";

/** XML escape */
function xmlEscape(v: any): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Best-effort normalize date to YYYY-MM-DD */
function normalizeDate(d: any): string {
  const s = String(d ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return "";

  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Money to 2dp */
function formatMoney(n: any): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

/**
 * Avoid String.replaceAll (TS target compatibility).
 * Replaces all occurrences of {{KEY}} in template.
 */
function replaceAllPlaceholders(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const token = `{{${k}}}`;
    out = out.split(token).join(v);
  }
  return out;
}

function templatePath(): string {
  return path.join(process.cwd(), "api", "_hmrc_templates", "giftAidClaimTemplate.xml");
}

/**
 * Loads an external template if present, otherwise uses a safe built-in template.
 * This keeps your sample structure.
 */
function loadTemplateOrFallback(): string {
  const p = templatePath();
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");

  // NOTE: CorrelationID exists but should be EMPTY for GovTalk submissions.
  // We'll always replace it with "" so the tag becomes empty.
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
        <Product>{{PRODUCT_NAME}}</Product>
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
          <HMRCref>{{HMRCREF}}</HMRCref>

          <Regulator>
            <RegName>{{REG_NAME}}</RegName>
            <RegNo>{{REG_NO}}</RegNo>
          </Regulator>

          <Repayment>
{{DONATION_ROWS}}
            <EarliestGAdate>{{EARLIEST_GA_DATE}}</EarliestGAdate>
            {{OTHER_INC_BLOCK}}
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

/** Postcode output for HMRC: trim + uppercase */
function normalizePostcode(postcode: any): string {
  return String(postcode ?? "").trim().toUpperCase();
}

/** Build a single <GAD> row in the sample style */
function buildGadRowXml(item: {
  donor_first_name: string;
  donor_last_name: string;
  donor_address: string;
  donor_postcode: string;
  donation_date: string;
  donation_amount: number;
}): string {
  const donationDate = normalizeDate(item.donation_date);
  const amount = formatMoney(item.donation_amount);
  const postcode = normalizePostcode(item.donor_postcode);
  const address = String(item.donor_address ?? "").trim();

  return [
    "            <GAD>",
    "              <Donor>",
    `                <Fore>${xmlEscape(String(item.donor_first_name ?? "").trim())}</Fore>`,
    `                <Sur>${xmlEscape(String(item.donor_last_name ?? "").trim())}</Sur>`,
    `                <House>${xmlEscape(address)}</House>`,
    `                <Postcode>${xmlEscape(postcode)}</Postcode>`,
    "              </Donor>",
    `              <Date>${xmlEscape(donationDate)}</Date>`,
    `              <Total>${xmlEscape(amount)}</Total>`,
    "            </GAD>",
  ].join("\n");
}

function earliestDonationDate(items: Array<{ donation_date: string }>, fallback: string): string {
  const dates = items
    .map((it) => normalizeDate(it.donation_date))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return dates[0] || fallback;
}

/**
 * ✅ MAIN entrypoint used by Preview XML + ISV Submit:
 * Uses charities.charity_number as HMRC CHARID.
 * (Keeps charities.charity_id as legacy fallback.)
 *
 * IMPORTANT GOVTALK RULE:
 * - CorrelationID in GovTalkMessage/Header/MessageDetails is a RESERVED system field → must be blank.
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

  const periodEnd = normalizeDate((claim as any).period_end);
  if (!periodEnd) throw new Error("Claim period_end is missing/invalid (expected YYYY-MM-DD)");
  const periodStart = normalizeDate((claim as any).period_start) || periodEnd;

  // 2) Load charity — HMRC CHARID == charity_number
  const { data: charity, error: charityErr } = await supabaseAdmin
    .from("charities")
    .select("id, name, contact_email, charity_number, charity_id")
    .eq("id", (claim as any).charity_id)
    .single();

  if (charityErr || !charity) throw new Error(charityErr?.message || "Charity not found");

  const charid =
    String((charity as any).charity_number || "").trim() ||
    String((charity as any).charity_id || "").trim(); // legacy fallback

  if (!charid) {
    throw new Error(
      "Charity is missing Charity Number (used as HMRC CHARID). Ask an operator to set it in Admin."
    );
  }

  // 3) Load claim items
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("claim_items")
    .select("id, donor_first_name, donor_last_name, donor_address, donor_postcode, donation_date, donation_amount")
    .eq("claim_id", id)
    .order("donation_date", { ascending: true });

  if (itemsErr) throw new Error(itemsErr.message);

  const itemRows = (items || []) as any[];
  if (itemRows.length === 0) throw new Error("No donation items found for this claim");

  // 4) Validate items
  for (const it of itemRows) {
    if (!String(it.donor_first_name || "").trim()) throw new Error(`Item ${it.id}: First Name is required`);
    if (!String(it.donor_last_name || "").trim()) throw new Error(`Item ${it.id}: Last Name is required`);
    if (!String(it.donor_address || "").trim()) throw new Error(`Item ${it.id}: Address is required`);

    const pc = normalizePostcode(it.donor_postcode);
    if (!pc) throw new Error(`Item ${it.id}: Postcode is required`);

    const d = normalizeDate(it.donation_date);
    if (!d) throw new Error(`Item ${it.id}: Donation Date is required (YYYY-MM-DD)`);

    const amt = Number(it.donation_amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error(`Item ${it.id}: Donation Amount must be > 0`);
  }

  // 5) Donation rows
  const donationRowsXml = itemRows
    .map((it) =>
      buildGadRowXml({
        donor_first_name: String(it.donor_first_name),
        donor_last_name: String(it.donor_last_name),
        donor_address: String(it.donor_address),
        donor_postcode: String(it.donor_postcode),
        donation_date: String(it.donation_date),
        donation_amount: Number(it.donation_amount),
      })
    )
    .join("\n");

  const earliestGA = earliestDonationDate(itemRows, periodStart);

  // 6) Fill template
  const template = loadTemplateOrFallback();

  const vars: Record<string, string> = {
    // ✅ CRITICAL: MUST BE BLANK to avoid GovTalk 1020
    CORRELATION_ID: "",

    GATEWAY_TEST: xmlEscape(process.env.HMRC_GATEWAY_TEST ?? "1"),
    GATEWAY_TIMESTAMP: xmlEscape(new Date().toISOString().replace("Z", "")),

    // Sender details (sample defaults; later use hmrc_connections)
    SENDER_ID: xmlEscape(process.env.HMRC_SENDER_ID ?? "GIFTAIDCHAR"),
    AUTH_VALUE: xmlEscape(process.env.HMRC_AUTH_VALUE ?? "testing2"),

    // Keys / IDs
    CHARID: xmlEscape(charid),

    // Routing
    PRODUCT_NAME: xmlEscape(process.env.HMRC_PRODUCT_NAME ?? "GA Valid Sample"),

    // IRheader
    PERIOD_END: xmlEscape(periodEnd),
    IRMARK: xmlEscape(process.env.HMRC_IRMARK ?? "nMs6zamBGcmT7n0selJHXuiQUEw="),

    // Official (sample defaults)
    OFFICIAL_FORE: xmlEscape(process.env.HMRC_OFFICIAL_FORE ?? "John"),
    OFFICIAL_SUR: xmlEscape(process.env.HMRC_OFFICIAL_SUR ?? "Smith"),
    OFFICIAL_POSTCODE: xmlEscape(process.env.HMRC_OFFICIAL_POSTCODE ?? "AB12 3CD"),
    OFFICIAL_PHONE: xmlEscape(process.env.HMRC_OFFICIAL_PHONE ?? "01234 567890"),

    // Claim
    ORG_NAME: xmlEscape(String((charity as any).name || "My Organisation")),
    HMRCREF: xmlEscape(charid),

    // Regulator (sample defaults)
    REG_NAME: xmlEscape(process.env.HMRC_REG_NAME ?? "CCEW"),
    REG_NO: xmlEscape(process.env.HMRC_REG_NO ?? "A1234"),

    // Repayment
    DONATION_ROWS: donationRowsXml,
    EARLIEST_GA_DATE: xmlEscape(earliestGA),

    // Optional blocks
    OTHER_INC_BLOCK: "",
  };

  const xml = replaceAllPlaceholders(template, vars);

  // 7) Safety check: no placeholders left
  if (xml.indexOf("{{") !== -1) {
    const pos = xml.indexOf("{{");
    const snippet = xml.slice(Math.max(0, pos - 60), Math.min(xml.length, pos + 140));
    throw new Error(`XML template still has unreplaced placeholders. Snippet: ${snippet}`);
  }

  return xml;
}
