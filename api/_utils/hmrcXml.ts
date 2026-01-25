import { supabaseAdmin } from "./supabase.js";

/**
 * Escapes XML special characters
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
 * Format YYYY-MM-DD
 */
function fmtDate(d: string | Date): string {
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
}

/**
 * Build Gift Aid XML for a claim
 * Loads claim, charity, items internally
 */
export async function generateHmrcGiftAidXml(claimId: string): Promise<string> {
  if (!claimId) throw new Error("claimId is required");

  /* -----------------------------------------------------------
   * Load claim
   * --------------------------------------------------------- */
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("claims")
    .select("id, charity_id, period_start, period_end")
    .eq("id", claimId)
    .single();

  if (claimErr || !claim) {
    throw new Error("Claim not found");
  }

  /* -----------------------------------------------------------
   * Load charity
   * --------------------------------------------------------- */
  const { data: charity, error: charityErr } = await supabaseAdmin
    .from("charities")
    .select("id, name, hmrc_charity_id")
    .eq("id", claim.charity_id)
    .single();

  if (charityErr || !charity) {
    throw new Error("Charity not found");
  }

  if (!charity.hmrc_charity_id) {
    throw new Error("Charity is missing HMRC Charity ID");
  }

  const charId = charity.hmrc_charity_id;

  /* -----------------------------------------------------------
   * Load claim items
   * --------------------------------------------------------- */
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("claim_items")
    .select(`
      donor_title,
      donor_first_name,
      donor_last_name,
      donor_address,
      donor_postcode,
      donation_date,
      donation_amount
    `)
    .eq("claim_id", claimId)
    .order("donation_date", { ascending: true });

  if (itemsErr) throw itemsErr;
  if (!items || items.length === 0) {
    throw new Error("No donation items in claim");
  }

  /* -----------------------------------------------------------
   * Build GAD blocks
   * --------------------------------------------------------- */
  const gadBlocks = items
    .map((it) => {
      const overseas = !it.donor_postcode;

      return `
<GAD>
  <Donor>
    ${it.donor_title ? `<Title>${xmlEscape(it.donor_title)}</Title>` : ""}
    <Fore>${xmlEscape(it.donor_first_name)}</Fore>
    <Sur>${xmlEscape(it.donor_last_name)}</Sur>
    <House>${xmlEscape(it.donor_address)}</House>
    ${
      overseas
        ? `<Overseas>yes</Overseas>`
        : `<Postcode>${xmlEscape(it.donor_postcode)}</Postcode>`
    }
  </Donor>
  <Date>${fmtDate(it.donation_date)}</Date>
  <Total>${Number(it.donation_amount).toFixed(2)}</Total>
</GAD>`.trim();
    })
    .join("\n");

  /* -----------------------------------------------------------
   * Assemble final XML
   * --------------------------------------------------------- */
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>

  <Header>
    <MessageDetails>
      <Class>HMRC-CHAR-CLM</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <CorrelationID/>
      <Transformation>XML</Transformation>
      <GatewayTest>1</GatewayTest>
      <GatewayTimestamp>${new Date().toISOString()}</GatewayTimestamp>
    </MessageDetails>

    <SenderDetails>
      <IDAuthentication>
        <SenderID>GIFTAIDCHAR</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Role>principal</Role>
          <Value>testing</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>
  </Header>

  <GovTalkDetails>
    <Keys>
      <Key Type="CHARID">${xmlEscape(charId)}</Key>
    </Keys>
    <TargetDetails>
      <Organisation>HMRC</Organisation>
    </TargetDetails>
    <ChannelRouting>
      <Channel>
        <URI>0000</URI>
        <Product>${xmlEscape(process.env.HMRC_PRODUCT_NAME ?? "GA Valid Sample")}</Product>
        <Version>1.0</Version>
      </Channel>
    </ChannelRouting>
  </GovTalkDetails>

  <Body>
    <IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/charities/r68/2">
      <IRheader>
        <Keys>
          <Key Type="CHARID">${xmlEscape(charId)}</Key>
        </Keys>
        <PeriodEnd>${fmtDate(claim.period_end)}</PeriodEnd>
        <DefaultCurrency>GBP</DefaultCurrency>
        <IRmark Type="generic">GiftAided</IRmark>
        <Sender>Individual</Sender>
      </IRheader>

      <R68>
        <AuthOfficial>
          <OffName>
            <Fore>Authorised</Fore>
            <Sur>Official</Sur>
          </OffName>
          <OffID>
            <Postcode>AA11 1AA</Postcode>
          </OffID>
          <Phone>0000000000</Phone>
        </AuthOfficial>

        <Declaration>yes</Declaration>

        <Claim>
          <OrgName>${xmlEscape(charity.name)}</OrgName>
          <HMRCref>${xmlEscape(charId)}</HMRCref>

          <Repayment>
            ${gadBlocks}
            <EarliestGAdate>${fmtDate(claim.period_start)}</EarliestGAdate>
          </Repayment>

          <GASDS>
            <ConnectedCharities>no</ConnectedCharities>
            <CommBldgs>no</CommBldgs>
          </GASDS>
        </Claim>
      </R68>
    </IRenvelope>
  </Body>
</GovTalkMessage>`.trim();

  // Safety check — never allow placeholders through
  if (xml.indexOf("{{") !== -1) {
    const idx = xml.indexOf("{{");
    throw new Error(
      "XML template still has unreplaced placeholders. Snippet: " +
        xml.slice(Math.max(0, idx - 40), idx + 60)
    );
  }

  return xml;
}
