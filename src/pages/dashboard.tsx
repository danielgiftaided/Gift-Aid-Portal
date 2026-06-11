import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface Submission {
  id: string
  submission_date: string
  status: string
  amount_claimed: number
  number_of_donations: number
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [charityName, setCharityName] = useState<string>('')
  const [charityId, setCharityId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        navigate('/login')
        return
      }

      // Call /api/user/me — uses service role key so it reliably returns charityName
      const meResp = await fetch('/api/user/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      const meJson = await meResp.json()

      if (!meResp.ok || !meJson.ok) {
        navigate('/login')
        return
      }

      if (meJson.charityName) setCharityName(meJson.charityName)
      if (meJson.charityId) setCharityId(meJson.charityId)

      // Load submissions if charity is linked
      if (meJson.charityId) {
        const { data: submissionsData } = await supabase
          .from('submissions')
          .select('id, submission_date, status, amount_claimed, number_of_donations')
          .eq('charity_id', meJson.charityId)
          .order('submission_date', { ascending: false })
          .limit(5)

        setSubmissions(submissionsData || [])
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      case 'submitted': return 'bg-blue-100 text-blue-800'
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
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-2">
            Welcome, {charityName || '…'}
          </h2>
          <p className="text-gray-600">View your Gift Aid submission history and status</p>
        </div>

        {submissions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600">Total Claimed</div>
              <div className="text-3xl font-bold text-blue-600">
                £{submissions.reduce((sum, s) => sum + (parseFloat(String(s.amount_claimed)) || 0), 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600">Total Submissions</div>
              <div className="text-3xl font-bold text-gray-900">{submissions.length}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600">Approved</div>
              <div className="text-3xl font-bold text-green-600">
                {submissions.filter(s => s.status === 'approved').length}
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Recent Submissions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Donations</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-gray-500">
                      No submissions yet
                    </td>
                  </tr>
                ) : (
                  submissions.map((submission) => (
                    <tr key={submission.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {new Date(submission.submission_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        £{parseFloat(String(submission.amount_claimed || 0)).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {submission.number_of_donations}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(submission.status)}`}>
                          {submission.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <button
              onClick={() => navigate('/submissions')}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              View all submissions →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
