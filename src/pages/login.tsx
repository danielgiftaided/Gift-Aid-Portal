import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1️⃣ Sign in with Supabase
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      // 2️⃣ Get access token
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("Login succeeded but no session token found.");
      }

      // 3️⃣ Ask backend who this user is
      const meResp = await fetch("/api/user/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const meJson = await meResp.json();

      if (!meResp.ok || !meJson.ok) {
        throw new Error(meJson?.error || "Failed to identify user");
      }

      // 4️⃣ Redirect based on role
      if (meJson.role === "operator") {
        window.location.href = "/admin";
        return;
      }

      if (meJson.role === "charity_user") {
        // ✅ NEW: if no charity yet -> go to charity setup
        if (!meJson.charityId) {
          window.location.href = "/charity-setup";
          return;
        }

        window.location.href = "/dashboard";
        return;
      }

      // Fallback
      window.location.href = "/dashboard";
    } catch (e: any) {
      setError(e?.message ?? "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2 text-center">Gift Aid Portal</h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          Sign in to continue
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
