const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(path, dependencies = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  }, ...globals })
  return exports
}
const types = load('shared/hmrcStatus.ts')
const derivation = load('api/_utils/deriveStatus.ts')
const submissionId = '11111111-1111-1111-1111-111111111111'
const charityId = '22222222-2222-2222-2222-222222222222'
const body = { submissionId, charityId, hmrcStatus: 'accepted', expectedHmrcStatus: 'sent', expectedStatus: 'submitted' }

function endpoint(options = {}) {
  const row = {
    id: submissionId, charity_id: charityId, hmrc_status: 'sent', status: 'submitted',
    hmrc_claim_xml: '<claim/>', hmrc_correlation_id: 'correlation',
    hmrc_submission_response_xml: '<response/>', hmrc_reference: 'reference',
    ...options.row,
  }
  const updates = [], filters = [], logs = []
  let values
  const query = {
    update(value) { values = value; updates.push(value); return query },
    eq(key, value) { filters.push([key, value]); return query },
    is(key, value) { filters.push([key, value]); return query },
    select() { return query },
    async maybeSingle() {
      if (options.dbError) return { error: Error('Unavailable') }
      if (filters.some(([key, value]) => row[key] !== value)) return { data: null }
      Object.assign(row, values)
      return { data: { id: row.id, status: row.status, hmrc_status: row.hmrc_status } }
    },
  }
  const handler = load('api/admin/updateHmrcStatus.ts', {
    '../_utils/requireOperator.js': { requireOperator: async () => {
      if (options.authError) throw Error(options.authError)
      return { id: 'operator', email: 'operator@example.test' }
    } },
    '../_utils/supabase.js': { supabaseAdmin: { from(table) { assert.equal(table, 'submissions'); return query } } },
    '../_utils/activityLog.js': { logActivity: async log => logs.push(log) },
    '../_utils/deriveStatus.js': derivation,
    '../../shared/hmrcStatus.js': types,
  }).default
  return { row, updates, filters, logs, async run(payload = body, method = 'POST') {
    const res = { setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method, body: payload }, res)
    return res
  } }
}

test('operator HMRC corrections atomically update the user-facing status and preserve claim evidence', async () => {
  for (const [hmrcStatus, status] of Object.entries({
    not_submitted: 'pending', validation_failed: 'pending', sent: 'submitted', polling: 'submitted',
    accepted: 'approved', rejected: 'rejected', error: 'rejected',
  })) {
    const e = endpoint()
    const res = await e.run({ ...body, hmrcStatus, status: 'ignored', hmrc_claim_xml: 'ignored' })
    assert.equal(res.code, 200)
    assert.equal(JSON.stringify(e.updates), JSON.stringify([{ hmrc_status: hmrcStatus, status }]))
    assert.equal(res.body.submission.status, status)
    assert.equal(res.body.submission.hmrc_status, hmrcStatus)
    assert.equal(e.row.hmrc_claim_xml, '<claim/>')
    assert.equal(e.row.hmrc_submission_response_xml, '<response/>')
    assert.equal(e.row.hmrc_correlation_id, 'correlation')
    assert.equal(e.row.hmrc_reference, 'reference')
    assert.equal(JSON.stringify(e.filters), JSON.stringify([
      ['id', submissionId], ['charity_id', charityId], ['status', 'submitted'], ['hmrc_status', 'sent'],
    ]))
    assert.equal(e.logs[0].userId, 'operator')
    assert.equal(e.logs[0].action, 'submission_hmrc_status_updated')
    assert.match(e.logs[0].details, new RegExp(`sent to ${hmrcStatus}`))
  }
})

test('nullable legacy HMRC statuses use an exact null match and can be updated', async () => {
  const e = endpoint({ row: { hmrc_status: null, status: 'pending' } })
  assert.equal((await e.run({ ...body, expectedHmrcStatus: null, expectedStatus: 'pending' })).code, 200)
  assert.equal(e.row.hmrc_status, 'accepted')
  assert.equal(e.row.status, 'approved')
  assert.ok(e.filters.some(([key, value]) => key === 'hmrc_status' && value === null))
})

