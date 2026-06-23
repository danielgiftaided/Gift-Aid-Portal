/**
 * Standalone IRmark verification script — run this on a machine with normal
 * internet access (NOT in a restricted sandbox), since it needs to reach
 * assets.publishing.service.gov.uk directly.
 *
 * What this does:
 *   1. Downloads HMRC's own worked examples: a full submission (which
 *      already has a real, correct <IRmark> value embedded), and the
 *      canonical payload HMRC says that submission should produce.
 *   2. Runs this codebase's extraction + canonicalisation + hashing logic
 *      against the full submission.
 *   3. Compares the result against both the provided canonical payload
 *      (catches bugs in extraction/canonicalisation specifically) and the
 *      IRmark value embedded in the submission itself (catches bugs
 *      anywhere in the pipeline).
 *
 * Setup:
 *   npm install xml-crypto @xmldom/xmldom
 *   node verify-irmark.js
 *
 * A clean "PASS" on both checks is the green light to trust irmark.ts
 * against real HMRC submissions. Any mismatch means something about the
 * extraction or canonicalisation step needs adjusting before going further
 * — do not proceed to a live submission until this passes.
 */

const { DOMParser } = require('@xmldom/xmldom')
const { C14nCanonicalization } = require('xml-crypto')
const crypto = require('crypto')
const https = require('https')

const FULL_SUBMISSION_URL = 'https://assets.publishing.service.gov.uk/media/5a7dbecae5274a5eaea6613e/irmarkexample-submission.xml'
const CANONICAL_PAYLOAD_URL = 'https://assets.publishing.service.gov.uk/media/5a7d4da1e5274a33be6485c9/irmarkexample-canonicalised.xml'

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// Same logic as extractBodyForIrmark() in irmark.ts — kept duplicated here
// deliberately so this script has no dependency on the rest of the codebase
// and can be run in complete isolation.
function extractBodyForIrmark(fullGovTalkXml) {
  const rootMatch = fullGovTalkXml.match(/<GovTalkMessage\b([^>]*)>/)
  if (!rootMatch) throw new Error('Could not find <GovTalkMessage> root element')
  const rootAttrs = rootMatch[1]

  const namespaceDeclarations = [...rootAttrs.matchAll(/\s(xmlns(?::[a-zA-Z0-9]+)?="[^"]*")/g)]
    .map((m) => m[1])
    .join(' ')

  const bodyStart = fullGovTalkXml.indexOf('<Body')
  const bodyEndTag = '</Body>'
  const bodyEnd = fullGovTalkXml.indexOf(bodyEndTag)
  if (bodyStart === -1 || bodyEnd === -1) throw new Error('Could not find <Body>...</Body>')

  const fullBodyBlock = fullGovTalkXml.slice(bodyStart, bodyEnd + bodyEndTag.length)

  const withInheritedNamespaces = fullBodyBlock.replace(
    /^<Body([^>]*)>/,
    (_match, existingAttrs) => `<Body${existingAttrs} ${namespaceDeclarations}>`
  )

  return withInheritedNamespaces.replace(/<IRmark\b[^>]*>[\s\S]*?<\/IRmark>/, '')
}

function canonicalise(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const c14n = new C14nCanonicalization()
  return c14n.process(doc.documentElement)
}

async function main() {
  console.log('Downloading HMRC worked examples...\n')
  const [fullSubmission, expectedCanonicalPayload] = await Promise.all([
    download(FULL_SUBMISSION_URL),
    download(CANONICAL_PAYLOAD_URL),
  ])

  // Extract the IRmark HMRC embedded in their own example submission
  const irmarkMatch = fullSubmission.match(/<IRmark[^>]*>([^<]*)<\/IRmark>/)
  if (!irmarkMatch) {
    console.error('Could not find an <IRmark> value in the downloaded example — check the URL is still valid.')
    process.exit(1)
  }
  const expectedIrmark = irmarkMatch[1].trim()

  // Run our extraction + canonicalisation
  const extractedBody = extractBodyForIrmark(fullSubmission)
  const ourCanonicalPayload = canonicalise(extractedBody)

  console.log('=== CHECK 1: Canonicalisation matches HMRC\'s own example ===')
  const normalisedOurs = ourCanonicalPayload.trim()
  const normalisedTheirs = expectedCanonicalPayload.trim()
  if (normalisedOurs === normalisedTheirs) {
    console.log('PASS — our canonical output matches HMRC\'s example exactly.\n')
  } else {
    console.log('FAIL — our canonical output does NOT match HMRC\'s example.')
    console.log('\n--- OURS ---')
    console.log(normalisedOurs)
    console.log('\n--- HMRC\'S EXAMPLE ---')
    console.log(normalisedTheirs)
    console.log('')
  }

  console.log('=== CHECK 2: Computed IRmark matches the value in HMRC\'s example submission ===')
  const hash = crypto.createHash('sha1').update(ourCanonicalPayload, 'utf8').digest()
  const computedIrmark = hash.toString('base64')

  console.log(`Expected (from HMRC's example): ${expectedIrmark}`)
  console.log(`Computed (this codebase):       ${computedIrmark}`)

  if (computedIrmark === expectedIrmark) {
    console.log('\nPASS — IRmark generation is verified correct against HMRC\'s own worked example.')
  } else {
    console.log('\nFAIL — IRmark mismatch. Do not use this against a real submission until resolved.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Verification script failed to run:', err.message)
  process.exit(1)
})
