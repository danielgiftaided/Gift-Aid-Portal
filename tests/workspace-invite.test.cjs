const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const charityId = '11111111-1111-1111-1111-111111111111'
const oldExpiry = '2020-01-01T00:00:00.000Z'

function setup(options = {}) {
  const calls = [], logs = []
  let stored = options.previous ? {
    id: 'existing', charity_id: charityId, email: 'contact@example.test',
    status: 'sent', expires_at: oldExpiry, auth_user_id: 'auth-user',
    ...options.previous,
  } : null
  const db = {
    from(table) {
      let operation = 'select', value
      const filters = {}
      let activeOnly = false
      const result = () => {
        if (operation === 'insert') {
          if (stored) return { data: null, error: { code: '23505', message: 'Duplicate sent invitation' } }
          stored = { id: 'invitation', ...value }
          return { data: stored, error: null }
        }
        if (operation === 'update') {
          if (options.renewError && value.expires_at) return { data: null, error: { message: 'Write failed' } }
          stored = { ...stored, ...value }
          return { data: { id: stored.id }, error: null }
        }
        if (operation === 'delete') { stored = null; return { error: null } }
        if (table === 'charities') return { data: options.missing ? null : { id: charityId, name: 'Test charity' } }
        if (options.lookupError) return { data: null, error: { message: 'Read failed' } }
        const matches = stored && Object.entries(filters).every(([key, value]) => stored[key] === value)
        return { data: matches && (!activeOnly || new Date(stored.expires_at) > new Date()) ? { ...stored } : null }
      }
      const q = {
        select() { return q },
        eq(key, value) { filters[key] = value; calls.push(['filter', table, key, value]); return q },
        gt() { activeOnly = true; return q },
        order() { return q },
        limit() { return q },
        maybeSingle: async () => result(),
        insert(data) { operation = 'insert'; value = data; calls.push(['insert', table, data]); return q },
        single: async () => result(),
        update(data) { operation = 'update'; value = data; calls.push(['update', table, data]); return q },
        delete() { operation = 'delete'; calls.push(['delete', table]); return q },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
      }
      return q
    },
    auth: { admin: { inviteUserByEmail: async (email, metadata) => {
      calls.push(['send', email, metadata])
      if (options.sendThrows) throw Error('Email delivery unavailable')
      return { data: { user: { id: 'auth-user' } }, error: options.sendError ? { message: 'Email rejected' } : null }
    } } },
  }
  const dependencies = {
    '../_utils/requireOperator.js': { requireOperator: async () => {
      if (options.denied) throw Error('Forbidden')
      return { id: 'operator', email: 'operator@example.test' }
    } },
    '../_utils/supabase.js': { supabaseAdmin: db },
    '../_utils/activityLog.js': { logActivity: async value => logs.push(value) },
  }
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync('api/admin/invite.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, { exports, require: name => dependencies[name], console: { error() {} } })
  return {
    calls, logs, stored: () => stored,
    async run(body = { email: ' Contact@Example.test ', charity_id: charityId }, method = 'POST') {
      const res = { setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
      await exports.default({ method, body }, res)
      return res
    },
  }
}

test('new invitation is bound to the existing workspace in both database and auth metadata', async () => {
  const e = setup()
  const response = await e.run()
  assert.equal(response.code, 200)
  assert.equal(response.body.resent, false)
  const inserted = e.calls.find(c => c[0] === 'insert')
  assert.equal(inserted[2].charity_id, charityId)
  assert.equal(inserted[2].email, 'contact@example.test')
  const sent = e.calls.find(c => c[0] === 'send')
  assert.equal(sent[2].redirectTo, 'https://portal.giftaided.com/accept-invite')
  assert.equal(sent[2].data.charity_id, charityId)
  assert.equal(sent[2].data.charity_invitation_id, 'invitation')
  assert.equal(e.logs[0].targetId, charityId)
  assert.equal(e.stored().auth_user_id, 'auth-user')
})

test('expired invitations resend using the same row and renew workspace access for seven days', async () => {
  const e = setup({ previous: {} })
  const before = Date.now()
  const response = await e.run()
  assert.equal(response.code, 200)
  assert.equal(response.body.resent, true)
  assert.equal(response.body.invitation_id, 'existing')
  assert.ok(!e.calls.some(c => c[0] === 'insert' || c[0] === 'delete'))
  const sent = e.calls.find(c => c[0] === 'send')
  assert.equal(sent[2].data.charity_invitation_id, 'existing')
  const renewed = e.stored()
  assert.equal(renewed.charity_id, charityId)
  assert.equal(renewed.auth_user_id, 'auth-user')
  assert.equal(renewed.created_by, 'operator')
  assert.ok(Date.parse(renewed.created_at) >= before)
  assert.equal(Date.parse(renewed.expires_at) - Date.parse(renewed.created_at), 7 * 24 * 60 * 60 * 1000)
  assert.match(e.logs[0].details, /resent/)
})

test('can replace an expired auth email link while the workspace invitation is still active', async () => {
  const e = setup({ previous: { expires_at: '2099-01-01T00:00:00.000Z' } })
  assert.equal((await e.run()).code, 200)
  assert.ok(e.calls.some(c => c[0] === 'send'))
  assert.ok(!e.calls.some(c => c[0] === 'insert'))
})

test('failed or thrown delivery errors preserve the previous invitation and its expiry', async () => {
  for (const failure of [{ sendError: true }, { sendThrows: true }]) {
    const e = setup({ previous: {}, ...failure })
    assert.equal((await e.run()).code, 400)
    assert.equal(e.stored().expires_at, oldExpiry)
    assert.equal(e.stored().id, 'existing')
    assert.ok(!e.calls.some(c => c[0] === 'delete' || c[0] === 'update'))
    assert.equal(e.logs.length, 0)
  }
})

test('failed delivery removes only a newly created invitation and preserves the workspace', async () => {
  for (const failure of [{ sendError: true }, { sendThrows: true }]) {
    const e = setup(failure)
    assert.equal((await e.run()).code, 400)
    assert.ok(e.calls.some(c => c[0] === 'delete' && c[1] === 'charity_invitations'))
    assert.ok(!e.calls.some(c => c[0] === 'delete' && c[1] === 'charities'))
    assert.equal(e.logs.length, 0)
  }
})

test('a failed expiry renewal is reported without deleting the invitation or claiming success', async () => {
  const e = setup({ previous: {}, renewError: true })
  const response = await e.run()
  assert.equal(response.code, 500)
  assert.match(response.body.error, /could not be renewed/)
  assert.equal(e.stored().expires_at, oldExpiry)
  assert.ok(!e.calls.some(c => c[0] === 'delete'))
  assert.equal(e.logs.length, 0)
})

test('rejects unscoped or invalid invitations before database writes or email sends', async () => {
  for (const body of [{ email: 'contact@example.test' }, { email: 'bad', charity_id: charityId }, '{']) {
    const e = setup()
    assert.equal((await e.run(body)).code, 400)
    assert.equal(e.calls.length, 0)
  }
})

test('requires operator and POST', async () => {
  const e = setup({ denied: true })
  assert.equal((await e.run()).code, 403)
  assert.equal(e.calls.length, 0)
  assert.equal((await setup().run({}, 'GET')).code, 405)
})

test('missing workspace, conflicting active invitation and failed lookups never send an email', async () => {
  for (const [options, code] of [
    [{ missing: true }, 404],
    [{ previous: { charity_id: 'other', expires_at: '2099-01-01T00:00:00.000Z' } }, 409],
    [{ lookupError: true }, 500],
  ]) {
    const e = setup(options)
    assert.equal((await e.run()).code, code)
    assert.ok(!e.calls.some(c => c[0] === 'send' || c[0] === 'insert' || c[0] === 'update'))
  }
})

test('global create flow no longer has an invite field or sends invites', () => {
  const ui = fs.readFileSync('src/pages/admin.tsx', 'utf8')
  const api = fs.readFileSync('api/admin/charities/create.ts', 'utf8')
  assert.ok(!ui.includes('inviteEmail'))
  assert.ok(!api.includes('inviteUserByEmail'))
  assert.ok(api.includes('if (body.invite_email)'))
  assert.ok(fs.readFileSync('src/pages/adminCharityDetail.tsx', 'utf8').includes('<CharityWorkspaceInvite key={id} charityId={id} charityName={charity.name} />'))
})
