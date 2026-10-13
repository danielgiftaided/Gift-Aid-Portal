const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(file, deps = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in deps, name)
        return deps[name]
      },
      console,
      Date,
      Map,
      Set,
      ...globals,
    },
  )
  return exports
}
const consent = load('shared/giftAidRecords.ts')
const a = load('shared/analytics.ts', { './giftAidRecords': consent })
const record = (overrides = {}) => ({
  id: 'row',
  charity_id: 'a',
  donation_date: '2025-04-07',
  tax_year: 'wrong',
  amount: 100,
  record_status: 'valid',
  gift_aid_opt_in: 'Yes',
  gift_aid_submitted: true,
  ...overrides,
})
const claim = (overrides = {}) => ({
  id: 'claim',
  charity_id: 'a',
  tax_year: '2025/26',
  submission_date: '2025-05-01',
  amount_claimed: 25,
  number_of_donations: 1,
  status: 'approved',
  hmrc_status: 'not_submitted',
  ...overrides,
})
const charities = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
]
const all = { taxYear: 'all', charityId: 'all' }
test('report distinguishes recorded claims from HMRC accepted and portal-approved totals', () => {
  const result = a.buildAnalytics(
    [
      claim(),
      claim({ id: 'two', amount_claimed: '50.25', hmrc_status: 'accepted' }),
      claim({
        id: 'three',
        amount_claimed: 10,
        status: 'paid',
        hmrc_status: 'rejected',
      }),
    ],
    [],
    charities,
    all,
  )
  assert.equal(result.recorded, 85.25)
  assert.equal(result.accepted, 50.25)
  assert.equal(
    result.pipeline.reduce((sum, p) => sum + p.count, 0),
    3,
  )
})
test('quality buckets are exclusive and recoverability excludes opt-outs and other-provider records', () => {
  const records = [
    record(),
    record({ record_status: 'incomplete' }),
    record({ record_status: 'incomplete', gift_aid_opt_in: 'No' }),
    record({ gift_aid_submitted: false }),
    record({ record_status: 'opt_out', gift_aid_opt_in: 'No' }),
    record({ record_status: 'incomplete', gift_aid_submitted: false }),
  ]
  const result = a.buildAnalytics([], records, charities, all)
  assert.equal(
    result.quality.reduce((sum, g) => sum + g.count, 0),
    6,
  )
  assert.equal(result.potential, 25)
  assert.equal(result.recoverable, 25)
  assert.equal(result.incompleteCount, 1)
  assert.equal(
    result.quality.find((g) => g.key === 'incomplete_opt_out').count,
    1,
  )
  assert.equal(result.quality.find((g) => g.key === 'historic').count, 1)
})
test('tax year uses valid donation dates, including April boundary, and never invents a current year', () => {
  assert.equal(
    a.recordTaxYear(record({ donation_date: '05/04/25' })),
    '2024/25',
  )
  assert.equal(
    a.recordTaxYear(record({ donation_date: '06/04/2025' })),
    '2025/26',
  )
  assert.equal(a.donationDate('31/02/2025'), null)
  assert.equal(a.donationDate('2025-02-31'), null)
  assert.equal(
    a.recordTaxYear(record({ donation_date: null, tax_year: null })),
    'Unknown',
  )
  assert.equal(
    a.recordTaxYear(record({ donation_date: 'invalid', tax_year: '2023/24' })),
    '2023/24',
  )
})
test('year and charity filters affect all metrics and rankings without merging duplicate charity names', () => {
  const cs = [
    { id: 'a', name: 'Same name' },
    { id: 'b', name: 'Same name' },
  ]
  const result = a.buildAnalytics(
    [
      claim(),
      claim({ id: 'b', charity_id: 'b', amount_claimed: 100 }),
      claim({ id: 'old', tax_year: '2024/25' }),
    ],
    [
      record(),
      record({ charity_id: 'b', amount: 500 }),
      record({ donation_date: '2024-05-01' }),
    ],
    cs,
    { charityId: 'a', taxYear: '2025/26' },
  )
  assert.equal(result.recorded, 25)
  assert.equal(result.donationValue, 100)
  assert.equal(result.ranking.length, 1)
  assert.equal(result.ranking[0].id, 'a')
  assert.equal(result.records.length, 1)
  assert.equal(result.byYear.length, 1)
})
test('trend fills missing months, excludes undated rows and handles zero denominators', () => {
  const result = a.buildAnalytics(
    [],
    [
      record({ donation_date: '2025-01-01' }),
      record({ donation_date: '2025-03-01' }),
      record({ donation_date: null }),
    ],
    [],
    all,
  )
  assert.equal(result.monthly.length, 3)
  assert.equal(result.monthly[1].month, '2025-02')
  assert.equal(result.monthly[1].donations, 0)
  assert.equal(result.undatedRecords, 1)
  const empty = a.buildAnalytics([], [], [], all)
  assert.equal(empty.readiness, null)
  assert.equal(empty.averageDonation, null)
  assert.equal(a.numberValue('bad'), 0)
})
test('distribution includes boundary values once; unknown statuses remain in the pipeline', () => {
  const result = a.buildAnalytics(
    [claim({ hmrc_status: 'unrecognised' })],
    [0, 5, 20, 50, 100, 500, 501].map((amount) => record({ amount })),
    [],
    all,
  )
  assert.equal(
    result.distribution.reduce((sum, d) => sum + d.count, 0),
    6,
  )
  assert.ok(result.distribution.every((d) => d.count === 1))
  assert.equal(result.nonPositiveRecords, 1)
  assert.equal(result.pipeline.find((p) => p.key === 'unknown').count, 1)
})
test('CSV exports preserve donor fields, effective year and protect spreadsheet formula cells', () => {
  const utils = load('src/utils/analyticsData.ts', {
    '../lib/supabase': { supabase: {} },
    './fetchAll': {},
    '../../shared/analytics': a,
    '../../shared/giftAidRecords': consent,
  })
  const csv = utils.recordCsv([
    record({
      first_name: '=1+1',
      last_name: 'Hill,"Jones',
      donation_date: '06/04/25',
    }),
  ])
  assert.ok(csv.includes('"\'=1+1"'))
  assert.ok(csv.includes('Hill,""Jones'))
  assert.ok(csv.includes('2025/26'))
})
function portal(rows, denied = false, dbError = false) {
  const calls = []
  const db = {
    from(table) {
      const q = {
        select(fields) {
          calls.push(['select', table, fields])
          return q
        },
        order(field) {
          assert.equal(field, 'id')
          return q
        },
        range(from, to) {
          calls.push(['range', table, from, to])
          return Promise.resolve({
            data: rows[table].slice(from, to + 1),
            error: dbError ? { message: 'Denied' } : null,
          })
        },
      }
      return q
    },
  }
  const handler = load('api/admin/portalInsights.ts', {
    '../_utils/supabase.js': { supabaseAdmin: db },
    '../_utils/requireOperator.js': {
      requireOperator: async () => {
        if (denied) throw new Error('Forbidden')
        return { id: 'operator' }
      },
    },
  }).default
  return {
    calls,
    run: async (query = {}) => {
      const res = {
        status(code) {
          this.code = code
          return this
        },
        json(body) {
          this.body = body
          return this
        },
      }
      await handler({ method: 'GET', query }, res)
      return res
    },
  }
}
test('portfolio API pages past 1000 rows, preserves old totals and excludes donor identity fields', async () => {
  const s = portal({
    charities,
    submissions: Array.from({ length: 1001 }, (_, i) =>
      claim({ id: String(i) }),
    ),
    uploaded_records: Array.from({ length: 1001 }, (_, i) =>
      record({ id: String(i) }),
    ),
  })
  const res = await s.run()
  assert.equal(res.code, 200)
  assert.equal(res.body.totalSubmissions, 1001)
  assert.equal(res.body.analytics.records.length, 1000)
  assert.equal(res.body.totalGiftAidClaimed, 25025)
  assert.equal(res.body.recordsNextOffset, 1000)
  assert.ok(
    s.calls.some(
      (c) => c[0] === 'range' && c[1] === 'submissions' && c[2] === 1000,
    ),
  )
  for (const c of s.calls.filter(
    (c) => c[0] === 'select' && c[1] === 'uploaded_records',
  ))
    assert.ok(!/first_name|last_name|address|postcode/.test(c[2]))
})
test('portfolio API requires operator authorization and reports source failures instead of partial totals', async () => {
  const denied = portal(
    { charities: [], submissions: [], uploaded_records: [] },
    true,
  )
  assert.equal((await denied.run()).code, 403)
  assert.equal(denied.calls.length, 0)
  const failed = await portal(
    { charities: [], submissions: [], uploaded_records: [] },
    false,
    true,
  ).run()
  assert.equal(failed.code, 500)
  assert.equal(failed.body.ok, false)
})
test('portfolio loader reads every record page and refuses partial or non-advancing results', async () => {
  const initial = {
    ok: true,
    analytics: {
      charities,
      submissions: [claim()],
      records: [record({ id: 'first' })],
    },
    recordsNextOffset: 1000,
  }
  for (const scenario of ['complete', 'failure', 'stuck']) {
    const urls = [],
      exports = {}
    const deps = {
      '../lib/supabase': { supabase: {} },
      './fetchAll': {},
      '../../shared/analytics': a,
      '../../shared/giftAidRecords': consent,
    }
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync('src/utils/analyticsData.ts', 'utf8'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
          },
        },
      ).outputText,
      {
        exports,
        require: (name) => deps[name],
        fetch: async (url, options) => {
          urls.push(url)
          assert.equal(options.headers.Authorization, 'Bearer test-token')
          const json =
            urls.length === 1
              ? initial
              : scenario === 'failure'
                ? { ok: false, error: 'Page unavailable' }
                : {
                    ok: true,
                    records: [record({ id: 'last' })],
                    nextOffset: scenario === 'stuck' ? 1000 : null,
                  }
          return { ok: json.ok, json: async () => json }
        },
      },
    )
    if (scenario === 'complete') {
      const result = await exports.loadPortfolioAnalytics('test-token')
      assert.equal(result.records.length, 2)
      assert.equal(result.records[1].id, 'last')
      assert.ok(urls[1].includes('mode=records&offset=1000'))
    } else
      await assert.rejects(
        exports.loadPortfolioAnalytics('test-token'),
        scenario === 'failure' ? /Page unavailable/ : /advance/,
      )
  }
})
test('record-page endpoint enforces offset validation and never returns donor identity', async () => {
  const s = portal({
    charities: [],
    submissions: [],
    uploaded_records: Array.from({ length: 1001 }, (_, i) =>
      record({ id: String(i) }),
    ),
  })
  const last = await s.run({ mode: 'records', offset: '1000' })
  assert.equal(last.code, 200)
  assert.equal(last.body.records.length, 1)
  assert.equal(last.body.nextOffset, null)
  assert.equal(last.body.analytics, undefined)
  for (const offset of ['-1', '1.5', 'not-a-number'])
    assert.equal((await s.run({ mode: 'records', offset })).code, 400)
  assert.equal((await s.run({ mode: 'unknown' })).code, 400)
})
test('admin status refresh includes HMRC status, scopes events to the charity and cleans up', async () => {
  let effect,
    listener,
    removed = false,
    cleared = false
  const seen = []
  const query = {
    select(fields) {
      assert.ok(fields.includes('hmrc_status'))
      return query
    },
    eq(field, value) {
      assert.equal(field, 'charity_id')
      assert.equal(value, 'charity-a')
      return query
    },
    order() {
      return query
    },
  }
  const channel = {
    on(event, config, callback) {
      assert.equal(config.filter, 'charity_id=eq.charity-a')
      listener = callback
      return channel
    },
    subscribe() {
      return channel
    },
  }
  const hook = load(
    'src/hooks/useAdminSubmissionStatuses.ts',
    {
      react: {
        useRef: (current) => ({ current }),
        useEffect: (fn) => {
          effect = fn
        },
      },
      '../lib/supabase': {
        supabase: {
          from: () => query,
          channel: () => channel,
          removeChannel: async () => {
            removed = true
          },
        },
      },
      '../utils/fetchAll': {
        fetchAllRows: async (factory) => {
          factory()
          return [
            { id: 'claim-a', status: 'approved', hmrc_status: 'accepted' },
          ]
        },
      },
    },
    {
      document: { visibilityState: 'visible' },
      window: {
        setInterval: () => 1,
        clearInterval: () => {
          cleared = true
        },
        addEventListener() {},
        removeEventListener() {},
      },
    },
  ).useAdminSubmissionStatuses
  hook('charity_id', 'charity-a', (rows) => seen.push(rows))
  const cleanup = effect()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(seen[0][0].hmrc_status, 'accepted')
  listener()
  cleanup()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(seen.length, 1)
  assert.ok(removed && cleared)
})
