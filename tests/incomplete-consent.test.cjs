const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const XLSX = require('xlsx')
function evaluate(source, extra = {}) {
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(code, { exports, ...extra })
  return exports
}
const helpers = evaluate(fs.readFileSync('shared/giftAidRecords.ts', 'utf8'))
for (const page of ['adminCharityDetail', 'pendingCharities']) {
  test(`${page}: real Excel parsing preserves consent and marks missing identity fields incomplete`, async () => {
    const source = fs.readFileSync(`src/pages/${page}.tsx`, 'utf8')
    const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['categoriseRow', 'parseExcel'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n')
    const rows = [], expected = []
    for (const opt of ['Yes', 'Y', 'No', 'N', '', '   ', ' no ']) {
      for (const missing of [null, 0, 1, 2, 3]) {
        const row = ['Test', 'Donor', '1 Test Road', 'N1 1AA', '01/10/2026', 10, opt]
        if (missing !== null) row[missing] = ' '
        rows.push(row)
        expected.push(missing !== null ? 'incomplete' : helpers.isGiftAidOptOut(opt) ? 'opt_out' : 'valid')
      }
    }
    const sheet = XLSX.utils.aoa_to_sheet([['First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount', 'Gift Aid Opt-In'], ...rows])
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Donations')
    const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
    class FileReader { readAsArrayBuffer() { this.onload({ target: { result: data } }) } }
    const { parseExcel } = evaluate(functions + '\nexports.parseExcel = parseExcel', { XLSX, FileReader, Uint8Array, isGiftAidOptOut: helpers.isGiftAidOptOut })
    const parsed = await parseExcel({})
    assert.equal(parsed.length, 35)
    parsed.forEach((row, i) => {
      assert.equal(row.status, expected[i])
      assert.equal(row.giftAidOptIn, String(rows[i][6]).trim())
      if (expected[i] === 'incomplete') assert.ok(row.missingFields.length > 0)
    })
    assert.equal(parsed[0].status, 'valid', 'Title is optional')
  })
}
test('incomplete consent groups and user exports remain separate', () => {
  const records = [
    { id: 1, record_status: 'valid', gift_aid_opt_in: 'Yes', gift_aid_submitted: true },
    { id: 2, record_status: 'valid', gift_aid_opt_in: 'Yes', gift_aid_submitted: false },
    { id: 3, record_status: 'incomplete', gift_aid_opt_in: 'Yes' },
    { id: 4, record_status: 'incomplete', gift_aid_opt_in: 'No' },
    { id: 5, record_status: 'incomplete', gift_aid_opt_in: null },
    { id: 6, record_status: 'opt_out', gift_aid_opt_in: 'No' },
    { id: 7, record_status: 'valid', gift_aid_opt_in: '', gift_aid_submitted: true },
  ]
  assert.equal(helpers.giftAidRecordGroup(records[2]), 'incomplete_opt_in')
  assert.equal(helpers.giftAidRecordGroup(records[3]), 'incomplete_opt_out')
  assert.equal(helpers.giftAidRecordGroup(records[4]), 'incomplete_opt_out')
  assert.equal(helpers.userExportRecords(records, 'full').length, 7)
  assert.equal(JSON.stringify(helpers.userExportRecords(records, 'valid').map(r => r.id)), '[1]')
  const ui = fs.readFileSync('src/pages/insights.tsx', 'utf8')
  assert.ok(ui.includes("userExportRecords(records, 'full')"))
  assert.ok(ui.includes("userExportRecords(records, 'valid')"))
  assert.ok(!ui.includes('onClick={() => downloadRecordsAsCsv(records.filter'))
})
test('donor enrichment cannot create a claim for an opted-out or historic incomplete row', async () => {
  const source = fs.readFileSync('api/admin/applyDonorMatch.ts', 'utf8')
  for (const [opt, submitted] of [['No', true], ['', true], [null, true], ['Yes', false]]) {
    let stage = 0; const writes = []
    const incomplete = { id: 'incomplete', record_status: 'incomplete', gift_aid_opt_in: opt, gift_aid_submitted: submitted,
      first_name: 'Test', last_name: 'Donor', address: null, postcode: null, donation_date: '01/10/2026', amount: 10 }
    const query = { select: () => query, eq: () => query,
      single: async () => ({ data: ++stage === 1 ? incomplete : { id: 'match', address: '1 Test Road', postcode: 'N1 1AA' } }),
      update: change => { writes.push(change); return query }, then: resolve => resolve({ error: null }) }
    const dependencies = {
      '../../shared/giftAidRecords.js': helpers,
      '../_utils/requireOperator.js': { requireOperator: async () => ({ id: 'operator' }) },
      '../_utils/activityLog.js': { logActivity: async () => {} },
      '../_utils/supabase.js': { supabaseAdmin: { from: table => { assert.equal(table, 'uploaded_records'); return query } } },
    }
    const handler = evaluate(source, { require: name => dependencies[name] }).default
    const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method: 'POST', body: { incomplete_record_id: 'incomplete', matched_record_id: 'match' } }, res)
    assert.equal(res.code, 200); assert.equal(res.body.promoted, false)
    assert.equal(writes[0].record_status, submitted ? 'opt_out' : 'valid')
  }
})
