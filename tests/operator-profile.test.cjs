const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(path, dependencies) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name] }, console })
  return exports
}
function setup(profile, error = null) {
  const calls = []
  const db = { from(table) {
    const q = { select(columns) { calls.push(['select', table, columns]); return q }, eq(key, value) { calls.push(['eq', table, key, value]); return q }, maybeSingle: async () => ({ data: profile, error }), order() { return q }, range() { calls.push(['list', table]); return Promise.resolve({ data: [{ id: 'charity' }], error: null }) } }
    return q
  } }
  const user = { id: 'signed-in-user' }
  const guard = load('api/_utils/requireOperator.ts', { './requireUser.js': { requireUser: async () => user }, './supabase.js': { supabaseAdmin: db } }).requireOperator
  return { db, user, guard, calls }
}
test('operator lookup is scoped to authenticated ID and permits an existing operator', async () => {
  const s = setup({ role: 'operator' })
  assert.equal(await s.guard({}), s.user)
  assert.ok(s.calls.some(c => c[0] === 'eq' && c[2] === 'id' && c[3] === s.user.id))
})
test('missing profile reports account recovery guidance without granting access', async () => {
  const s = setup(null)
  await assert.rejects(s.guard({}), /Forbidden:.*no portal profile/)
})
test('non-operators and database errors remain denied', async () => {
  await assert.rejects(setup({ role: 'charity_user' }).guard({}), /Forbidden: operator access required/)
  await assert.rejects(setup(null, { message: 'Database unavailable' }).guard({}), /Database unavailable/)
  await assert.rejects(setup(null, { message: 'Multiple rows returned' }).guard({}), /Multiple rows returned/)
})
test('dashboard list shows actionable error and does not query charities without an operator profile', async () => {
  const s = setup(null)
  const handler = load('api/admin/charities/list.ts', { '../../_utils/supabase.js': { supabaseAdmin: s.db }, '../../_utils/requireOperator.js': { requireOperator: s.guard } }).default
  const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.code, 403)
  assert.match(res.body.error, /no portal profile/)
  assert.equal(s.calls.some(c => c[1] === 'charities'), false)
})
test('dashboard list still loads charities for a registered operator', async () => {
  const s = setup({ role: 'operator' })
  const handler = load('api/admin/charities/list.ts', { '../../_utils/supabase.js': { supabaseAdmin: s.db }, '../../_utils/requireOperator.js': { requireOperator: s.guard } }).default
  const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.code, 200)
  assert.equal(res.body.charities.length, 1)
})
test('user/me returns an explicit missing-profile response instead of a default role', async () => {
  const s = setup(null)
  const handler = load('api/user/me.ts', { '../_utils/requireUser.js': { requireUser: async () => s.user }, '../_utils/supabase.js': { supabaseAdmin: s.db } }).default
  const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'GET' }, res)
  assert.equal(res.code, 403)
  assert.equal(res.body.code, 'PORTAL_PROFILE_MISSING')
  assert.equal(res.body.role, undefined)
})
