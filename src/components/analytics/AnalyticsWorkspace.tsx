import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts'
import * as XLSX from 'xlsx'
import {
  buildAnalytics,
  QUALITY,
  numberValue,
  qualityGroup,
  recordTaxYear,
  hmrcStage,
  type AnalyticsSubmission,
  type AnalyticsRecord,
  type AnalyticsCharity,
} from '../../../shared/analytics'
import { CurrencyInsightTooltip, InsightTooltip } from '../InsightTooltip'
import './analytics.css'
import DonationMap, { type MapMetric } from './DonationMap'
import { buildDonationGeography, geographicDetail } from '../../../shared/donationGeography'
import { supabase } from '../../lib/supabase'

export const gbp = (value: number) =>
  value.toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2,
  })
const compact = (value: number) =>
  `£${Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
const count = (value: number) => value.toLocaleString('en-GB')
const colors = [
  '#0c745d',
  '#304675',
  '#e8a343',
  '#a39bbc',
  '#173d51',
  '#d77c66',
]
const tick = { fontSize: 12, fill: '#536577' }
const recordShare = (value: number, total: number) => {
  if (value > 0 && value / total < 0.001) return '<0.1%'
  return Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 })
    .format(total ? value / total : 0)
}
const titles = {
  overview: 'Performance overview',
  donations: 'Donation patterns',
  quality: 'Check your data',
  claims: 'Track claims',
}
type View = keyof typeof titles
function Icon({ kind }: { kind: string }) {
  const paths: Record<string, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    donations: (
      <>
        <path d="M3 18l6-7 4 3 8-10" />
        <path d="M16 4h5v5" />
      </>
    ),
    quality: (
      <>
        <path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z" />
        <path d="M8 12l3 3 5-6" />
      </>
    ),
    claims: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind] || paths.overview}
    </svg>
  )
}
export function AnalyticsFrame({
  title,
  subtitle,
  back,
  admin = false,
  charityPreview = false,
  children,
}: {
  title: string
  subtitle: string
  back: string
  admin?: boolean
  charityPreview?: boolean
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="analytics-app">
      {charityPreview && (
        <div className="analytics-preview-bar">
          <span><strong>Charity experience preview</strong> · Available to admins only</span>
          <button onClick={() => navigate(back)}>← Back to admin</button>
        </div>
      )}
      {!admin && <nav className="analytics-topbar" aria-label="Portal navigation">
        <button
          className="analytics-logo"
          onClick={() => navigate(charityPreview ? `${back}/insights` : admin ? '/admin' : '/dashboard')}
        >
          gift aided<span>Portal</span>
        </button>
        <div className="analytics-toplinks">
          <button onClick={() => navigate(back)}>
            ← {charityPreview ? 'Back to admin' : admin ? 'Admin workspace' : 'Dashboard'}
          </button>
          <button
            className="active"
            onClick={() => navigate(charityPreview ? `${back}/insights` : admin ? '/admin/insights' : '/insights')}
          >
            Insights & reporting
          </button>
          {!charityPreview && <button
            onClick={() => navigate(admin ? '/admin/activity-log' : '/profile')}
          >
            {admin ? 'Activity log' : 'My profile'}
          </button>}
          <button
            className="analytics-logout"
            onClick={async () => {
              await supabase.auth.signOut()
              navigate(admin ? '/admin/login' : '/login')
            }}
          >
            Log out
          </button>
        </div>
        <span className="analytics-workspace-tag">
          {charityPreview ? 'CHARITY WORKSPACE' : admin ? 'ADMIN WORKSPACE' : 'CHARITY WORKSPACE'}
        </span>
      </nav>}
      <header className="analytics-page-heading">
        <div>
          <p className="analytics-eyebrow">GIFT AID INTELLIGENCE</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <span className="analytics-heading-symbol" aria-hidden="true">
          <Icon kind="donations" />
        </span>
      </header>
      {children}
    </div>
  )
}
function Panel({
  title,
  caption,
  children,
  action,
  wide = false,
}: {
  title: string
  caption: string
  children: ReactNode
  action?: ReactNode
  wide?: boolean
}) {
  return (
    <section className={`analytics-panel ${wide ? 'wide' : ''}`}>
      <div className="analytics-panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{caption}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
function Empty({
  message = 'No donations or claims in this selection.',
}: {
  message?: string
}) {
  return (
    <div className="analytics-empty">
      <Icon kind="overview" />
      <strong>{message}</strong>
      <span>Try another tax year or clear your filters.</span>
    </div>
  )
}
interface Props {
  submissions: AnalyticsSubmission[]
  records: AnalyticsRecord[]
  charities?: AnalyticsCharity[]
  loading?: boolean
  error?: string | null
  onRefresh?: () => void
  staged?: boolean
  scopeName?: string
  submissionBackPath?: string
  onRecordsExport?: (rows: AnalyticsRecord[], mode: 'full' | 'valid') => void
}
export default function AnalyticsWorkspace({
  submissions,
  records,
  charities = [],
  loading,
  error,
  onRefresh,
  staged = false,
  onRecordsExport,
  submissionBackPath = '/insights',
  scopeName = 'All charities',
}: Props) {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('overview')
  const [taxYear, setTaxYear] = useState('all')
  const [charityId, setCharityId] = useState('all')
  const [metric, setMetric] = useState<'value' | 'count'>('value')
  const [trend, setTrend] = useState<'area' | 'bar'>('area')
  const [donationArea, setDonationArea] = useState<string | null>(null)
  const [donationDistrict, setDonationDistrict] = useState<string | null>(null)
  const [mapMetric, setMapMetric] = useState<MapMetric>('count')
  const [group, setGroup] = useState('all')
  const [claimStatus, setClaimStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [showTable, setShowTable] = useState(false)
  const [page, setPage] = useState(1)
  const model = useMemo(
    () =>
      buildAnalytics(submissions, records, charities, { taxYear, charityId }),
    [submissions, records, charities, taxYear, charityId],
  )
  const geography = useMemo(() => buildDonationGeography(model.records), [model.records])
  const geographicRows = useMemo(() => geography.areas
    .filter((a) => donationArea ? a.code === donationArea : a.count > 0)
    .map((a) => ({ code: a.code, name: a.name, ...geographicDetail(a.rows, donationDistrict) })),
    [geography, donationArea, donationDistrict])
  const composition = model.quality.filter((g) => g.count > 0)
  const filteredClaims = model.submissions
    .filter(
      (s) =>
        (claimStatus === 'all' || hmrcStage(s.hmrc_status) === claimStatus) &&
        `${s.id} ${s.tax_year} ${charities.find((c) => c.id === s.charity_id)?.name || ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      (b.submission_date || '').localeCompare(a.submission_date || ''),
    )
  useEffect(() => {
    setPage(1)
  }, [filteredClaims.length, search, claimStatus])
  const detailRecords = model.records.filter(
    (r) => group === 'all' || qualityGroup(r) === group,
  )
  const reset = () => {
    setTaxYear('all')
    setCharityId('all')
    setGroup('all')
    setClaimStatus('all')
    setDonationArea(null)
    setDonationDistrict(null)
    setSearch('')
    setPage(1)
  }
  const changeYear = (year: string) => {
    setTaxYear(year)
    setPage(1)
  }
  const inspectRecordGroup = (key: string) => {
    setGroup(key)
    setView('quality')
    setShowTable(true)
    setPage(1)
  }
  function exportReport() {
    const wb = XLSX.utils.book_new()
    const sheets: Array<[string, object[]]> = [
      [
        'Summary',
        [
          {
            'Tax year': taxYear === 'all' ? 'All tax years' : taxYear,
            Charity:
              charities.find((c) => c.id === charityId)?.name || scopeName,
            'Claim detail status filter': claimStatus,
            'Claim detail search': search || 'None',
            'Record detail group':
              QUALITY.find((q) => q.key === group)?.label || 'All groups',
            'Recorded claim value GBP': model.recorded,
            'HMRC accepted value GBP': model.accepted,
            'Donation map area': donationArea || 'All UK areas',
            'Donation map district': donationDistrict || 'All districts',
            'Mapped donation records': geography.mappedCount,
            'Unmapped donation records': geography.unmappedCount,
            'Missing postcode records': geography.missingCount,
            'Invalid postcode records': geography.invalidCount,
            'Outside supported UK areas': geography.outsideCount,
            'Imported donation value GBP': model.donationValue,
            'Estimated eligible Gift Aid GBP': model.potential,
            'Estimated incomplete opted-in Gift Aid GBP': model.recoverable,
          },
        ],
      ],
      [
        'By tax year',
        model.byYear.map((r) => ({
          'Tax year': r.year,
          'Recorded claim GBP': r.recorded,
          'Eligible estimate GBP': r.potential,
          'HMRC accepted GBP': r.accepted,
          'Imported donation GBP': r.donations,
          Records: r.records,
          Submissions: r.claims,
        })),
      ],
      [
        'Record quality',
        model.quality.map((r) => ({
          Group: r.label,
          Records: r.count,
          'Donation value GBP': r.donationValue,
        })),
      ],
      [
        'Record detail',
        detailRecords.map((r) => ({
          'Record ID': r.id || '',
          'Donation date': r.donation_date || '',
          'Tax year': recordTaxYear(r),
          'Donation value GBP': numberValue(r.amount),
          Group:
            QUALITY.find((q) => q.key === qualityGroup(r))?.label || 'Other',
        })),
      ],
      [
        'Claims',
        filteredClaims.map((s) => ({
          'Submission ID': s.id,
          'Tax year': s.tax_year,
          Date: s.submission_date,
          'Claim GBP': numberValue(s.amount_claimed),
          'Portal status': s.status,
          'HMRC status': s.hmrc_status || 'unknown',
        })),
      ],
      [
        'Donation regions',
        geographicRows.map((r) => ({
          'Postcode area': r.code, Area: r.name, District: donationDistrict || 'All districts',
          'Donation records': r.count, 'Donation value GBP': r.value, 'Average donation GBP': r.average,
        })),
      ],
      [
        'Donation districts',
        geographicRows.flatMap((r) => r.districts.map((d) => ({
          'Postcode area': r.code, Area: r.name, District: d.code,
          'Donation records': d.count, 'Donation value GBP': d.value,
        }))),
      ],
      [
        'Monthly donations',
        model.monthly.map((r) => ({
          Month: r.month,
          'Donation value GBP': r.donations,
          Records: r.records,
        })),
      ],
    ]
    for (const [name, rows] of sheets)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
    XLSX.writeFile(wb, `gift-aid-report-${taxYear.replace('/', '-')}.xlsx`)
  }
  const grid = (
    <CartesianGrid vertical={false} stroke="#edf0f4" strokeDasharray="3 3" />
  )
  const recordAxis = (
    <YAxis
      axisLine={false}
      tickLine={false}
      tick={tick}
      width={64}
      tickFormatter={(v) => (metric === 'value' ? compact(v) : count(v))}
      allowDecimals={metric === 'value'}
    />
  )
  const trendData = model.monthly
  const trendSeries = metric === 'value' ? 'donations' : 'records'
  const TrendChart = trend === 'area' ? AreaChart : BarChart
  return (
    <div className="analytics-layout">
      <aside className="analytics-sidebar" aria-label="Report views">
        <div className="analytics-sidebar-title">YOUR REPORTS</div>
        {(Object.keys(titles) as View[]).map((key) => (
          <button
            key={key}
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={view === key ? 'selected' : ''}
          >
            <Icon kind={key} />
            <span>
              {key === 'overview'
                ? 'Overview'
                : key === 'donations'
                  ? 'Donation patterns'
                  : key === 'quality'
                    ? 'Check your data'
                    : 'Track claims'}
            </span>
            {key === 'quality' && model.incompleteCount > 0 && (
              <b>{model.incompleteCount}</b>
            )}
          </button>
        ))}
        <div className="analytics-sidebar-note">
          <span className="analytics-dot" />
          Portal data
          <p>
            Explore your figures.
            <br />
            Turn insight into action.
          </p>
        </div>
      </aside>
      <main className="analytics-main">
        <div className="analytics-toolbar">
          <h2 className="analytics-toolbar-title" tabIndex={-1}>
            <span className="analytics-dot" />
            {titles[view]}
          </h2>
          <div className="analytics-actions">
            <button
              onClick={onRefresh}
              disabled={loading || !onRefresh}
              aria-label="Refresh reporting data"
            >
              ↻ Refresh
            </button>
            <button onClick={() => window.print()}>Print / PDF</button>
            <button
              className="primary"
              onClick={exportReport}
              disabled={loading || !!error}
            >
              ↓ Export report
            </button>
          </div>
        </div>
        <p className="analytics-view-help">{
          view === 'overview' ? 'Start with the big picture, then explore donations, check your data or track a claim.' :
          view === 'donations' ? 'See when donations arrive and how giving changes over time.' :
          view === 'quality' ? 'Find records that need a closer look before preparing your next claim.' :
          'Search your submissions and follow their progress with HMRC.'
        }</p>
        <div className="analytics-filters">
          <label>
            Tax year
            <select
              value={taxYear}
              onChange={(e) => changeYear(e.target.value)}
            >
              <option value="all">All tax years</option>
              {model.taxYears.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          {charities.length > 0 && (
            <label>
              Charity
              <select
                value={charityId}
                onChange={(e) => {
                  setCharityId(e.target.value)
                  setPage(1)
                }}
              >
                <option value="all">All charities</option>
                {charities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="analytics-filter-summary" role="status">
            <strong>{count(model.records.length)}</strong> imported records ·{' '}
            <strong>{count(model.submissions.length)}</strong> submissions
            <span>
              {staged
                ? 'Staged data · no HMRC claim yet'
                : 'Figures reflect your current selection'}
            </span>
          </div>
          <button className="analytics-clear" onClick={reset}>
            Clear all filters
          </button>
        </div>
        {error && (
          <div className="analytics-alert" role="alert">
            Could not load the report: {error}.{' '}
            <button onClick={onRefresh}>Try again</button>
          </div>
        )}
        {loading ? (
          <div className="analytics-loading" role="status">
            <span />
            Preparing your reports…
          </div>
        ) : error ? null : (
          <>
            {view === 'overview' && (model.records.length > 0 || model.submissions.length > 0) && (
              <section className="analytics-next-steps" aria-label="Suggested next steps">
                <div><span className="analytics-eyebrow">WHAT’S NEXT</span><h3>Your next steps, made simple</h3>
                <p>Choose an area to explore. Your tax year and charity filters stay in place.</p></div>
                <button onClick={() => { setView('quality'); setGroup('incomplete_opt_in'); setShowTable(true) }}>
                  <Icon kind="quality" /><span><strong>Check your data</strong><small>{count(model.quality.find((item) => item.key === 'incomplete_opt_in')?.count || 0)} incomplete opted-in records to review</small></span><b aria-hidden="true">→</b>
                </button>
                <button onClick={() => setView('claims')}>
                  <Icon kind="claims" /><span><strong>Track your claims</strong><small>{count(model.submissions.length)} submissions in this selection</small></span><b aria-hidden="true">→</b>
                </button>
              </section>
            )}
            <div className="analytics-kpis">
              {[
                {
                  label: staged
                    ? 'Eligible Gift Aid estimate'
                    : 'Recorded claim value',
                  value: gbp(staged ? model.potential : model.recorded),
                  sub: staged
                    ? 'Eligible uploaded donations × 25%'
                    : 'All recorded submissions · every status',
                  accent: 'teal',
                },
                {
                  label: 'HMRC accepted value',
                  value: gbp(model.accepted),
                  sub: 'Accepted claims · not a payment total',
                  accent: 'blue',
                },
                {
                  label: 'Gift Aid to review',
                  value: gbp(model.recoverable),
                  sub: `${count(model.incompleteCount)} incomplete opted-in records · estimate only`,
                  accent: 'amber',
                },
                {
                  label: 'Eligible uploaded records',
                  value: model.readiness == null ? '—' : `${model.readiness}%`,
                  sub: `${count(model.eligibleCount)} of ${count(model.records.length)} uploaded records`,
                  accent: 'slate',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`analytics-kpi ${item.accent}`}
                >
                  <p>{item.label}</p>
                  <strong>{item.value}</strong>
                  <span>{item.sub}</span>
                  <div className="analytics-kpi-line" />
                </div>
              ))}
            </div>
            {model.records.length === 0 && model.submissions.length === 0 ? (
              <Empty />
            ) : (
              <>
                {view === 'overview' && (
                  <div className="analytics-chart-grid">
                    <Panel
                      title={
                        staged
                          ? 'Eligible Gift Aid estimate by tax year'
                          : 'Claim value by tax year'
                      }
                      caption={
                        staged
                          ? 'Eligible staged donations × 25%. Select a year to explore its records.'
                          : 'Recorded value and HMRC-accepted value. Select a year to filter the dashboard.'
                      }
                      action={<span className="analytics-panel-tag">GBP</span>}
                      wide
                    >
                      <div className="analytics-legend">
                        <span
                          style={
                            { '--legend': '#0c745d' } as React.CSSProperties
                          }
                        >
                          {staged ? 'Eligible estimate' : 'Recorded'}
                        </span>
                        {!staged && (
                          <span
                            style={
                              { '--legend': '#b8cbdc' } as React.CSSProperties
                            }
                          >
                            HMRC accepted
                          </span>
                        )}
                      </div>
                      <div
                        className="analytics-chart"
                        role="img"
                        aria-label={
                          staged
                            ? 'Eligible Gift Aid estimate by tax year'
                            : 'Grouped columns of recorded and HMRC-accepted claim value by tax year'
                        }
                      >
                        {model.byYear.length ? (
                          <ResponsiveContainer width="100%" height={270}>
                            <BarChart
                              data={model.byYear}
                              barGap={4}
                              margin={{ top: 12, right: 8, left: 0, bottom: 8 }}
                              onClick={(state) =>
                                state?.activeLabel &&
                                changeYear(String(state.activeLabel))
                              }
                            >
                              {grid}
                              <XAxis
                                dataKey="year"
                                axisLine={false}
                                tickLine={false}
                                tick={tick}
                              />
                              <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={tick}
                                width={64}
                                tickFormatter={compact}
                              />
                              <Tooltip content={<CurrencyInsightTooltip />} />
                              <Bar
                                name={
                                  staged
                                    ? 'Eligible estimate'
                                    : 'Recorded claim'
                                }
                                dataKey={staged ? 'potential' : 'recorded'}
                                fill="#0c745d"
                                maxBarSize={32}
                                radius={[3, 3, 0, 0]}
                              />
                              {!staged && (
                                <Bar
                                  name="HMRC accepted"
                                  dataKey="accepted"
                                  fill="#b8cbdc"
                                  maxBarSize={32}
                                  radius={[3, 3, 0, 0]}
                                />
                              )}
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <Empty />
                        )}
                      </div>
                      <div className="analytics-year-buttons">
                        {model.taxYears.map((y) => (
                          <button
                            key={y}
                            onClick={() => changeYear(y)}
                            aria-pressed={taxYear === y}
                          >
                            {y}
                          </button>
                        ))}
                      </div>
                    </Panel>
                    <Panel
                      title="Where donations come from"
                      caption="A UK heat map of uploaded donations by postcode area. Select a region to explore its donations."
                      wide
                    >
                      <DonationMap data={geography} selectedArea={donationArea} district={donationDistrict} metric={mapMetric}
                        onSelectArea={setDonationArea} onSelectDistrict={setDonationDistrict} onMetric={setMapMetric} />
                    </Panel>
                    {charities.length > 1 ? (
                      <Panel
                        title="Charity contribution"
                        caption="Ranked by recorded claim value. Select a charity to explore its figures."
                        wide
                      >
                        <div className="analytics-ranking">
                          {model.ranking.slice(0, 8).map((c, i) => (
                            <button
                              key={c.id}
                              onClick={() => {
                                setCharityId(c.id)
                                setPage(1)
                              }}
                            >
                              <span className="analytics-rank">
                                {String(i + 1).padStart(2, '0')}
                              </span>
                              <strong>{c.name}</strong>
                              <div>
                                <span
                                  style={{
                                    width: `${model.ranking[0]?.recorded > 0 ? (c.recorded / model.ranking[0].recorded) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                              <b>{gbp(c.recorded)}</b>
                              <small>{c.claims} claims</small>
                            </button>
                          ))}
                        </div>
                        {model.ranking.length > 8 && (
                          <p className="analytics-footnote">
                            Top 8 of {model.ranking.length} charities. Use the
                            charity filter for the full portfolio.
                          </p>
                        )}
                      </Panel>
                    ) : (
                      <Panel
                        title="Record composition"
                        caption="Every uploaded row belongs to one group. Select a group to inspect its details."
                        wide
                      >
                        {model.records.length ? (
                          <div className="analytics-composition">
                            <div
                              className="analytics-composition-chart"
                              role="img"
                              aria-label={`Record composition pie chart. ${composition.map((g) => `${g.label}: ${count(g.count)} records, ${recordShare(g.count, model.records.length)}`).join('. ')}.`}
                            >
                              <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                  <Pie
                                    data={composition}
                                    dataKey="count"
                                    nameKey="label"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius="88%"
                                    startAngle={90}
                                    endAngle={-270}
                                    stroke="#fff"
                                    strokeWidth={2}
                                    isAnimationActive={false}
                                    onClick={(entry) => inspectRecordGroup(entry.key)}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    {composition.map((g) => <Cell key={g.key} fill={g.color} />)}
                                  </Pie>
                                  <Tooltip content={<InsightTooltip />} />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                            <div>
                              <p className="analytics-composition-total">
                                <strong>{count(model.records.length)}</strong> uploaded records
                              </p>
                              <div className="analytics-quality-legend">
                                {model.quality.map((g) => (
                                  <button
                                    key={g.key}
                                    disabled={g.count === 0}
                                    onClick={() => inspectRecordGroup(g.key)}
                                  >
                                    <i style={{ background: g.color }} />
                                    <span>{g.label}</span>
                                    <strong>{count(g.count)}</strong>
                                    <small>{recordShare(g.count, model.records.length)}</small>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : <Empty message="No uploaded records in this selection." />}
                      </Panel>
                    )}
                  </div>
                )}
                {view === 'donations' && (
                  <>
                    <div className="analytics-submetrics">
                      <span>
                        Imported donation value
                        <strong>{gbp(model.donationValue)}</strong>
                      </span>
                      <span>
                        Average per uploaded row
                        <strong>
                          {model.averageDonation == null
                            ? '—'
                            : gbp(model.averageDonation)}
                        </strong>
                      </span>
                      <span>
                        Records without a usable date
                        <strong>{count(model.undatedRecords)}</strong>
                      </span>
                    </div>
                    <div className="analytics-chart-grid">
                      <Panel
                        title="Donation activity over time"
                        caption="Donation dates from uploaded records. Missing months show zero; undated rows are excluded."
                        wide
                        action={
                          <div className="analytics-toggle">
                            <button
                              aria-pressed={trend === 'area'}
                              onClick={() => setTrend('area')}
                            >
                              Area
                            </button>
                            <button
                              aria-pressed={trend === 'bar'}
                              onClick={() => setTrend('bar')}
                            >
                              Columns
                            </button>
                          </div>
                        }
                      >
                        <div className="analytics-chart-control">
                          <label>
                            Measure
                            <select
                              value={metric}
                              onChange={(e) =>
                                setMetric(e.target.value as 'value' | 'count')
                              }
                            >
                              <option value="value">Donation value (£)</option>
                              <option value="count">Record count</option>
                            </select>
                          </label>
                        </div>
                        {trendData.length ? (
                          <ResponsiveContainer width="100%" height={300}>
                            <TrendChart
                              data={trendData}
                              margin={{
                                top: 16,
                                right: 12,
                                left: 0,
                                bottom: 8,
                              }}
                            >
                              {grid}
                              <XAxis
                                dataKey="month"
                                axisLine={false}
                                tickLine={false}
                                tick={tick}
                                minTickGap={30}
                              />
                              {recordAxis}
                              <Tooltip
                                content={
                                  metric === 'value' ? (
                                    <CurrencyInsightTooltip />
                                  ) : (
                                    <InsightTooltip />
                                  )
                                }
                              />
                              {trend === 'area' ? (
                                <Area
                                  name={
                                    metric === 'value'
                                      ? 'Donation value'
                                      : 'Records'
                                  }
                                  dataKey={trendSeries}
                                  type="linear"
                                  stroke="#0c745d"
                                  fill="#0c745d"
                                  fillOpacity={0.12}
                                  strokeWidth={2.5}
                                />
                              ) : (
                                <Bar
                                  name={
                                    metric === 'value'
                                      ? 'Donation value'
                                      : 'Records'
                                  }
                                  dataKey={trendSeries}
                                  fill="#0c745d"
                                  maxBarSize={30}
                                  radius={[3, 3, 0, 0]}
                                />
                              )}
                            </TrendChart>
                          </ResponsiveContainer>
                        ) : (
                          <Empty message="No dated donations for this selection." />
                        )}
                      </Panel>
                      <Panel
                        title="Donation size distribution"
                        caption="Count of positive-value uploaded rows in each amount band."
                      >
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={model.distribution}>
                            {grid}
                            <XAxis
                              dataKey="band"
                              tick={tick}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={tick}
                              allowDecimals={false}
                              axisLine={false}
                              tickLine={false}
                              width={40}
                            />
                            <Tooltip content={<InsightTooltip />} />
                            <Bar
                              name="Records"
                              dataKey="count"
                              maxBarSize={40}
                              radius={[3, 3, 0, 0]}
                            >
                              {model.distribution.map((d, i) => (
                                <Cell key={d.band} fill={colors[i]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                        {model.nonPositiveRecords > 0 && (
                          <p className="analytics-footnote">
                            {model.nonPositiveRecords} zero, negative or missing
                            amounts excluded from the distribution.
                          </p>
                        )}
                      </Panel>
                      <Panel
                        title="Donation value by tax year"
                        caption="Uploaded donation value; distinct from submitted claim value."
                      >
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={model.byYear}>
                            {grid}
                            <XAxis
                              dataKey="year"
                              tick={tick}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={tick}
                              tickFormatter={compact}
                              width={64}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip content={<CurrencyInsightTooltip />} />
                            <Bar
                              name="Donation value"
                              dataKey="donations"
                              fill="#304675"
                              maxBarSize={40}
                              radius={[3, 3, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </Panel>
                    </div>
                  </>
                )}
                {view === 'quality' && (
                  <div className="analytics-chart-grid">
                    <Panel
                      title="Record quality by tax year"
                      caption="A heatmap of mutually exclusive record groups. Select a cell to focus the detail table."
                      wide
                    >
                      <div className="analytics-table-wrap">
                        <table className="analytics-heatmap">
                          <thead>
                            <tr>
                              <th>Tax year</th>
                              {QUALITY.map((g) => (
                                <th key={g.key}>{g.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {model.byYear.map((row) => (
                              <tr key={row.year}>
                                <th>{row.year}</th>
                                {QUALITY.map((g) => {
                                  const n = numberValue(
                                    (row as unknown as Record<string, unknown>)[
                                      g.key
                                    ],
                                  )
                                  const max = Math.max(
                                    1,
                                    ...model.byYear.flatMap((y) =>
                                      QUALITY.map((q) =>
                                        numberValue(
                                          (
                                            y as unknown as Record<
                                              string,
                                              unknown
                                            >
                                          )[q.key],
                                        ),
                                      ),
                                    ),
                                  )
                                  return (
                                    <td key={g.key}>
                                      <button
                                        onClick={() => {
                                          changeYear(row.year)
                                          setGroup(g.key)
                                          setShowTable(true)
                                        }}
                                        aria-label={`${row.year}, ${g.label}: ${n} records`}
                                        style={{
                                          background: `rgba(12,116,93,${0.04 + (n / max) * 0.85})`,
                                          color:
                                            n / max > 0.55
                                              ? 'white'
                                              : '#385467',
                                        }}
                                      >
                                        {count(n)}
                                      </button>
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                    <Panel
                      title="Where attention is needed"
                      caption="Estimates help prioritise cleanup; they are not confirmed entitlements."
                      wide
                    >
                      <div className="analytics-quality-actions">
                        {model.quality.map((g) => (
                          <button
                            aria-pressed={group === g.key}
                            key={g.key}
                            onClick={() => {
                              setGroup(group === g.key ? 'all' : g.key)
                              setShowTable(true)
                            }}
                          >
                            <i style={{ background: g.color }} />
                            <span>{g.label}</span>
                            <strong>{g.count}</strong>
                            <small>{gbp(g.donationValue)} in donations</small>
                          </button>
                        ))}
                      </div>
                      <p className="analytics-footnote">
                        Opted-out/no-consent and historic records are excluded
                        from the incomplete opted-in estimate. Recoverability
                        still depends on declarations, eligibility and claim
                        deadlines.
                      </p>
                    </Panel>
                  </div>
                )}
                {view === 'claims' && (
                  <Panel
                    title="Submission register"
                    caption="Search and inspect the claims behind the dashboard."
                    wide
                  >
                    <div className="analytics-table-controls">
                      <label>
                        Search submissions
                        <input
                          value={search}
                          onChange={(e) => {
                            setSearch(e.target.value)
                            setPage(1)
                          }}
                          placeholder="ID, tax year or charity…"
                        />
                      </label>
                      <label>
                        HMRC status
                        <select
                          value={claimStatus}
                          onChange={(e) => {
                            setClaimStatus(e.target.value)
                            setPage(1)
                          }}
                        >
                          <option value="all">All statuses</option>
                          {model.pipeline
                            .filter((p) => p.count > 0)
                            .map((p) => (
                              <option key={p.key} value={p.key}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <span>{count(filteredClaims.length)} results</span>
                    </div>
                    <div className="analytics-table-wrap">
                      <table className="analytics-data-table">
                        <thead>
                          <tr>
                            <th>Submission</th>
                            {charities.length > 0 && <th>Charity</th>}
                            <th>Tax year</th>
                            <th>Date</th>
                            <th>Recorded value</th>
                            <th>Portal status</th>
                            <th>HMRC status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredClaims
                            .slice((page - 1) * 15, page * 15)
                            .map((s) => (
                              <tr key={s.id}>
                                <td>
                                  <button
                                    className="analytics-table-link"
                                    onClick={() =>
                                      navigate(`/submissions/${s.id}`, {
                                        state: { backUrl: submissionBackPath },
                                      })
                                    }
                                    title={s.id}
                                  >
                                    {s.id.slice(0, 8)} ↗
                                  </button>
                                </td>
                                {charities.length > 0 && (
                                  <td>
                                    <button
                                      className="analytics-table-link"
                                      onClick={() =>
                                        navigate(
                                          `/admin/charities/${s.charity_id}`,
                                        )
                                      }
                                    >
                                      {charities.find(
                                        (c) => c.id === s.charity_id,
                                      )?.name || 'Unlinked charity'}
                                    </button>
                                  </td>
                                )}
                                <td>{s.tax_year || 'Unknown'}</td>
                                <td>
                                  {s.submission_date?.slice(0, 10) || '—'}
                                </td>
                                <td className="analytics-money">
                                  {gbp(numberValue(s.amount_claimed))}
                                </td>
                                <td>{s.status}</td>
                                <td>
                                  <span
                                    className={`analytics-status ${s.hmrc_status === 'accepted' ? 'accepted' : ''}`}
                                  >
                                    {(s.hmrc_status || 'unknown').replace(
                                      /_/g,
                                      ' ',
                                    )}
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {filteredClaims.length === 0 && (
                        <Empty message="No matching submissions." />
                      )}
                    </div>
                    <div className="analytics-pagination">
                      <button
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        ← Previous
                      </button>
                      <span>
                        Page {page} of{' '}
                        {Math.max(1, Math.ceil(filteredClaims.length / 15))}
                      </span>
                      <button
                        disabled={page * 15 >= filteredClaims.length}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next →
                      </button>
                    </div>
                  </Panel>
                )}
              </>
            )}
            <section className="analytics-details">
              <div>
                <h3>Explore the numbers</h3>
                <p>Tables and exports use the current dashboard filters.</p>
              </div>
              <div className="analytics-actions">
                {onRecordsExport && (
                  <>
                    <button
                      disabled={!model.records.length}
                      onClick={() => onRecordsExport(model.records, 'full')}
                    >
                      Full file CSV
                    </button>
                    <button
                      disabled={!model.eligibleCount}
                      onClick={() => onRecordsExport(model.records, 'valid')}
                    >
                      Eligible records CSV
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowTable(!showTable)}
                  aria-expanded={showTable}
                >
                  {showTable ? 'Hide' : 'Show'} data table
                </button>
              </div>
            </section>
            {showTable && (
              <div className="analytics-panel analytics-table-wrap">
                <table className="analytics-data-table">
                  <caption>
                    Record totals by tax year ·{' '}
                    {taxYear === 'all' ? 'all years' : taxYear}
                  </caption>
                  <thead>
                    <tr>
                      <th>Tax year</th>
                      <th>Records</th>
                      <th>Donation value</th>
                      <th>Recorded claim</th>
                      <th>HMRC accepted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.byYear.map((r) => (
                      <tr key={r.year}>
                        <td>{r.year}</td>
                        <td>{r.records}</td>
                        <td>{gbp(r.donations)}</td>
                        <td>{gbp(r.recorded)}</td>
                        <td>{gbp(r.accepted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {view === 'overview' && (
                  <table className="analytics-data-table">
                    <caption>Donation origins by postcode area{donationDistrict ? ` · ${donationDistrict}` : ''}</caption>
                    <thead><tr><th>Postcode area</th><th>Area</th><th>Donation records</th><th>Donation value</th></tr></thead>
                    <tbody>
                      {geographicRows.map((r) => (
                        <tr key={r.code}><td>{r.code}</td><td>{r.name}</td><td>{r.count}</td><td>{gbp(r.value)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {view === 'quality' && (
                  <>
                    <table className="analytics-data-table">
                      <caption>
                        Selected record group · first{' '}
                        {Math.min(detailRecords.length, 50)} of{' '}
                        {detailRecords.length} rows
                      </caption>
                      <thead>
                        <tr>
                          <th>Record</th>
                          <th>Donation date</th>
                          <th>Tax year</th>
                          <th>Amount</th>
                          <th>Group</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailRecords.slice(0, 50).map((r, i) => (
                          <tr key={r.id || i}>
                            <td>{r.id?.slice(0, 8) || i + 1}</td>
                            <td>{r.donation_date || 'Unknown'}</td>
                            <td>{recordTaxYear(r)}</td>
                            <td>{gbp(numberValue(r.amount))}</td>
                            <td>
                              {
                                QUALITY.find((q) => q.key === qualityGroup(r))
                                  ?.label
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="analytics-footnote">
                      Selected group:{' '}
                      {QUALITY.find((q) => q.key === group)?.label ||
                        'All groups'}{' '}
                      · {detailRecords.length} records ·{' '}
                      {gbp(
                        detailRecords.reduce(
                          (sum, r) => sum + numberValue(r.amount),
                          0,
                        ),
                      )}{' '}
                      donation value.
                    </p>
                  </>
                )}
              </div>
            )}
            <details className="analytics-methodology">
              <summary>How these figures are calculated</summary>
              <p>
                Recorded claim value is the sum of submission amounts across all
                statuses. HMRC accepted value uses HMRC processing status and
                does not confirm payment. Eligible and incomplete opted-in
                estimates use 25% of uploaded donation value; they exclude
                other-provider claims and require eligibility checks. Imported
                records count donation rows, not unique donors. Tax years run
                from 6 April to 5 April; undated rows use their saved year or
                “Unknown”.
              </p>
              {model.unlinkedClaims > 0 && (
                <p>
                  {model.unlinkedClaims} submissions are not linked to a current
                  charity; included in totals, absent from charity rankings.
                </p>
              )}
            </details>
          </>
        )}
      </main>
    </div>
  )
}