test('concurrent HMRC/general changes and mismatched charity never overwrite data or log success', async () => {
  for (const row of [{ hmrc_status: 'polling' }, { status: 'approved' }, { charity_id: 'other' }, { id: 'other' }]) {
    const e = endpoint({ row })
    const before = JSON.stringify(e.row)
    assert.equal((await e.run()).code, 409)
    assert.equal(JSON.stringify(e.row), before)
    assert.equal(e.logs.length, 0)
  }
})

test('HMRC editing requires an operator and POST', async () => {
  for (const [authError, code] of [['Invalid session', 401], ['Forbidden: operator required', 403]]) {
    const e = endpoint({ authError })
    assert.equal((await e.run()).code, code)
    assert.equal(e.updates.length, 0)
  }
  const e = endpoint()
  assert.equal((await e.run(body, 'GET')).code, 405)
  assert.equal(e.updates.length, 0)
})

test('invalid input and attempts to bypass claim building do not write', async () => {
  for (const payload of ['{', null, [], {},
    { ...body, submissionId: 'bad' }, { ...body, charityId: 'bad' },
    { ...body, hmrcStatus: 'paid' }, { ...body, hmrcStatus: 'ready_to_send' },
    { ...body, expectedHmrcStatus: undefined }, { ...body, expectedHmrcStatus: 'unknown' },
    { ...body, expectedStatus: 'unknown' },
  ]) {
    const e = endpoint()
    assert.equal((await e.run(payload)).code, 400)
    assert.equal(e.updates.length, 0)
  }
})

test('database failure cannot report success or emit a successful activity log', async () => {
  const e = endpoint({ dbError: true })
  assert.equal((await e.run()).code, 500)
  assert.equal(e.row.hmrc_status, 'sent')
  assert.equal(e.logs.length, 0)
})

function adminHandler(responseCode = 200) {
  const source = fs.readFileSync('src/pages/adminCharityDetail.tsx', 'utf8')
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleHmrcStatusChange') declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const exports = {}, calls = [], messages = [], saves = []
  let rows = [{ id: submissionId, status: 'submitted', hmrc_status: 'sent' }]
  vm.runInNewContext(ts.transpileModule(declaration + '; exports.run = handleHmrcStatusChange', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, Error, savingStatusId: null, savingHmrcStatusId: null, id: charityId,
    setSavingHmrcStatusId: value => saves.push(value), setStatusMessage: value => messages.push(value),
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) } },
    fetch: async (url, options) => {
      calls.push({ url, options })
      return { ok: responseCode === 200, status: responseCode, json: async () => responseCode === 200
        ? { ok: true, submission: { id: submissionId, hmrc_status: 'accepted', status: 'approved' } }
        : { ok: false, error: 'Unable to save' } }
    },
    loadData: async () => calls.push('refresh'),
    setSubmissions: fn => { rows = fn(rows) }, hmrcStatusLabel: types.hmrcStatusLabel,
  })
  return { calls, messages, saves, rows: () => rows, run: () => exports.run(rows[0], 'accepted') }
}

test('admin saves both returned statuses and sends both expected values with authentication', async () => {
  const e = adminHandler()
  await e.run()
  assert.equal(e.calls[0].url, '/api/admin/updateHmrcStatus')
  assert.equal(e.calls[0].options.headers.Authorization, 'Bearer synthetic')
  assert.deepEqual(JSON.parse(e.calls[0].options.body), body)
  assert.equal(e.rows()[0].status, 'approved')
  assert.equal(e.rows()[0].hmrc_status, 'accepted')
  assert.equal(e.messages.at(-1).ok, true)
  assert.equal(e.saves.at(-1), null)
})

test('admin preserves displayed values on failure and refreshes conflicts before retrying', async () => {
  for (const code of [500, 409]) {
    const e = adminHandler(code)
    await e.run()
    assert.equal(e.rows()[0].hmrc_status, 'sent')
    assert.equal(e.rows()[0].status, 'submitted')
    assert.equal(e.calls.includes('refresh'), code === 409)
    assert.equal(e.messages.at(-1).ok, false)
    assert.equal(e.saves.at(-1), null)
  }
})
