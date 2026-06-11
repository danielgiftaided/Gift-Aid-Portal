import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate, useLocation } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Show success message if redirected here after a password reset
  const successMessage = (location.state as any)?.message ?? null;

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
        cache: "no-store",
      });

      const meJson = await meResp.json();
      if (!meResp.ok || !meJson.ok) {
        throw new Error(meJson?.error || "Failed to identify user");
      }

      if (meJson.role === "operator") {
        navigate("/admin");
        return;
      }

      if (meJson.role === "charity_user") {
        if (!meJson.charityId) {
          navigate("/charity-setup");
          return;
        }
        // Pass charityName via navigation state so dashboard can show it immediately
        navigate("/dashboard", { state: { charityName: meJson.charityName } });
        return;
      }

      navigate("/dashboard");
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

        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4 text-sm">
            {successMessage}
          </div>
        )}

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
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <Link to="/forgot-password" className="text-xs text-brand-primary hover:underline">
                Forgot password?
              </Link>
            </div>
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
