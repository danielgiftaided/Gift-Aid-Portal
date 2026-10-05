const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(path, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  }, console, ...globals })
  return exports
}
const submissionId = '11111111-1111-1111-1111-111111111111'
const charityId = '22222222-2222-2222-2222-222222222222'
function endpoint(options = {}) {
  const updates = [], filters = [], logs = []
  const query = {
    update: value => { updates.push(value); return query },
    eq: (key, value) => { filters.push([key, value]); return query },
    select: () => query,
    maybeSingle: async () => ({ data: options.conflict ? null : { id: submissionId, status: 'approved' }, error: options.dbError }),
  }
  const handler = load('api/admin/updateSubmissionStatus.ts', {
    '../_utils/requireOperator.js': { requireOperator: async () => {
      if (options.authError) throw new Error(options.authError)
      return { id: 'operator', email: 'operator@example.test' }
    } },
    '../_utils/supabase.js': { supabaseAdmin: { from: table => { assert.equal(table, 'submissions'); return query } } },
    '../_utils/activityLog.js': { logActivity: async log => logs.push(log) },
  }).default
  const res = { setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  const run = async (body = { submissionId, charityId, status: 'approved', expectedStatus: 'pending' }, method = 'POST') => {
    await handler({ method, body }, res)
    return res
  }
  return { run, updates, filters, logs }
}
test('operator saves only display status, scoped to charity and expected status, and records audit', async () => {
  const e = endpoint(); const res = await e.run()
  assert.equal(res.code, 200)
  assert.equal(JSON.stringify(e.updates), '[{"status":"approved"}]')
  assert.equal(JSON.stringify(e.filters), JSON.stringify([['id', submissionId], ['charity_id', charityId], ['status', 'pending']]))
  assert.equal(e.logs[0].userId, 'operator')
  assert.match(e.logs[0].details, /pending to approved/)
})
for (const [error, code] of [['Forbidden: operator access required', 403], ['Invalid session', 401]]) {
  test(`rejects ${error} without writes`, async () => {
    const e = endpoint({ authError: error }); assert.equal((await e.run()).code, code); assert.equal(e.updates.length, 0)
  })
}
test('rejects unsupported method, malformed JSON, unknown status and invalid identifiers', async () => {
  for (const [body, method, code] of [
    [{}, 'GET', 405], ['{', 'POST', 400],
    [{ submissionId, charityId, status: 'sent', expectedStatus: 'pending' }, 'POST', 400],
    [{ submissionId: 'invalid', charityId, status: 'approved', expectedStatus: 'pending' }, 'POST', 400],
  ]) {
    const e = endpoint(); assert.equal((await e.run(body, method)).code, code); assert.equal(e.updates.length, 0)
  }
})
test('conflict and database errors do not report success or log a successful change', async () => {
  for (const [options, code] of [[{ conflict: true }, 409], [{ dbError: new Error('database unavailable') }, 500]]) {
    const e = endpoint(options); assert.equal((await e.run()).code, code); assert.equal(e.logs.length, 0)
  }
})
test('portal subscribes with tenant filter, refreshes on update, polls, and cleans up', async () => {
  let effect, listener, tick, removed = false, cleared = false, focus
  const seen = [], filters = []
  const query = { select: () => query, eq: (field, value) => { filters.push([field, value]); return query }, order: () => query }
  const channel = { on: (_event, config, callback) => {
    assert.equal(config.filter, `charity_id=eq.${charityId}`); listener = callback; return channel
  }, subscribe: callback => { callback('SUBSCRIBED'); return channel } }
  const hook = load('src/hooks/useSubmissionStatuses.ts', {
    react: { useRef: current => ({ current }), useEffect: fn => { effect = fn } },
    '../lib/supabase': { supabase: { from: () => query, channel: () => channel, removeChannel: async () => { removed = true } } },
    '../utils/fetchAll': { fetchAllRows: async factory => { factory(); return [{ id: submissionId, status: 'approved' }] } },
  }, {
    document: { visibilityState: 'visible' },
    window: { setInterval: fn => { tick = fn; return 1 }, clearInterval: () => { cleared = true },
      addEventListener: (_name, fn) => { focus = fn }, removeEventListener: (_name, fn) => assert.equal(fn, focus) },
  }).useSubmissionStatuses
  hook('charity_id', charityId, rows => seen.push(rows))
  const cleanup = effect()
  await new Promise(resolve => setImmediate(resolve))
  const initial = seen.length
  listener(); await new Promise(resolve => setImmediate(resolve)); assert.ok(seen.length > initial)
  tick(); focus(); await new Promise(resolve => setImmediate(resolve))
  assert.ok(filters.every(([field, value]) => field === 'charity_id' && value === charityId))
  const count = seen.length
  listener(); cleanup(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(seen.length, count); assert.ok(removed && cleared)
})
