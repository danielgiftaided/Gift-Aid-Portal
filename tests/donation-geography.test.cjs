const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(path, deps = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (name) => { assert.ok(name in deps, name); return deps[name] } })
  return exports
}
const consent = load('shared/giftAidRecords.ts')
const analytics = load('shared/analytics.ts', { './giftAidRecords': consent })
const postcodes = load('shared/postcodeAreas.ts')
const geo = load('shared/donationGeography.ts', { './analytics': analytics, './postcodeAreas': postcodes, './giftAidRecords': consent })
const record = (overrides = {}) => ({ id: 'row', charity_id: 'a', amount: 10, postcode: 'M1 1AE',
  donation_date: '2025-05-01', tax_year: '2025/26', record_status: 'valid', gift_aid_opt_in: 'Yes', gift_aid_submitted: true, ...overrides })

test('postcode mapping normalises spacing/case and supports all four UK countries and London districts', () => {
  for (const [postcode, area, district] of [
    [' m11ae ', 'M', 'M1'], ['SW1A 1AA', 'SW', 'SW1A'], ['CF10 1AA', 'CF', 'CF10'],
    ['EH1 1AA', 'EH', 'EH1'], ['BT1 1AA', 'BT', 'BT1'], ['ZE1 1AA', 'ZE', 'ZE1'],
  ]) {
    const location = postcodes.postcodeLocation(postcode)
    assert.equal(location.postcode_area, area)
    assert.equal(location.postcode_district, district)
    assert.equal(location.postcode_status, 'mapped')
    assert.ok(!('postcode' in location))
  }
})
test('missing, incomplete, overseas, Crown Dependency and non-geographic postcodes are never placed in a guessed UK area', () => {
  for (const [value, status] of [[null, 'missing'], ['', 'missing'], ['M1', 'invalid'], ['90210', 'invalid'],
    ['GIR 0AA', 'invalid'], ['BF1 1AA', 'outside_uk'], ['IM1 1AA', 'outside_uk'], ['JE1 1AA', 'outside_uk']]) {
    const location = postcodes.postcodeLocation(value)
    assert.equal(location.postcode_area, null)
    assert.equal(location.postcode_status, status)
  }
})
test('raw postcodes and derived portfolio fields produce the same geography without counting rows twice', () => {
  const raw = [record(), record({ postcode: 'M2 2BB', amount: '20.25' }), record({ postcode: 'BT1 1AA', amount: 5 })]
  const safe = raw.map(({ postcode, ...row }) => ({ ...row, ...postcodes.postcodeLocation(postcode) }))
  const local = geo.buildDonationGeography(raw), portfolio = geo.buildDonationGeography(safe)
  assert.equal(local.mappedCount, 3)
  assert.equal(portfolio.mappedCount, 3)
  for (const area of ['M', 'BT']) {
    const a = local.areas.find((r) => r.code === area), b = portfolio.areas.find((r) => r.code === area)
    assert.equal(a.count, b.count); assert.equal(a.value, b.value)
  }
  assert.equal(local.areas.find((r) => r.code === 'M').value, 7.56)
  assert.equal(local.areas.reduce((sum, r) => sum + r.count, 0), 3)
})
test('map coverage accounts separately for missing, invalid and unsupported postcodes', () => {
  const data = geo.buildDonationGeography([record(), record({ postcode: null }), record({ postcode: 'bad' }), record({ postcode: 'GY1 1AA' })])
  assert.equal(data.totalCount, 4); assert.equal(data.mappedCount, 1)
  assert.equal(data.missingCount, 1); assert.equal(data.invalidCount, 1); assert.equal(data.outsideCount, 1)
  assert.equal(data.unmappedCount, 3)
  const empty = geo.buildDonationGeography([])
  assert.equal(empty.mappedCount, 0)
  assert.ok(empty.areas.every((a) => a.count === 0 && a.value === 0))
})
test('geography uses the report charity/tax-year filters and donation dates consistently', () => {
  const records = [record(), record({ charity_id: 'b', postcode: 'BT1 1AA' }), record({ postcode: 'EH1 1AA', donation_date: '2024-05-01' })]
  const filtered = analytics.buildAnalytics([], records, [], { charityId: 'a', taxYear: '2025/26' })
  const result = geo.buildDonationGeography(filtered.records)
  assert.equal(result.mappedCount, 1)
  assert.equal(result.areas.find((r) => r.code === 'M').count, 1)
  assert.equal(result.areas.find((r) => r.code === 'BT').count, 0)
  assert.equal(result.areas.find((r) => r.code === 'EH').count, 0)
})
test('regional and district drill-down keeps counts, averages and monthly values consistent', () => {
  const data = geo.buildDonationGeography([
    record({ amount: '15.15' }), record({ postcode: 'M2 2BB', amount: 20, donation_date: '2025-06-10' }),
    record({ amount: 2, donation_date: null }),
  ])
  const rows = data.areas.find((a) => a.code === 'M').rows
  const detail = geo.geographicDetail(rows), district = geo.geographicDetail(rows, 'M1')
  assert.equal(detail.count, 3); assert.equal(detail.value, 9.29); assert.equal(detail.average, 3.1)
  assert.equal(detail.districts.length, 2); assert.equal(detail.monthly.length, 2); assert.equal(detail.undatedCount, 1)
  assert.equal(district.count, 2); assert.equal(district.value, 4.29)
  assert.equal(district.monthly[0].value, 3.79)
  assert.equal(geo.geographicDetail(rows, 'M99').count, 0)
})
test('derived geography cannot attach a district to a contradictory area', () => {
  const result = geo.buildDonationGeography([record({ postcode: undefined, postcode_area: 'M', postcode_district: 'BT1' })])
  assert.equal(result.mappedCount, 0)
})
test('bundled map geometry covers every supported postcode area including Northern Ireland and Scottish islands', () => {
  const asset = JSON.parse(fs.readFileSync('src/data/uk-postcode-map.json', 'utf8'))
  assert.equal(asset.areas.length, Object.keys(postcodes.POSTCODE_AREAS).length)
  for (const code of ['BT', 'CF', 'EH', 'ZE', 'HS', 'M', 'SW']) {
    const area = asset.areas.find((a) => a.code === code)
    assert.ok(area.path.startsWith('M'))
    assert.ok(area.bounds.every(Number.isFinite))
    assert.ok(area.bounds[2] > area.bounds[0] && area.bounds[3] > area.bounds[1])
  }
})

