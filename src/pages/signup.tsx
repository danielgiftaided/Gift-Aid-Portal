import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const passwordsMatch = useMemo(() => {
    if (!password || !confirm) return null; // no indicator until both typed
    return password === confirm;
  }, [password, confirm]);

  const canSubmit = useMemo(() => {
    return (
      email.trim().length > 0 &&
      password.length > 0 &&
      confirm.length > 0 &&
      password === confirm
    );
  }, [email, password, confirm]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      setLoading(true);

      if (!email.trim()) throw new Error("Email is required");
      if (!password) throw new Error("Password is required");
      if (!confirm) throw new Error("Please confirm your password");
      if (password !== confirm) throw new Error("Passwords do not match");

      const { error: signErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // IMPORTANT: must be your deployed domain (not localhost)
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });

      if (signErr) throw signErr;

      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-surface px-4">
        <div className="max-w-md w-full bg-white/80 rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold mb-2 text-brand-primary">
            Check your email
          </h1>
          <p className="text-gray-700">
            We’ve sent you a verification link. Once verified, come back and sign in.
          </p>
          <div className="mt-4">
            <Link
              to="/login"
              className="inline-block bg-brand-accent text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Go to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-surface px-4">
      <div className="max-w-md w-full bg-white/80 rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2 text-brand-primary text-center">
          Gift Aid Portal
        </h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          Create an account to get started
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email *
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
              Password *
            </label>
            <input
              type="password"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm password *
            </label>
            <input
              type="password"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />

            {passwordsMatch !== null && (
              <div
                className={`text-xs mt-2 ${
                  passwordsMatch ? "text-green-700" : "text-red-700"
                }`}
              >
                {passwordsMatch ? "Passwords match ✅" : "Passwords do not match ❗"}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full bg-brand-accent text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="text-sm text-gray-700 mt-4 text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-brand-primary hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
