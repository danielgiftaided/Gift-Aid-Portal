const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('src/utils/authNavigation.ts', 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    { exports, Error, ...globals },
  )
  return exports
}
const auth = load()
test('admin return destinations stay internal and do not loop to the sign-in page', () => {
  for (const bad of [
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/dashboard',
    '/administrator',
    '/admin/login',
    '/admin/login?next=bad',
  ])
    assert.equal(auth.adminDestination(bad), '/admin')
  assert.equal(
    auth.adminDestination('/admin/insights?year=2025'),
    '/admin/insights?year=2025',
  )
})
test('admin intent returns verified operators to the requested page and denies charity users', () => {
  assert.equal(
    auth.destinationAfterAuth(
      { role: 'operator' },
      { adminLogin: true, adminReturnTo: '/admin/insights' },
    ),
    '/admin/insights',
  )
  assert.throws(
    () =>
      auth.destinationAfterAuth(
        { role: 'charity_user', charityId: 'charity' },
        { adminLogin: true },
      ),
    /does not have administrator access/,
  )
  assert.equal(
    auth.destinationAfterAuth({ role: 'charity_user', charityId: 'charity' }),
    '/dashboard',
  )
  assert.equal(
    auth.destinationAfterAuth({ role: 'charity_user' }),
    '/charity-setup',
  )
  assert.equal(auth.destinationAfterAuth({ role: 'operator' }), '/admin')
})
test('account verification errors are surfaced rather than navigating silently back to login', async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(
      auth.verifyPortalProfile('test-token', async (_url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-token')
        return {
          ok: false,
          status,
          json: async () => ({ ok: false, error: 'Account unavailable' }),
        }
      }),
      (e) =>
        e instanceof auth.AccountVerificationError &&
        e.status === status &&
        e.message === 'Account unavailable',
    )
  }
  await assert.rejects(
    auth.verifyPortalProfile('test-token', async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Non-JSON')
      },
    })),
    /Could not verify your account/,
  )
})
test('finish sign-in only navigates after a session and verified profile', async () => {
  const routes = []
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  }
  const helper = load({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, role: 'operator' }),
    }),
  })
  await helper.finishSignIn(
    client,
    (path, options) => routes.push({ path, options }),
    { adminLogin: true, adminReturnTo: '/admin/insights' },
  )
  assert.equal(routes[0].path, '/admin/insights')
  assert.equal(routes[0].options.replace, true)
  routes.length = 0
  await assert.rejects(
    helper.finishSignIn(
      { auth: { getSession: async () => ({ data: { session: null } }) } },
      (path) => routes.push(path),
    ),
    /session has expired/,
  )
  assert.equal(routes.length, 0)
})
function loginHandler(aal, aalError = null, role = 'operator') {
  const source = fs.readFileSync('src/pages/login.tsx', 'utf8')
  const ast = ts.createSourceFile(
    'login.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let declaration
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === 'handleLogin'
    )
      declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const routes = [],
    errors = [],
    tokens = [],
    completed = [],
    exports = {}
  vm.runInNewContext(
    ts.transpileModule('const ' + declaration + '; exports.run = handleLogin', {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      exports,
      admin: true,
      destinationAfterAuth: auth.destinationAfterAuth,
      verifyPortalProfile: async () => ({ role }),
      email: 'operator@example.test',
      password: 'synthetic-test-password',
      intent: { adminLogin: true, adminReturnTo: '/admin/insights' },
      setError: (e) => errors.push(e),
      setLoading() {},
      fetch: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          access_token: 'test-access',
          refresh_token: 'test-refresh',
        }),
      }),
      supabase: {
        auth: {
          setSession: async (session) => {
            tokens.push(session)
            return { error: null }
          },
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({
              data: aal,
              error: aalError,
            }),
          },
        },
      },
      navigate: (path, options) => routes.push({ path, options }),
      finishSignIn: async (_client, _navigate, intent) =>
        completed.push(intent),
    },
  )
  return {
    routes,
    errors,
    tokens,
    completed,
    run: () => exports.run({ preventDefault() {} }),
  }
}
test('admin login carries its intent through MFA challenge and enrolment', async () => {
  for (const next of ['aal1', 'aal2']) {
    const s = loginHandler({ currentLevel: 'aal1', nextLevel: next })
    await s.run()
    assert.equal(
      s.routes[0].path,
      next === 'aal2' ? '/mfa-challenge' : '/mfa-setup',
    )
    assert.equal(s.routes[0].options.state.adminLogin, true)
    assert.equal(s.routes[0].options.state.adminReturnTo, '/admin/insights')
    assert.equal(s.tokens[0].access_token, 'test-access')
    assert.equal(s.completed.length, 0)
  }
})
test('missing MFA result gives a retryable error instead of a null dereference or redirect', async () => {
  const s = loginHandler(null)
  await s.run()
  assert.match(s.errors.at(-1), /Could not verify/)
  assert.equal(s.routes.length, 0)
  const failed = loginHandler(null, new Error('MFA service unavailable'))
  await failed.run()
  assert.equal(failed.errors.at(-1), 'MFA service unavailable')
  const passed = loginHandler({ currentLevel: 'aal2', nextLevel: 'aal2' })
  await passed.run()
  assert.equal(passed.completed[0].adminLogin, true)
})
async function guardCheck({
  session = { access_token: 'test-token' },
  role = 'operator',
  level = 'aal2',
  next = 'aal2',
  verifyError = null,
  cancelDuringProfile = false,
} = {}) {
  const source = fs.readFileSync('src/components/AdminRouteGuard.tsx', 'utf8')
  const ast = ts.createSourceFile(
    'guard.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let arrow
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'check')
      arrow = node.initializer.arguments[0].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const requestVersion = { current: 0 }
  const routes = [],
    errors = [],
    allowed = [],
    exports = {}
  vm.runInNewContext(
    ts.transpileModule('exports.run = ' + arrow, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      exports,
      Error,
      requestVersion,
      location: { pathname: '/admin/insights', search: '?year=2025' },
      setChecking() {},
      setAllowed: (value) => allowed.push(value),
      setError: (value) => errors.push(value),
      navigate: (path, options) => routes.push({ path, options }),
      supabase: {
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({
              data: { currentLevel: level, nextLevel: next },
              error: null,
            }),
          },
        },
      },
      verifyPortalProfile: async () => {
        if (cancelDuringProfile) requestVersion.current++
        if (verifyError) throw verifyError
        return { role }
      },
      AccountVerificationError: auth.AccountVerificationError,
    },
  )
  await exports.run()
  return { routes, errors, allowed }
}
test('admin guard directs signed-out and non-operator accounts to admin sign-in', async () => {
  for (const options of [{ session: null }, { role: 'charity_user' }]) {
    const s = await guardCheck(options)
    assert.equal(s.routes[0].path, '/admin/login')
    assert.equal(
      s.routes[0].options.state.adminReturnTo,
      '/admin/insights?year=2025',
    )
    assert.ok(!s.allowed.includes(true))
  }
})
test('admin guard requires MFA before rendering and accepts only a verified operator session', async () => {
  for (const next of ['aal1', 'aal2']) {
    const s = await guardCheck({ level: 'aal1', next })
    assert.equal(
      s.routes[0].path,
      next === 'aal2' ? '/mfa-challenge' : '/mfa-setup',
    )
    assert.ok(!s.allowed.includes(true))
  }
  const allowed = await guardCheck()
  assert.ok(allowed.allowed.includes(true))
  assert.equal(allowed.routes.length, 0)
})
test('admin guard redirects expired sessions but holds service failures on a retryable error screen', async () => {
  const expired = await guardCheck({
    verifyError: new auth.AccountVerificationError('Invalid session', 401),
  })
  assert.equal(expired.routes[0].path, '/admin/login')
  const failure = await guardCheck({
    verifyError: new auth.AccountVerificationError(
      'Profile lookup unavailable',
      500,
    ),
  })
  assert.equal(failure.routes.length, 0)
  assert.equal(failure.errors.at(-1), 'Profile lookup unavailable')
  assert.ok(!failure.allowed.includes(true))
  const timeout = await guardCheck({
    verifyError: new auth.AccountVerificationError(
      'Timeout after 8000ms: account verification',
      401,
    ),
  })
  assert.equal(timeout.routes.length, 0)
  assert.match(timeout.errors.at(-1), /Timeout/)
})

test('admin sign-in rejects a charity account before sending it to MFA', async () => {
  const s = loginHandler(
    { currentLevel: 'aal1', nextLevel: 'aal2' },
    null,
    'charity_user',
  )
  await s.run()
  assert.equal(s.routes.length, 0)
  assert.match(s.errors.at(-1), /does not have administrator access/)
})

test('stale administrator verification cannot render or redirect after an account switch', async () => {
  const s = await guardCheck({ cancelDuringProfile: true })
  assert.ok(!s.allowed.includes(true))
  assert.equal(s.routes.length, 0)
})
