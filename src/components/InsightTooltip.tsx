interface Props {
  active?: boolean
  label?: string | number
  payload?: Array<{ name?: string; value?: number | string; color?: string }>
  currency?: boolean
}

export function InsightTooltip({ active, label, payload, currency = false }: Props) {
  if (!active || !payload?.length) return null
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl min-w-[180px]">
    <p className="text-xs font-semibold text-slate-500 mb-3">{label}</p>
    {payload.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-6 py-1 text-xs">
      <span className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.name}</span>
      <span className="font-semibold text-brand-primary tabular-nums">{currency ? '£' : ''}{Number(item.value ?? 0).toLocaleString('en-GB', { minimumFractionDigits: currency ? 2 : 0, maximumFractionDigits: currency ? 2 : 0 })}</span>
    </div>)}
  </div>
}

export function CurrencyInsightTooltip(props: Props) {
  return <InsightTooltip {...props} currency />
}
