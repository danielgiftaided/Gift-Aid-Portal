import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

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

export default function Submissions() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    checkUserAndLoadSubmissions()
  }, [])

  const checkUserAndLoadSubmissions = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const { data: userData } = await supabase
        .from('users')
        .select('charity_id')
        .eq('id', session.user.id)
        .single()

      if (userData?.charity_id) {
        const { data: submissionsData } = await supabase
          .from('submissions')
          .select('*')
          .eq('charity_id', userData.charity_id)
          .order('submission_date', { ascending: false })

        setSubmissions(submissionsData || [])
      }
    } catch (error) {
      console.error('Error loading submissions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const downloadCSV = () => {
    const headers = [
      'Submission Date',
      'Tax Year',
      'Number of Donations',
      'Total Donations (£)',
      'Gift Aid Amount (£)',
      'Status',
      'HMRC Reference',
    ]

    const rows = submissions.map(s => [
      new Date(s.submission_date).toLocaleDateString('en-GB'),
      s.tax_year,
      s.number_of_donations,
      (parseFloat(String(s.amount_claimed || 0)) * 4).toFixed(2),
      parseFloat(String(s.amount_claimed || 0)).toFixed(2),
      s.status.charAt(0).toUpperCase() + s.status.slice(1),
      s.hmrc_reference || '',
    ])

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gift-aid-submissions-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      case 'submitted': return 'bg-blue-100 text-blue-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold mb-1">Your Gift Aid Submissions</h2>
            <p className="text-gray-600">View all submissions you've made to HMRC</p>
          </div>
          {submissions.length > 0 && (
            <button
              onClick={downloadCSV}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          )}
        </div>

        {submissions.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500 text-lg">No submissions found</p>
            <p className="text-gray-400 mt-2">Submissions will appear here as you make them</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submission Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tax Year</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount Claimed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Donations</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">HMRC Reference</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {submissions.map((submission) => (
                  <tr
                    key={submission.id}
                    onClick={() => navigate(`/submissions/${submission.id}`)}
                    className="hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {new Date(submission.submission_date).toLocaleDateString('en-GB', {
                        year: 'numeric', month: 'long', day: 'numeric'
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {submission.tax_year}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600">
                      £{parseFloat(String(submission.amount_claimed || 0)).toLocaleString('en-GB', {
                        minimumFractionDigits: 2, maximumFractionDigits: 2
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {submission.number_of_donations} donations
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(submission.status)}`}>
                        {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                      {submission.hmrc_reference || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
