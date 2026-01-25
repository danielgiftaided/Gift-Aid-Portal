import type { VercelRequest } from "@vercel/node";

export const HMRC_TEST_SUBMIT_URL = "https://test-transaction-engine.tax.service.gov.uk/submission";
export const HMRC_TEST_POLL_URL = "https://test-transaction-engine.tax.service.gov.uk/poll";

type HttpResult = {
  ok: boolean;
  status: number;
  bodyText: string;
  contentType: string | null;
};

async function httpPostXml(url: string, xml: string, timeoutMs = 25000): Promise<HttpResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Accept": "text/xml, application/xml, */*",
      },
      body: xml,
      signal: ac.signal,
    });

    const bodyText = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      bodyText,
      contentType: res.headers.get("content-type"),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submit claim XML to HMRC Transaction Engine TEST endpoint.
 */
export async function hmrcTestSubmit(xml: string) {
  return httpPostXml(HMRC_TEST_SUBMIT_URL, xml);
}

/**
 * Poll HMRC Transaction Engine TEST endpoint.
 *
 * HMRC "poll" expects a GovTalk envelope too. We'll send a minimal poll request
 * referencing the CorrelationID you used at submission time.
 *
 * Note: This is the standard "Document Submission Protocol" pattern. :contentReference[oaicite:2]{index=2}
 */
export async function hmrcTestPoll(params: {
  correlationId: string;
  senderId: string;
  password: string;
  gatewayTest: 1 | 0;
}) {
  const { correlationId, senderId, password, gatewayTest } = params;

  const pollXml =
`<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>HMRC-GATEWAY-POLL</Class>
      <Qualifier>request</Qualifier>
      <Function>poll</Function>
      <CorrelationID>${escapeXml(correlationId)}</CorrelationID>
      <Transformation>XML</Transformation>
      <GatewayTest>${gatewayTest}</GatewayTest>
    </MessageDetails>
    <SenderDetails>
      <IDAuthentication>
        <SenderID>${escapeXml(senderId)}</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Role>principal</Role>
          <Value>${escapeXml(password)}</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>
  </Header>
  <Body/>
</GovTalkMessage>`;

  return httpPostXml(HMRC_TEST_POLL_URL, pollXml);
}

export function getBearerToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) return null;
  const s = String(auth);
  if (!s.toLowerCase().startsWith("bearer ")) return null;
  return s.slice(7).trim();
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
