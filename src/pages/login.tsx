import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

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
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) throw authError;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("Login succeeded but no session token found.");

      const meResp = await fetch("/api/user/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const meJson = await meResp.json();

      if (!meResp.ok || !meJson.ok) {
        throw new Error(meJson?.error || "Failed to identify user");
      }

      if (meJson.role === "operator") {
        window.location.href = "/admin";
        return;
      }

      if (meJson.role === "charity_user") {
        if (!meJson.charityId) {
          window.location.href = "/charity-setup";
          return;
        }
        window.location.href = "/dashboard";
        return;
      }

      window.location.href = "/dashboard";
    } catch (e: any) {
      setError(e?.message ?? "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-surface px-4">
      <div className="max-w-md w-full bg-white/80 rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2 text-center text-brand-primary">
          Gift Aid Portal
        </h1>
        <p className="text-sm text-gray-600 text-center mb-6">Sign in to continue</p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
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
            className="w-full bg-brand-primary text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="text-sm text-gray-600 mt-4 text-center">
          New here?{" "}
          <Link to="/signup" className="text-brand-primary hover:underline hover:opacity-90">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
