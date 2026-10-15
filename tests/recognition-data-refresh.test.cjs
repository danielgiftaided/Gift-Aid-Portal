const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/pages/adminCharityDetail.tsx', 'utf8')
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let declaration
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleSendDataRequest') declaration = node.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
async function run(response, viewing) {
  let submissions = [{ id: 'target', hmrc_data_request_xml: null, hmrc_data_response_xml: null }, { id: 'other' }]
  let result, sending
  const exports = {}
  vm.runInNewContext(ts.transpileModule('const ' + declaration + '; exports.run = handleSendDataRequest', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports,
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } },
    fetch: async (url, options) => {
      assert.equal(url, '/api/admin/sendDataRequest')
      assert.equal(JSON.parse(options.body).submission_id, 'target')
      return { json: async () => response }
    },
    setSubmissions: update => { submissions = update(submissions) },
    setViewingXmlFor: update => { viewing = update(viewing) },
    setDataRequestResult: value => { result = value },
    setSendingDataRequest: value => { sending = value },
  })
  await exports.run('target')
  return { submissions, viewing, result, sending }
}
const success = { ok: true, message: 'Captured', dataRequestXml: '<request/>', dataResponseXml: '<response/>' }
test('captured data files update the open viewer and list for immediate ZIP download', async () => {
  const r = await run(success, { id: 'target', hmrc_claim_xml: '<claim/>' })
  assert.equal(r.viewing.hmrc_data_request_xml, '<request/>')
  assert.equal(r.viewing.hmrc_data_response_xml, '<response/>')
  assert.equal(r.viewing.hmrc_claim_xml, '<claim/>')
  assert.equal(r.submissions[0].hmrc_data_response_xml, '<response/>')
  assert.equal(r.submissions[1].hmrc_data_response_xml, undefined)
  assert.equal(r.result, 'Captured')
  assert.equal(r.sending, false)
})
test('completed request does not reopen a closed viewer or overwrite another submission', async () => {
  for (const viewing of [null, { id: 'other', hmrc_claim_xml: '<other/>' }]) {
    const r = await run(success, viewing)
    assert.equal(r.viewing, viewing)
    assert.equal(r.submissions[0].hmrc_data_request_xml, '<request/>')
  }
})
test('uncaptured failures leave files unchanged; captured HMRC errors remain downloadable for diagnosis', async () => {
  const r = await run({ ok: false, error: 'Save failed' }, { id: 'target' })
  assert.equal(r.viewing.hmrc_data_request_xml, undefined)
  assert.equal(r.submissions[0].hmrc_data_request_xml, null)
  assert.equal(r.result, 'Error: Save failed')
  const failedResponse = await run({ ...success, ok: false, error: 'HMRC rejected request', dataResponseXml: '<error/>' }, { id: 'target' })
  assert.equal(failedResponse.viewing.hmrc_data_response_xml, '<error/>')
  assert.equal(failedResponse.result, 'Error: HMRC rejected request')
})
