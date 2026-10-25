import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import mapData from '../../data/uk-postcode-map.json'
import { geographicDetail, type DonationGeography } from '../../../shared/donationGeography'
import { CurrencyInsightTooltip, InsightTooltip } from '../InsightTooltip'
import './donation-map.css'

export type MapMetric = 'count' | 'value'
const money = (n: number) => n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })
const count = (n: number) => n.toLocaleString('en-GB')
const palette = ['#d7ece4', '#a8d6c4', '#70b69a', '#369779', '#0c745d', '#064d40']

export default function DonationMap({ data, selectedArea, district, metric, onSelectArea, onSelectDistrict, onMetric }: {
  data: DonationGeography
  selectedArea: string | null
  district: string | null
  metric: MapMetric
  onSelectArea: (code: string | null) => void
  onSelectDistrict: (code: string | null) => void
  onMetric: (metric: MapMetric) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const area = data.areas.find((a) => a.code === selectedArea)
  const rows = useMemo(() => area?.rows || data.areas.flatMap((a) => a.rows), [area, data])
  const detail = useMemo(() => geographicDetail(rows, district), [rows, district])
  const areaDetail = useMemo(() => geographicDetail(rows), [rows])
  const maximum = Math.max(0, ...data.areas.map((a) => a[metric]))
  const format = metric === 'value' ? money : count
  const highlighted = data.areas.find((a) => a.code === hovered)
  const shape = mapData.areas.find((a) => a.code === selectedArea)
  const viewBox = shape ? (() => {
    const [x1, y1, x2, y2] = shape.bounds
    const pad = Math.max(x2 - x1, y2 - y1) * 0.12 + 3
    return `${x1 - pad} ${y1 - pad} ${x2 - x1 + pad * 2} ${y2 - y1 + pad * 2}`
  })() : mapData.viewBox
  const selectArea = (code: string | null) => { onSelectArea(code); onSelectDistrict(null); setHovered(null) }
  const ranked = area
    ? areaDetail.districts.sort((a, b) => b[metric] - a[metric] || a.code.localeCompare(b.code))
    : data.areas.filter((a) => a.count > 0).sort((a, b) => b[metric] - a[metric] || a.code.localeCompare(b.code))
  const rankMax = Math.max(0, ...ranked.map((r) => r[metric]))
  return <div className="donation-map">
    <div className="donation-map-toolbar">
      <div className="analytics-toggle" aria-label="Map colour measure">
        <button aria-pressed={metric === 'count'} onClick={() => onMetric('count')}>Donation count</button>
        <button aria-pressed={metric === 'value'} onClick={() => onMetric('value')}>Donation value</button>
      </div>
      <label>Explore a postcode area
        <select value={selectedArea || ''} onChange={(e) => selectArea(e.target.value || null)}>
          <option value="">All UK areas</option>
          {data.areas.slice().sort((a, b) => a.name.localeCompare(b.name)).map((a) =>
            <option key={a.code} value={a.code}>{a.name} ({a.code}) · {count(a.count)} records</option>)}
        </select>
      </label>
      {selectedArea && <button className="donation-map-back" onClick={() => selectArea(null)}>← Back to UK</button>}
    </div>
    <p className="donation-map-coverage" role="status">
      <strong>{count(data.mappedCount)} of {count(data.totalCount)}</strong> donation records mapped.
      {data.unmappedCount > 0 && ` ${count(data.unmappedCount)} not mapped: ${count(data.missingCount)} without postcodes, ${count(data.invalidCount)} invalid and ${count(data.outsideCount)} outside supported UK areas.`}
    </p>
    <div className="donation-map-layout">
      <div className="donation-map-canvas">
        <svg viewBox={viewBox} role="group" aria-label="UK donation heat map by postcode area">
          {mapData.areas.map((boundary) => {
            const stats = data.areas.find((a) => a.code === boundary.code)!
            const intensity = maximum > 0 ? Math.max(0, stats[metric]) / maximum : 0
            const fill = stats.count ? palette[Math.min(palette.length - 1, Math.floor(intensity * (palette.length - 1)))] : '#e6eae7'
            return <path key={boundary.code} d={boundary.path} fill={fill} fillRule="evenodd"
              stroke={selectedArea === boundary.code ? '#304675' : '#fff'} strokeWidth={selectedArea === boundary.code ? 2 : 0.65}
              vectorEffect="non-scaling-stroke" role="button" tabIndex={0}
              aria-label={`${boundary.name} (${boundary.code}): ${count(stats.count)} donation records, ${money(stats.value)}`}
              aria-pressed={selectedArea === boundary.code}
              onClick={() => selectArea(boundary.code)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectArea(boundary.code) } }}
              onMouseEnter={() => setHovered(boundary.code)} onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(boundary.code)} onBlur={() => setHovered(null)}>
              <title>{`${boundary.name} (${boundary.code}) · ${count(stats.count)} records · ${money(stats.value)}`}</title>
            </path>
          })}
        </svg>
        <div className="donation-map-hover" aria-hidden="true">
          {highlighted ? <><strong>{highlighted.name} ({highlighted.code})</strong><span>{count(highlighted.count)} records · {money(highlighted.value)}</span></> : <span>{selectedArea ? 'Select a nearby area or return to the UK view.' : 'Select an area on the map to explore its donations.'}</span>}
        </div>
        <div className="donation-map-scale">
          <span><i style={{ background: '#e6eae7' }} />No records</span>
          <span>Low</span><div>{palette.map((color) => <i key={color} style={{ background: color }} />)}</div><span>High · {format(maximum)}</span>
        </div>
      </div>
      <section className="donation-map-detail" aria-label="Regional donation insights">
        <div className="donation-map-detail-heading">
          <span className="analytics-eyebrow">{area ? `POSTCODE AREA ${area.code}` : 'MAPPED UK DONATIONS'}</span>
          <h4>{district || area?.name || 'UK overview'}</h4>
          {district && <button onClick={() => onSelectDistrict(null)}>← All {area?.name} districts</button>}
        </div>
        <dl className="donation-map-stats">
          <div><dt>Donation records</dt><dd>{count(detail.count)}</dd></div>
          <div><dt>Donation value</dt><dd>{money(detail.value)}</dd></div>
          <div><dt>Average donation</dt><dd>{detail.average === null ? '—' : money(detail.average)}</dd></div>
        </dl>
        {detail.count === 0 && <p className="donation-map-empty">No donation records for this area in the current selection.</p>}
        <h5>{area ? 'Postcode districts' : 'Leading postcode areas'}</h5>
        <div className="donation-map-ranking">
          {ranked.slice(0, 8).map((r) => <button key={r.code}
            aria-pressed={area ? district === r.code : selectedArea === r.code}
            onClick={() => area ? onSelectDistrict(district === r.code ? null : r.code) : selectArea(r.code)}>
            <span>{'name' in r ? String(r.name) : r.code}<small>{'name' in r ? ` (${r.code})` : ''}</small></span>
            <strong>{format(r[metric])}</strong>
            <span className="donation-map-rank-bar"><i style={{ width: `${rankMax > 0 ? Math.max(0, r[metric]) / rankMax * 100 : 0}%` }} /></span>
          </button>)}
          {area && ranked.length > 8 && <label>All postcode districts<select value={district || ''} onChange={(e) => onSelectDistrict(e.target.value || null)}>
            <option value="">All districts</option>{areaDetail.districts.map((d) => <option key={d.code} value={d.code}>{d.code}</option>)}
          </select></label>}
        </div>
        {detail.monthly.length > 0 && <div className="donation-map-trend">
          <h5>{metric === 'value' ? 'Donation value by month' : 'Donation records by month'}</h5>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={detail.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#536577' }} minTickGap={24} axisLine={false} tickLine={false} />
              <YAxis width={48} tick={{ fontSize: 10, fill: '#536577' }} allowDecimals={metric === 'value'} axisLine={false} tickLine={false}
                tickFormatter={(n) => metric === 'value' ? `£${Number(n).toLocaleString('en-GB', { notation: 'compact' })}` : count(n)} />
              <Tooltip content={metric === 'value' ? <CurrencyInsightTooltip /> : <InsightTooltip />} />
              <Bar dataKey={metric} name={metric === 'value' ? 'Donation value' : 'Donation records'} fill="#0c745d" maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
        {detail.undatedCount > 0 && <p className="analytics-footnote">{count(detail.undatedCount)} records without usable donation dates are excluded from the monthly chart.</p>}
      </section>
    </div>
    <p className="analytics-footnote">Postal areas are not council boundaries. Figures describe uploaded donation records, not unique donors or confirmed Gift Aid claims. Outlines are approximate.</p>
    <p className="donation-map-credit">Boundaries: <a href="https://github.com/missinglink/uk-postcode-polygons">Wikipedia contributors</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>; Northern Ireland: <a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a>.</p>
  </div>
}
