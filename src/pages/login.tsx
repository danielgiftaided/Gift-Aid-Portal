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
  const successMessage = (location.state as any)?.message ?? null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Login succeeded but no session token found.");
      const meResp = await fetch("/api/user/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const meJson = await meResp.json();
      if (!meResp.ok || !meJson.ok) throw new Error(meJson?.error || "Failed to identify user");
      if (meJson.role === "operator") { navigate("/admin"); return; }
      if (meJson.role === "charity_user") {
        if (!meJson.charityId) { navigate("/charity-setup"); return; }
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
    <div className="min-h-screen bg-brand-surface flex flex-col">
      {/* Navy top block */}
      <div className="bg-brand-primary px-4 pt-10 pb-20 text-center flex-shrink-0">
        <div className="inline-flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-brand-accent rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">GA</span>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">Gift Aided Portal</span>
        </div>
        <p className="text-white/60 text-sm mt-1">Helping charities claim what they are owed</p>
      </div>

      {/* Card overlapping the two blocks */}
      <div className="max-w-md w-full mx-auto px-4 -mt-12 pb-10">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-bold text-brand-primary mb-1">Sign in</h2>
          <p className="text-sm text-gray-500 mb-6">Welcome back</p>

          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {successMessage}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" required className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40 focus:border-brand-accent"
                value={email} onChange={e => setEmail(e.target.value)} disabled={loading} autoComplete="email" />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/forgot-password" className="text-xs text-brand-accent hover:underline">Forgot password?</Link>
              </div>
              <input type="password" required className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40 focus:border-brand-accent"
                value={password} onChange={e => setPassword(e.target.value)} disabled={loading} autoComplete="current-password" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 mt-2">
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="text-sm text-gray-500 mt-5 text-center">
            New here?{" "}
            <Link to="/signup" className="text-brand-accent font-medium hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
