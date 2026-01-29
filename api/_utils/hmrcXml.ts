// api/_utils/hmrcXml.ts
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "./supabase.js";

/**
 * Version stamp (exposed via response headers in your handlers)
 */
export const HMRC_XML_VERSION = "2026-01-28-v1-ets-creds-and-ts-modes";

/**
 * Modes:
 * - ETS: External Test Service (Transaction Engine style) -> CorrelationID must be blank, GatewayTimestamp should be blank/omitted
 * - LIVE: Live Transaction Engine -> same rule as ETS for CorrelationID/GatewayTimestamp
 * - LTS: Local Test Service -> GatewayTimestamp MUST be populated (CorrelationID can be blank)
 *
 * Set env HMRC_XML_MODE to one of: "ETS" | "LIVE" | "LTS"
 */
function getXmlMode(): "ETS" | "LIVE" | "LTS" {
  const v = String(process.env.HMRC_XML_MODE || "ETS").trim().toUpperCase();
  if (v === "LIVE") return "LIVE";
  if (v === "LTS") return "LTS";
  return "ETS";
}

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
 *
 * Notes:
 * - For ETS/LIVE, CorrelationID must be empty.
 * - For ETS/LIVE, GatewayTimestamp should be empty (Transaction Engine populates it).
 * - For LTS, GatewayTimestamp must be populated.
 */
function loadTemplateOrFallback(): string {
  const p = templatePath();
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");

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
        <URI>{{VENDOR_ID}}</URI>
        <Product>{{PRODUCT_NAME}}</Product>
        <Version>{{PRODUCT_VERSION}}</Version>
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
 * Returns ETS test credentials per Charities Technical Pack.
 * If you set HMRC_SENDER_ID / HMRC_AUTH_VALUE, those override.
 */
function getSenderCreds(mode: "ETS" | "LIVE" | "LTS") {
  const senderFromEnv = String(process.env.HMRC_SENDER_ID || "").trim();
  const passFromEnv = String(process.env.HMRC_AUTH_VALUE || "").trim();

  // If explicitly set, always use env.
  if (senderFromEnv && passFromEnv) {
    return { senderId: senderFromEnv, authValue: passFromEnv };
  }

  // Defaults:
  // ETS uses fixed test creds from the pack.
  if (mode === "ETS") {
    return { senderId: "323412300001", authValue: "testing1" };
  }

  // LIVE/LTS default to your old sample values unless overridden.
  return {
    senderId: senderFromEnv || "GIFTAIDCHAR",
    authValue: passFromEnv || "testing2",
  };
}

/**
 * For ETS the pack shows a sample CHARID "AB12345".
 * Some environments validate header keys; allow forcing a test CHARID via env.
 *
 * If you set HMRC_TEST_CHARID it will be used for ETS mode (only),
 * otherwise we use the charity’s stored charity_number.
 */
function chooseCharIdForMode(mode: "ETS" | "LIVE" | "LTS", charityNumberOrLegacy: string) {
  if (mode === "ETS") {
    const forced = String(process.env.HMRC_TEST_CHARID || "").trim();
    if (forced) return forced;
    // Safe default sample from the pack
    return charityNumberOrLegacy || "AB12345";
  }
  return charityNumberOrLegacy;
}

/**
 * ✅ MAIN entrypoint used by Preview XML + ISV Submit:
 * Uses charities.charity_number as HMRC CHARID / HMRCref.
 * (Keeps charities.charity_id as legacy fallback.)
 */
export async function generateHmrcGiftAidXml(claimId: string): Promise<string> {
  const id = String(claimId || "").trim();
  if (!id) throw new Error("claimId is required");

  const mode = getXmlMode();

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

  const rawCharid =
    String((charity as any).charity_number || "").trim() ||
    String((charity as any).charity_id || "").trim(); // legacy fallback

  const charid = chooseCharIdForMode(mode, rawCharid);

  if (!charid) {
    throw new Error("Missing Charity Number (used as HMRC CHARID). Ask an operator to set it in Admin.");
  }

  // 3) Load claim items
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("claim_items")
    .select(
      "id, donor_first_name, donor_last_name, donor_address, donor_postcode, donation_date, donation_amount"
    )
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

  // 6) Header fields per mode
  // - CorrelationID: reserved/system-controlled for Transaction Engine (ETS/LIVE) -> MUST be blank
  // - GatewayTimestamp:
  //    - LTS requires a value
  //    - ETS/LIVE should be blank (Transaction Engine populates)
  const correlationId = ""; // always blank to avoid 1020
  const gatewayTimestamp =
    mode === "LTS"
      ? new Date().toISOString().replace("Z", "") // LTS example is without trailing Z sometimes; either works locally
      : ""; // ETS/LIVE blank to avoid fixed-value errors

  const { senderId, authValue } = getSenderCreds(mode);

  // 7) Fill template
  const template = loadTemplateOrFallback();

  const vars: Record<string, string> = {
    CORRELATION_ID: xmlEscape(correlationId),

    // GatewayTest:
    // Keep "1" for test traffic; set to "0" for live if you want (via env).
    GATEWAY_TEST: xmlEscape(process.env.HMRC_GATEWAY_TEST ?? (mode === "LIVE" ? "0" : "1")),

    GATEWAY_TIMESTAMP: xmlEscape(gatewayTimestamp),

    // Sender details
    SENDER_ID: xmlEscape(senderId),
    AUTH_VALUE: xmlEscape(authValue),

    // Keys / IDs
    CHARID: xmlEscape(charid),

    // ChannelRouting (vendor/product/version)
    // ETS docs show URI=your vendor id for live; ETS examples sometimes show 0000.
    // Provide envs so you can match what HMRC expects for your setup.
    VENDOR_ID: xmlEscape(process.env.HMRC_VENDOR_ID ?? "0000"),
    PRODUCT_NAME: xmlEscape(process.env.HMRC_PRODUCT_NAME ?? "GA Valid Sample"),
    PRODUCT_VERSION: xmlEscape(process.env.HMRC_PRODUCT_VERSION ?? "1.0"),

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

    // Per the pack: HMRCref is the charity’s HMRC reference (same value used in CHARID keys)
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

  // 8) Safety check: no placeholders left
  if (xml.indexOf("{{") !== -1) {
    const pos = xml.indexOf("{{");
    const snippet = xml.slice(Math.max(0, pos - 60), Math.min(xml.length, pos + 140));
    throw new Error(`XML template still has unreplaced placeholders. Snippet: ${snippet}`);
  }

  return xml;
}
