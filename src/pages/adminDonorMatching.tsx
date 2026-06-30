import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface IncompleteRecord {
  id: string; charityId: string; charityName: string
  title: string | null; firstName: string | null; lastName: string | null
  address: string | null; postcode: string | null; donationDate: string | null
  amount: number | null; taxYear: string | null; missingFields: string[]
}

interface Candidate {
  id: string; charityId: string; charityName: string
  title: string | null; firstName: string | null; lastName: string | null
  address: string | null; postcode: string | null; donationDate: string | null
  amount: number | null; recordStatus: string; confidence: 'high' | 'medium' | 'low'
  appearsInRecords: number
}

function Logo() {
  return (
    <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, color: '#0c745d', fontSize: '1.6rem', lineHeight: 1 }}>
      gift aided <span style={{ fontWeight: 400 }}>Portal</span>
    </span>
  )
}

function PageShapes() {
  return (
    <div className="absolute right-0 top-0 pointer-events-none select-none" style={{ zIndex: 0, width: '420px', height: '600px' }}>
      <div style={{ position: 'absolute', left: '242px', top: '30px',  width: '136px', height: '142px', background: '#304675', borderTopRightRadius: '100%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '187px', width: '136px', height: '266px', background: '#0c745d' }} />
      <div style={{ position: 'absolute', left: '134px', top: '76px',  width: '97px',  height: '96px',  background: '#e8e4db', borderRadius: '50% 50% 0 50%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '468px', width: '97px',  height: '97px',  background: '#e8e4db', borderRadius: '0 50% 50% 50%' }} />
    </div>
  )
}

const confidenceStyle: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-500',
}
const confidenceLabel: Record<string, string> = {
  high: 'High confidence — name & postcode match',
  medium: 'Medium confidence — unique name match',
  low: 'Low confidence — common name, multiple matches',
}

export default function AdminDonorMatching() {
  const navigate = useNavigate()
  const [records, setRecords] = useState<IncompleteRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 25

  const [searchingFor, setSearchingFor] = useState<IncompleteRecord | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [searchCriteria, setSearchCriteria] = useState<string[]>([])
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  useEffect(() => { loadData() }, [page])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const resp = await fetch(`/api/admin/listIncompleteRecords?limit=${pageSize}&offset=${page * pageSize}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.error || 'Failed to load incomplete records')
      setRecords(json.records)
      setTotal(json.total)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const openSearch = async (record: IncompleteRecord) => {
    setSearchingFor(record)
    setCandidates([])
    setSearchCriteria([])
    setSearchMessage(null)
    setSearching(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch('/api/admin/findDonorMatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ record_id: record.id }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.error || 'Search failed')
      setCandidates(json.candidates || [])
      setSearchCriteria(json.searchCriteria || [])
      if (json.message) setSearchMessage(json.message)
    } catch (e: any) {
      setSearchMessage(e.message)
    } finally {
      setSearching(false)
    }
  }

  const applyMatch = async (candidate: Candidate) => {
    if (!searchingFor) return
    if (!window.confirm(`Use ${candidate.firstName} ${candidate.lastName}'s details from ${candidate.charityName} to fill in the missing fields on this record?`)) return
    setApplyingId(candidate.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch('/api/admin/applyDonorMatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ incomplete_record_id: searchingFor.id, matched_record_id: candidate.id }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.error || 'Failed to apply match')
      setResultMessage(json.message)
      setSearchingFor(null)
      await loadData()
      setTimeout(() => setResultMessage(null), 6000)
    } catch (e: any) {
      setSearchMessage(e.message)
    } finally {
      setApplyingId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>
        <nav className="bg-white border-b border-gray-100">
          <div className="w-full px-8 py-4 flex justify-between items-center">
            <Logo />
            <div className="flex items-center gap-6">
              <button onClick={() => navigate('/admin/insights')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Insights</button>
              <button onClick={() => navigate('/admin/donor-matching')} className="text-sm font-medium text-brand-accent transition-colors">Donor Matching</button>
              <button onClick={() => navigate('/admin/pending-charities')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Pending Charities</button>
              <button onClick={() => navigate('/admin/activity-log')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Activity Log</button>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
            </div>
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-6 pt-12 pb-4">
          <button onClick={() => navigate('/admin')} className="text-sm font-medium text-brand-accent hover:underline mb-4 inline-block">← Back to Admin</button>
          <h1 className="text-3xl font-bold text-brand-primary">Donor Matching</h1>
          <p className="text-gray-400 text-sm mt-1 max-w-2xl">
            Search across every charity's valid and opted-out records for a likely match to an incomplete donor — useful when a name is present but details like address or postcode are missing. Matches are suggestions only; always reviewed and confirmed by you before anything is applied.
          </p>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-12">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
          {resultMessage && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">{resultMessage}</div>}

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-brand-primary">Incomplete Records</h2>
              <span className="text-xs text-gray-400">{loading ? 'Loading…' : `${total} total`}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-50">
                <thead>
                  <tr className="bg-gray-50/50">
                    {['Charity', 'Donor', 'Missing Fields', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-300">Loading…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-300">No incomplete records — everything's accounted for.</td></tr>
                  ) : records.map(r => (
                    <tr key={r.id} className="hover:bg-brand-surface/40 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{r.charityName}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {(r.firstName || r.lastName) ? `${r.firstName || ''} ${r.lastName || ''}`.trim() : <span className="text-gray-300 italic">No name on file</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{r.missingFields.join(', ')}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => openSearch(r)}
                          disabled={!r.firstName && !r.lastName}
                          title={(!r.firstName && !r.lastName) ? 'No name on file — nothing specific enough to search by' : `Search using: ${[r.firstName && 'first name', r.lastName && 'last name', r.postcode && 'postcode'].filter(Boolean).join(', ')}`}
                          className="text-xs font-semibold text-brand-accent hover:text-brand-primary disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Search for matches
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between text-sm">
                <span className="text-gray-400">Page {page + 1} of {totalPages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-3 py-1 rounded border border-gray-200 text-gray-500 disabled:opacity-40 hover:bg-gray-50">Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="px-3 py-1 rounded border border-gray-200 text-gray-500 disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Match candidates modal */}
      {searchingFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-brand-primary">
                  Matches for {searchingFor.firstName} {searchingFor.lastName}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {searchingFor.charityName} — missing {searchingFor.missingFields.join(', ')}
                  {searchCriteria.length > 0 && ` · Searched by: ${searchCriteria.join(' + ')}`}
                </p>
              </div>
              <button onClick={() => setSearchingFor(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              {searching ? (
                <p className="text-sm text-gray-400 text-center py-6">Searching…</p>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">{searchMessage || 'No matches found.'}</p>
              ) : (
                <div className="space-y-3">
                  {searchMessage && <p className="text-xs text-gray-400 mb-2">{searchMessage}</p>}
                  {candidates.map(c => (
                    <div key={c.id} className="border border-gray-100 rounded-lg p-4 flex items-start justify-between gap-4">
                      <div className="text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-brand-primary">{c.title ? `${c.title} ` : ''}{c.firstName} {c.lastName}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${confidenceStyle[c.confidence]}`} title={confidenceLabel[c.confidence]}>
                            {c.confidence}
                          </span>
                          <span className="text-xs text-gray-400">{c.recordStatus === 'opt_out' ? 'Opted out' : 'Valid claim'}</span>
                        </div>
                        <p className="text-gray-500">{c.address}, {c.postcode}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          From: {c.charityName}
                          {c.appearsInRecords > 1 && <span className="ml-1 text-gray-300">· seen in {c.appearsInRecords} records</span>}
                        </p>
                      </div>
                      <button
                        onClick={() => applyMatch(c)}
                        disabled={applyingId === c.id}
                        className="flex-shrink-0 bg-brand-accent text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-40"
                      >
                        {applyingId === c.id ? 'Applying…' : 'Use this match'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
