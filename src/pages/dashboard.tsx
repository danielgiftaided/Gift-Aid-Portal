import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Charity {
  id: string;
  name: string;
  contact_email: string;
  charity_number?: string | null; // stored, but NOT editable here
}

interface Submission {
  id: string;
  submission_date: string;
  status: string;
  hmrc_reference: string | null;
  amount_claimed: number;
  number_of_donations: number;
  tax_year: string;
}

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [charity, setCharity] = useState<Charity | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkUser = async () => {
    try {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      setUser(user);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("No session token found. Please log in again.");
      }

      // 1) Load charity info from backend
      const charityResp = await fetch("/api/charity/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const charityJson = await charityResp.json();

      if (!charityResp.ok || !charityJson.ok) {
        throw new Error(charityJson?.error || "Failed to load charity");
      }

      setCharity(charityJson.charity as Charity);

      // 2) Load submissions from backend
      const subsResp = await fetch("/api/submissions/list?limit=100&offset=0", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const subsJson = await subsResp.json();

      if (!subsResp.ok || !subsJson.ok) {
        throw new Error(subsJson?.error || "Failed to load submissions");
      }

      setSubmissions((subsJson.submissions || []) as Submission[]);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setCharity(null);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "bg-green-100 text-green-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      case "submitted":
      case "pending":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const totalClaimed = submissions.reduce(
    (sum, s) => sum + Number(s.amount_claimed || 0),
    0
  );

  const pendingCount = submissions.filter(
    (s) => s.status === "pending" || s.status === "submitted"
  ).length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
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
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-2">
            Welcome, {charity?.name || "Charity"}
          </h2>
          <p className="text-gray-600">View and track your Gift Aid submissions</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-600">Total Claimed</div>
            <div className="text-3xl font-bold text-blue-600">
              £{totalClaimed.toLocaleString()}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-600">Total Submissions</div>
            <div className="text-3xl font-bold text-gray-900">
              {submissions.length}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-600">Pending</div>
            <div className="text-3xl font-bold text-orange-600">
              {pendingCount}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recent Submissions</h3>

            <button
              onClick={checkUser}
              className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50"
              title="Refresh data"
            >
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Tax Year
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Donations
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    HMRC Ref
                  </th>
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      No submissions yet
                    </td>
                  </tr>
                ) : (
                  submissions.map((submission) => (
                    <tr key={submission.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {new Date(submission.submission_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {submission.tax_year}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        £{Number(submission.amount_claimed || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {submission.number_of_donations}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                            submission.status
                          )}`}
                        >
                          {submission.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {submission.hmrc_reference || "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {user?.id && (
          <div className="text-xs text-gray-400 mt-6">Logged in user: {user.id}</div>
        )}
      </div>
    </div>
  );
}