test('only valid opted-in donations explicitly marked submitted contribute to the Gift Aid map', () => {
  const included = record({ amount: 100 })
  const excluded = [
    record({ gift_aid_submitted: false }),
    record({ gift_aid_submitted: null }),
    record({ gift_aid_submitted: undefined }),
    record({ gift_aid_opt_in: 'No' }),
    record({ gift_aid_opt_in: null }),
    record({ record_status: 'opt_out' }),
    record({ record_status: 'incomplete' }),
    record({ record_status: 'unknown' }),
    record({ amount: 0 }), record({ amount: -20 }), record({ amount: null }),
    record({ amount: 'not-a-number' }), record({ amount: Infinity }),
  ]
  const data = geo.buildDonationGeography([included, ...excluded])
  assert.equal(data.totalCount, 1)
  assert.equal(data.mappedCount, 1)
  assert.equal(data.excludedCount, excluded.length)
  assert.equal(data.areas.find((a) => a.code === 'M').count, 1)
  assert.equal(data.areas.find((a) => a.code === 'M').value, 25)
  const detail = geo.geographicDetail([included, ...excluded])
  assert.equal(detail.count, 1)
  assert.equal(detail.value, 25)
  assert.equal(detail.monthly[0].value, 25)
  assert.equal(detail.districts[0].value, 25)
})
test('Gift Aid is aggregated at 25 percent before rounding money values', () => {
  const records = Array.from({ length: 4 }, (_, i) => record({ id: String(i), amount: '0.01' }))
  const area = geo.buildDonationGeography(records).areas.find((a) => a.code === 'M')
  assert.equal(area.value, 0.01)
  const detail = geo.geographicDetail(area.rows)
  assert.equal(detail.value, 0.01)
  assert.equal(detail.districts[0].value, 0.01)
  assert.equal(detail.monthly[0].value, 0.01)
})
test('postcode coverage and empty states count only donations with applied Gift Aid', () => {
  const data = geo.buildDonationGeography([
    record({ postcode: null, amount: 100 }),
    record({ postcode: 'bad', gift_aid_submitted: false }),
    record({ postcode: 'GY1 1AA', record_status: 'incomplete' }),
  ])
  assert.equal(data.totalCount, 1)
  assert.equal(data.missingCount, 1)
  assert.equal(data.invalidCount, 0)
  assert.equal(data.outsideCount, 0)
  assert.equal(data.excludedCount, 2)
  const empty = geo.buildDonationGeography([record({ gift_aid_submitted: false })])
  assert.equal(empty.totalCount, 0)
  assert.equal(empty.excludedCount, 1)
  assert.ok(empty.areas.every((a) => a.count === 0 && a.value === 0))
})
