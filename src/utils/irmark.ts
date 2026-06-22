/**
 * IRmark generation for HMRC Gateway Protocol submissions (Charities Online).
 *
 * Algorithm, per HMRC's "IRmark Generation: Step By Step Guide for Gateway
 * Protocol based services" (v2.0, 19/07/2011):
 *
 *   1. Extract everything inside and including <Body></Body> from the
 *      GovTalkMessage, inheriting any namespace declarations present on
 *      <GovTalkMessage> itself.
 *   2. Remove the <IRmark> node from within that extracted Body (preserving
 *      surrounding whitespace exactly as it will appear in the real
 *      submission).
 *   3. Canonicalise the result per the W3C XML-C14N spec
 *      (http://www.w3.org/TR/2001/REC-xml-c14n-20010315).
 *   4. Take a SHA-1 digest of the canonical form (binary, 20 bytes).
 *   5. Base64-encode the digest for insertion into the XML. Base32 is only
 *      needed if you want a human-readable value to display somewhere —
 *      it is NOT what gets submitted to HMRC.
 *
 * IMPORTANT: requires a real XML canonicalisation (C14N) library — do not
 * attempt to hand-roll this. Install one before using this module, e.g.:
 *   npm install xml-c14n
 *
 * This file deliberately keeps the canonicalisation step pluggable via the
 * `canonicalise` parameter so it can be swapped for whichever C14N
 * implementation ends up working reliably against HMRC's LTS responses —
 * in practice it's worth validating this against the example XML files HMRC
 * publishes (full submission / canonical payload / response) until the
 * computed IRmark matches their worked example exactly, before trusting it
 * against real submissions.
 */

import { createHash } from 'crypto'

export interface IrmarkResult {
  /** Base64-encoded SHA-1 digest — this is what goes in <IRmark>. */
  base64: string
  /** Base32-encoded SHA-1 digest — for human-readable display only. */
  base32: string
}

/**
 * Extracts the <Body>...</Body> substring from a full GovTalkMessage XML
 * string, inheriting namespace declarations from the root <GovTalkMessage>
 * element as required by the IRmark spec.
 *
 * This is a deliberately narrow, string-based extraction rather than a full
 * DOM parse, because the spec requires the extracted text to be BYTE
 * IDENTICAL (whitespace, line endings, everything) to what gets submitted —
 * round-tripping through a DOM parser/serialiser risks silently changing
 * whitespace and producing an IRmark that HMRC's own calculation won't match
 * (error 2021).
 */
export function extractBodyForIrmark(fullGovTalkXml: string): string {
  const rootMatch = fullGovTalkXml.match(/<GovTalkMessage\b([^>]*)>/)
  if (!rootMatch) {
    throw new Error('Could not find <GovTalkMessage> root element')
  }
  const rootAttrs = rootMatch[1]

  // Pull out only the xmlns declarations (default + prefixed) from the root
  const namespaceDeclarations = [...rootAttrs.matchAll(/\s(xmlns(?::[a-zA-Z0-9]+)?="[^"]*")/g)]
    .map(m => m[1])
    .join(' ')

  const bodyStart = fullGovTalkXml.indexOf('<Body')
  const bodyEndTag = '</Body>'
  const bodyEnd = fullGovTalkXml.indexOf(bodyEndTag)
  if (bodyStart === -1 || bodyEnd === -1) {
    throw new Error('Could not find <Body>...</Body> in submission XML')
  }

  const fullBodyBlock = fullGovTalkXml.slice(bodyStart, bodyEnd + bodyEndTag.length)

  // Inject inherited namespace declarations onto the <Body> opening tag
  const withInheritedNamespaces = fullBodyBlock.replace(
    /^<Body([^>]*)>/,
    (_match, existingAttrs) => `<Body${existingAttrs} ${namespaceDeclarations}>`
  )

  // Remove the <IRmark>...</IRmark> node itself, preserving surrounding
  // whitespace exactly (the spec is explicit about this).
  return withInheritedNamespaces.replace(/<IRmark\b[^>]*>[\s\S]*?<\/IRmark>/, '')
}

/**
 * Computes the IRmark for a given full GovTalkMessage XML string.
 *
 * @param fullGovTalkXml   The complete submission XML, with an empty or
 *                         placeholder <IRmark> element already present in
 *                         the position it will occupy in the real submission
 *                         (its content will be stripped before hashing).
 * @param canonicalise     A function implementing W3C XML-C14N canonical-
 *                         isation. Inject this rather than hard-coding a
 *                         library here, since the right npm package may
 *                         need to be chosen/validated against HMRC's worked
 *                         examples first.
 */
export function generateIrmark(
  fullGovTalkXml: string,
  canonicalise: (xml: string) => string | Promise<string>
): Promise<IrmarkResult> | IrmarkResult {
  const bodyForHashing = extractBodyForIrmark(fullGovTalkXml)
  const canonical = canonicalise(bodyForHashing)

  const finish = (canonicalXml: string): IrmarkResult => {
    const hash = createHash('sha1').update(canonicalXml, 'utf8').digest()
    return {
      base64: hash.toString('base64'),
      base32: toBase32(hash),
    }
  }

  if (canonical instanceof Promise) {
    return canonical.then(finish)
  }
  return finish(canonical)
}

/** Minimal RFC 4648 Base32 encoder (no padding stripped) — display only. */
function toBase32(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31]
  }
  return output
}
