function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * NOTE: This is a simplified starter XML.
 * HMRC Charities Online has specific schemas and headers you must follow.
 * We'll adapt this to HMRC's exact schema once you confirm the message type you need (Gift Aid / GASDS, etc.).
 */
export function buildGiftAidClaimXml(input: {
  claimId: string;
  charityHmrcRef: string; // e.g. HMRC charity ref number / regulator ref as required
  periodStart: string;    // YYYY-MM-DD
  periodEnd: string;      // YYYY-MM-DD
  items: Array<{
    donorName: string;
    donorPostcode: string;
    donationDate: string;    // YYYY-MM-DD
    donationAmount: number;
    declarationDate?: string | null;
  }>;
}) {
  const itemsXml = input.items
    .map((it) => `
      <Donation>
        <DonorName>${escapeXml(it.donorName)}</DonorName>
        <DonorPostcode>${escapeXml(it.donorPostcode)}</DonorPostcode>
        <DonationDate>${escapeXml(it.donationDate)}</DonationDate>
        <DonationAmount>${it.donationAmount.toFixed(2)}</DonationAmount>
        ${it.declarationDate ? `<DeclarationDate>${escapeXml(it.declarationDate)}</DeclarationDate>` : ""}
      </Donation>
    `.trim())
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<GiftAidClaim>
  <ClaimId>${escapeXml(input.claimId)}</ClaimId>
  <CharityRef>${escapeXml(input.charityHmrcRef)}</CharityRef>
  <PeriodStart>${escapeXml(input.periodStart)}</PeriodStart>
  <PeriodEnd>${escapeXml(input.periodEnd)}</PeriodEnd>
  <Donations>
    ${itemsXml}
  </Donations>
</GiftAidClaim>`;
}
