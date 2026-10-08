const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const XLSX = require('xlsx')
const { DOMParser } = require('@xmldom/xmldom')
function load(path, dependencies = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name] }, console, ...globals })
  return exports
}
const mapper = load('api/_utils/buildClaimFromSubmission.ts')
const builder = load('api/_utils/r68XmlBuilder.ts')
const protocol = load('api/_utils/transactionEngine.ts')
const charity = { id: 'charity', name: 'A Fundraising Organisation', charity_id: 'AB12345', charity_number: '123456', agent_nominee_reference: '96100000727696' }
const submission = { id: 'submission', charity_id: 'charity', tax_year: '2015/16', adjustment_amount: 50, adjustment_explanation: 'Correction to previous over-claim' }
const mary = { id: 'mary', title: 'Mrs', first_name: 'Mary', last_name: 'Smith', address: '100', postcode: 'AB23 4CD', donation_date: '07/04/15', amount: 500, sponsored: true }
const william = { id: 'william', title: 'Captain', first_name: 'William', last_name: 'Black', address: '59 BFPO 8', postcode: 'BFPO 8', donation_date: '20/04/15', amount: 20 }
const gasds = { claim_year: 2014, amount: 1000, connected_charities: true, connected_charity_details: [{ charityName: 'Thanks for the Money', hmrcRef: 'AB98765', year: 2014, amount: 1000 }], community_buildings: true, community_building_details: [{ buildingName: 'The Village Shed', address: 'The Village Green, Givingsville', postcode: 'AA11 1AA', year: 2014, amount: 101 }, { buildingName: 'The Village Shack', address: 'The Park, Givingsville', postcode: 'AA2 2AA', year: 2014, amount: 999.99 }], adjustment: 25, adjustment_explanation: 'GASDS correction to previous claim' }
const credentials = { vendorId: '9330', productName: 'Gift Aided Portal', productVersion: '1.0', senderId: 'test-sender', senderPassword: 'test-password', isLive: false, agentOrgName: 'Gift Aided', agentPostcode: 'WC2H 9JQ', agentPhone: '01234567890' }
const otherDonors = [
  { id: 'jim', title: null, first_name: 'Jim', last_name: 'Harris', address: '19 The Promenade, Benidorm, Spain', postcode: 'X', donation_date: '15/04/15', amount: 10 },
  { id: 'bill', title: null, first_name: 'Bill', last_name: 'Hill-Jones', address: '1', postcode: 'BA23 9CD', donation_date: '17/04/15', amount: 2.50 },
  { id: 'bob', title: null, first_name: 'Bob', last_name: 'Hill-Jones', address: '1', postcode: 'BA23 9CD', donation_date: '20/04/15', amount: 12 },
  { id: 'aggregated', aggregated: true, aggregated_description: '200 x £5 payments from members', donation_date: '20/04/15', amount: 1000 },
]
function claimXml(donors = [mary, william, ...otherDonors], s = submission, g = gasds) {
  const result = mapper.buildClaimFromSubmission(charity, s, donors, g, [{ id: 'income', payer: 'Bert Green', date: '10/04/2015', gross_amount: 13.12, tax_deducted: 2.62 }])
  assert.equal(result.errors.length, 0, result.errors.join('\n'))
  return builder.buildR68Submission(result.claim, credentials)
}
test('recognition claim preserves Mary sponsorship, BFPO identity and distinct adjustments', () => {
  const xml = claimXml()
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const gads = [...Array.from(doc.getElementsByTagName('GAD'))]
  assert.equal(gads[0].getElementsByTagName('Sponsored')[0].textContent, 'yes')
  assert.equal(gads[1].getElementsByTagName('Sponsored').length, 0)
  assert.equal(gads[1].getElementsByTagName('House')[0].textContent, '59')
  assert.equal(gads[1].getElementsByTagName('Postcode')[0].textContent, 'BF1 2AB')
  assert.equal(gads[1].getElementsByTagName('Overseas').length, 0)
  assert.equal(gads[1].getElementsByTagName('Ttl')[0].textContent, 'Capt')
  assert.equal(doc.getElementsByTagName('Adjustment')[0].textContent, '50.00')
  assert.equal(doc.getElementsByTagName('Adj')[0].textContent, '25.00')
  assert.match(doc.getElementsByTagName('OtherInfo')[0].textContent, /GASDS correction/)
})
test('overseas donors remain overseas; unknown BFPO numbers require a verified postcode', () => {
  assert.match(claimXml([{ ...mary, sponsored: false, postcode: 'X' }]), /<Overseas>yes<\/Overseas>/)
  const result = mapper.buildClaimFromSubmission(charity, submission, [{ ...william, postcode: 'BFPO 999' }])
  assert.match(result.errors.join(' '), /UK-format BFPO postcode/)
})
test('GASDS adjustment supports standalone explanation and does not invent zero corrections', () => {
  const s = { ...submission, adjustment_amount: null, adjustment_explanation: null }
  assert.match(claimXml([], s), /<OtherInfo>GASDS correction/)
  assert.doesNotMatch(claimXml([], s, { ...gasds, adjustment: undefined, adjustment_explanation: null }), /<Adj>/)
  for (const g of [{ ...gasds, adjustment: -25 }, { ...gasds, adjustment_explanation: null }]) {
    const result = mapper.buildClaimFromSubmission(charity, s, [], g)
    assert.ok(result.errors.length > 0)
  }
})
test('protocol data request authenticates as the original sender with empty correlation ID', () => {
  const xml = protocol.buildDataRequestMessage('HMRC-CHAR-CLM', claimXml())
  assert.match(xml, /<Qualifier>request<\/Qualifier>\s*<Function>list<\/Function>/)
  assert.match(xml, /<CorrelationID\/>/)
  assert.match(xml, /<SenderID>test-sender<\/SenderID>/)
  assert.match(xml, /<Value>test-password<\/Value>/)
  assert.throws(() => protocol.buildDataRequestMessage('HMRC-CHAR-CLM', '<SenderDetails/>'), /authentication/)
  assert.match(protocol.buildDeleteMessage('HMRC-CHAR-CLM', 'ABC'), /<Function>delete<\/Function>\s*<CorrelationID>ABC/)
})
for (const page of ['adminCharityDetail', 'pendingCharities']) {
  test(`${page} spreadsheet parser retains sponsored-event indicators`, async () => {
    const source = fs.readFileSync(`src/pages/${page}.tsx`, 'utf8')
    const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['categoriseRow', 'parseExcel'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount', 'Gift Aid Opt-In', 'Sponsored Event'], ['Mary', 'Smith', '100', 'AB23 4CD', '07/04/15', 500, 'Y', 'Yes'], ['William', 'Black', '59', 'BF1 2AB', '20/04/15', 20, 'Y', 'No']]), 'Donations')
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    class FileReader { readAsArrayBuffer() { this.onload({ target: { result: data } }) } }
    const exports = {}
    vm.runInNewContext(ts.transpileModule(functions + '\nexports.parseExcel=parseExcel', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, { exports, XLSX, FileReader, Uint8Array, isGiftAidOptOut: value => !value || /^(N|NO)$/i.test(value) })
    const rows = await exports.parseExcel({})
    assert.equal(rows[0].sponsored, true)
    assert.equal(rows[1].sponsored, false)
  })
}
function exportEndpoint(overrides = {}) {
  const data = { id: 'submission', tax_year: '2015/16', hmrc_status: 'accepted', hmrc_claim_xml: claimXml(), hmrc_acknowledgement_xml: '<Qualifier>acknowledgement</Qualifier>', hmrc_submission_poll_xml: '<Qualifier>poll</Qualifier>', hmrc_submission_response_xml: '<Qualifier>response</Qualifier>', hmrc_delete_request_xml: '<Function>delete</Function>', hmrc_delete_response_xml: '<Qualifier>response</Qualifier>', hmrc_data_request_xml: '<Function>list</Function>', hmrc_data_response_xml: '<Qualifier>response</Qualifier>', ...overrides }
  const q = { select() { return q }, eq() { return q }, single: async () => ({ data, error: null }) }
  return load('api/admin/exportRecognitionPackage.ts', { '../_utils/supabase.js': { supabaseAdmin: { from: () => q } }, '../_utils/requireOperator.js': { requireOperator: async () => ({ id: 'operator' }) }, '../_utils/transactionEngine.js': protocol }).default
}
test('recognition export rejects captured fatal errors and normalises the recognition timestamp once', async () => {
  for (const bad of [false, true]) {
    const handler = exportEndpoint({ hmrc_claim_xml: claimXml().replace('</MessageDetails>', '<GatewayTimestamp>2026-01-01T00:00:00</GatewayTimestamp></MessageDetails>'), ...(bad ? { hmrc_delete_response_xml: '<Qualifier>error</Qualifier><GovTalkErrors><Error><Number>1001</Number><Type>fatal</Type><Text>Invalid endpoint</Text></Error></GovTalkErrors>' } : {}) })
    const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method: 'GET', query: { submission_id: 'submission' } }, res)
    assert.equal(res.body.readyToSubmit, !bad)
    assert.equal(res.body.invalid.length, bad ? 1 : 0)
    const xml = res.body.files['R68_submission.xml']
    assert.equal((xml.match(/<GatewayTimestamp>/g) || []).length, 1)
    assert.match(xml, /<GatewayTimestamp>2015-05-01T00:00:00<\/GatewayTimestamp>/)
  }
})
test('GASDS form saves and clears an independent adjustment and refuses invalid values', async () => {
  const source = fs.readFileSync('src/pages/adminCharityDetail.tsx', 'utf8')
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleSaveGasds') declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const [input, explanation, valid] of [['25.00', 'Previous GASDS overclaim', true], ['', '', true], ['0', 'Zero adjustment', true], ['-25', 'Invalid', false], ['1.234', 'Invalid', false], ['25', '', false]]) {
    const writes = [], errors = [], exports = {}
    const globals = { exports, gasdsAdjustmentInput: input, gasdsAdjustmentExplanation: explanation, gasdsAmountInput: '1000', gasdsCommunityInput: false, gasdsBuildingList: [], gasdsConnectedInput: false, gasdsConnectedCharities: [], gasdsCollectionDates: [], gasdsBankedDates: [], gasdsModalMode: 'attached', gasdsModalFor: { id: 'submission', tax_year: '2015/16' }, deriveGasdsClaimYear: () => 2014, setGasdsError: value => errors.push(value), setSavingGasds() {}, closeGasdsModal() {}, loadData: async () => {}, supabase: { from: table => ({ upsert: async value => { assert.equal(table, 'gasds_claims'); writes.push(value); return { error: null } } }) } }
    vm.runInNewContext(ts.transpileModule('const ' + declaration + '; exports.run = handleSaveGasds', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, globals)
    await exports.run()
    assert.equal(writes.length, valid ? 1 : 0)
    if (valid) { assert.equal(writes[0].adjustment, input === '' ? null : Number(input)); assert.equal(writes[0].adjustment_explanation, input === '' ? null : explanation) }
    else assert.ok(errors.some(Boolean))
  }
})
test('DATA_REQUEST uses the submission endpoint and reports HMRC errors as failures', async () => {
  for (const qualifier of ['response', 'error']) {
    const calls = [], updates = []
    const q = { select() { return q }, eq() { return q }, single: async () => ({ data: { hmrc_correlation_id: 'ABC', hmrc_response_endpoint: 'https://example.test/poll', hmrc_claim_xml: claimXml() } }), update(value) { updates.push(value); return q }, then(resolve) { resolve({ error: null }) } }
    const handler = load('api/admin/sendDataRequest.ts', { '../_utils/supabase.js': { supabaseAdmin: { from: () => q } }, '../_utils/requireOperator.js': { requireOperator: async () => ({ id: 'operator' }) }, '../_utils/transactionEngine.js': { ...protocol, postToTransactionEngine: async (xml, url) => { calls.push({ xml, url }); return `<Qualifier>${qualifier}</Qualifier>` } } }).default
    const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method: 'POST', body: { submission_id: 'submission' } }, res)
    assert.equal(calls[0].url, protocol.ETS_SUBMISSION_ENDPOINT)
    assert.match(calls[0].xml, /<CorrelationID\/>/)
    assert.equal(res.code, qualifier === 'response' ? 200 : 502)
    assert.equal(res.body.ok, qualifier === 'response')
    assert.equal(updates.length, 1, 'Capture failed response for diagnosis too')
  }
})
test('final poll cleans up via the submission endpoint rather than polling endpoint', async () => {
  const calls = []
  const q = { select() { return q }, eq() { return q }, single: async () => ({ data: { hmrc_status: 'sent', hmrc_correlation_id: 'ABC', hmrc_response_endpoint: 'https://example.test/poll' } }), update() { return q }, then(resolve) { resolve({ error: null }) } }
  const handler = load('api/admin/pollClaim.ts', { '../_utils/supabase.js': { supabaseAdmin: { from: () => q } }, '../_utils/requireOperator.js': { requireOperator: async () => ({ id: 'operator' }) }, '../_utils/transactionEngine.js': { ...protocol, postToTransactionEngine: async (xml, url) => { calls.push({ xml, url }); return '<Qualifier>response</Qualifier>' } }, '../_utils/activityLog.js': { logActivity: async () => {} }, '../_utils/deriveStatus.js': { deriveStatus: () => 'approved' } }).default
  const res = { status() { return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'POST', body: { submission_id: 'submission' } }, res)
  assert.equal(calls[0].url, 'https://example.test/poll')
  assert.equal(calls[1].url, protocol.ETS_SUBMISSION_ENDPOINT)
  assert.match(calls[1].xml, /<Function>delete<\/Function>/)
})
test('rebuilding clears previous exchange evidence and cannot discard an active transaction', async () => {
  for (const status of ['accepted', 'sent', 'polling']) {
    const writes = []
    const rows = { submissions: { ...submission, hmrc_status: status }, charities: charity, donations: [mary, william], gasds_claims: gasds, other_income: [] }
    const db = { from(table) { const q = { select() { return q }, eq() { return q }, single: async () => ({ data: rows[table], error: null }), maybeSingle: async () => ({ data: rows[table], error: null }), update(value) { writes.push(value); return q }, then(resolve) { resolve({ data: rows[table], error: null }) } }; return q } }
    const handler = load('api/admin/submitClaim.ts', { '../_utils/supabase.js': { supabaseAdmin: db }, '../_utils/requireOperator.js': { requireOperator: async () => ({ id: 'operator' }) }, '../_utils/buildClaimFromSubmission.js': mapper, '../_utils/r68XmlBuilder.js': builder, '../_utils/irmark.js': { generateIrmark: () => ({ base64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' }) }, '../_utils/deriveStatus.js': { deriveStatus: () => 'pending' }, '../_utils/activityLog.js': { logActivity: async () => {} } }, { process: { env: { HMRC_AGENT_POSTCODE: 'WC2H 9JQ', HMRC_AGENT_PHONE: '01234567890' } } }).default
    const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method: 'POST', body: { submission_id: 'submission' } }, res)
    assert.equal(res.code, status === 'accepted' ? 200 : 409)
    if (status === 'accepted') {
      assert.equal(writes.length, 1)
      assert.match(writes[0].hmrc_claim_xml, /<Sponsored>yes<\/Sponsored>/)
      for (const field of ['hmrc_correlation_id','hmrc_response_endpoint','hmrc_acknowledgement_xml','hmrc_submission_poll_xml','hmrc_submission_response_xml','hmrc_delete_request_xml','hmrc_delete_response_xml','hmrc_data_request_xml','hmrc_data_response_xml']) assert.equal(writes[0][field], null, field)
    } else assert.equal(writes.length, 0)
  }
})
