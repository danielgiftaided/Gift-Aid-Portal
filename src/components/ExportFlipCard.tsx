import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  value: number
  description: string
  percentage?: number
  tone?: string
  onExport?: () => void
}

export default function ExportFlipCard({ label, value, description, percentage, tone = 'text-brand-accent', onExport }: Props) {
  const [flipped, setFlipped] = useState(false)
  const front = useRef<HTMLButtonElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const changed = useRef(false)
  useEffect(() => {
    if (changed.current !== flipped) (flipped ? back : front).current?.focus()
    changed.current = flipped
  }, [flipped])
  const content = <>
    <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{label}</span>
    <span className={`block text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>{value.toLocaleString('en-GB')}</span>
    <span className="block text-xs leading-relaxed text-slate-500 mt-2">{description}</span>
    {percentage !== undefined && <span className="block text-xs text-slate-400 mt-2">{percentage}% of all records</span>}
  </>
  return <div className="export-flip-card rounded-2xl border border-slate-200 bg-white shadow-sm min-h-[190px]" style={{ perspective: '1000px' }}>
    {flipped && onExport ? <div key="back" className="export-card-face p-5 min-h-[190px] flex flex-col justify-between" onKeyDown={event => { if (event.key === 'Escape') setFlipped(false) }}>
      <div><p className="font-semibold text-brand-primary">{label}</p><p className="text-xs text-slate-500 mt-2">Download {value.toLocaleString('en-GB')} records as CSV.</p></div>
      <div className="flex flex-wrap gap-3 mt-5">
        <button onClick={onExport} disabled={value === 0} className="rounded-lg bg-brand-accent px-4 py-2 text-xs font-semibold text-white hover:bg-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-40">Export CSV</button>
        <button ref={back} onClick={() => setFlipped(false)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Back</button>
      </div>
    </div> : onExport ? <button ref={front} key="front" onClick={() => setFlipped(true)} aria-label={`${label}: ${value} records. Show download options`} className="export-card-face relative block w-full h-full min-h-[190px] rounded-2xl p-5 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
      {content}<span aria-hidden="true" className="absolute right-4 bottom-3 text-slate-400">↻</span>
    </button> : <div className="p-5 min-h-[190px]">{content}</div>}
  </div>
}
