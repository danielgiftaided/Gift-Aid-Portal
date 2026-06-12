import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useParams, useNavigate, useLocation } from 'react-router-dom'

interface Submission {
  id: string
  submission_date: string
  status: string
  hmrc_reference: string | null
  amount_claimed: number
  number_of_donations: number
  tax_year: string
  notes: string | null
}

interface Donation {
  id: string
  title: string | null
  first_name: string
  last_name: string
  address: string
  postcode: string
  donation_date: string
  amount: number
}

function getStatusColor(status: string) {
  switch (status) {
    case 'approved': return 'bg-green-100 text-green-800'
    case 'rejected': return 'bg-red-100 text-red-800'
    case 'submitted': return 'bg-blue-100 text-blue-800'
    case 'pending': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

export default function SubmissionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const backUrl = (location.state as any)?.backUrl ?? '/submissions'

  const [submission, setSubmission] = useState<Submission | null>(null)
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (id) loadData()
  }, [id])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const { data: submissionData, error: subErr } = await supabase
        .from('submissions')
        .select('*')
        .eq('id', id)
        .single()

      if (subErr) throw new Error(subErr.message)
      setSubmission(submissionData)

      const { data: donationsData, error: donErr } = await supabase
        .from('donations')
        .select('*')
        .eq('submission_id', id)
        .order('created_at', { ascending: true })

      if (donErr) throw new Error(donErr.message)
      setDonations(donationsData || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const downloadCSV = () => {
    if (donations.length === 0) return

    const headers = ['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount (£)']

    const rows = donations.map(d => [
      d.title || '',
      d.first_name,
      d.last_name,
      d.address,
      d.postcode,
      d.donation_date,
      parseFloat(String(d.amount)).toFixed(2),
    ])

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `submission-${submission?.tax_year?.replace('/', '-')}-${submission?.submission_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Gift Aid Portal</h1>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <button
          onClick={() => navigate(backUrl)}
          className="text-sm text-blue-600 hover:underline mb-6 inline-block"
        >
          ← Back
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Submission summary */}
        {submission && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold mb-3">Submission Details</h2>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <span className="text-gray-500">Date submitted</span>
                  <span className="font-medium">
                    {new Date(submission.submission_date).toLocaleDateString('en-GB', {
                      year: 'numeric', month: 'long', day: 'numeric'
                    })}
                  </span>

                  <span className="text-gray-500">Tax year</span>
                  <span className="font-medium">{submission.tax_year}</span>

                  <span className="text-gray-500">Donations</span>
                  <span className="font-medium">{submission.number_of_donations}</span>

                  <span className="text-gray-500">Gift Aid claimed</span>
                  <span className="font-medium text-blue-600">
                    £{parseFloat(String(submission.amount_claimed || 0)).toLocaleString('en-GB', {
                      minimumFractionDigits: 2, maximumFractionDigits: 2
                    })}
                  </span>

                  {submission.hmrc_reference && (
                    <>
                      <span className="text-gray-500">HMRC reference</span>
                      <span className="font-mono font-medium">{submission.hmrc_reference}</span>
                    </>
                  )}

                  {submission.notes && (
                    <>
                      <span className="text-gray-500">Notes</span>
                      <span>{submission.notes}</span>
                    </>
                  )}
                </div>
              </div>

              <span className={`px-3 py-1 text-sm font-semibold rounded-full ${getStatusColor(submission.status)}`}>
                {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
              </span>
            </div>
          </div>
        )}

        {/* Donation rows */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Donation Records
              {donations.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({donations.length} donor{donations.length !== 1 ? 's' : ''})
                </span>
              )}
            </h3>
            <button
              onClick={downloadCSV}
              disabled={donations.length === 0}
              title={donations.length === 0 ? 'No donation records available to export' : 'Export donor rows as CSV'}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          </div>

          {donations.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              No donor records available for this submission.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {donations.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-500">{d.title || '—'}</td>
                      <td className="px-4 py-3 text-sm">{d.first_name}</td>
                      <td className="px-4 py-3 text-sm">{d.last_name}</td>
                      <td className="px-4 py-3 text-sm">{d.address}</td>
                      <td className="px-4 py-3 text-sm">{d.postcode}</td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">{d.donation_date}</td>
                      <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">
                        £{parseFloat(String(d.amount)).toLocaleString('en-GB', {
                          minimumFractionDigits: 2, maximumFractionDigits: 2
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-right text-gray-600">
                      Total donations
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-blue-600">
                      £{donations.reduce((sum, d) => sum + parseFloat(String(d.amount)), 0)
                        .toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
