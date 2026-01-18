import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!email.trim()) throw new Error("Email is required");
      if (!password) throw new Error("Password is required");
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      if (password !== password2) throw new Error("Passwords do not match");

      // 1) Create account
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signUpError) throw signUpError;

      // 2) Get session token (some configs require email confirmation; handle both cases)
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      // If email confirmation is ON, user may not be logged in yet.
      if (!token) {
        // Friendly message for confirmation-enabled setups
        setLoading(false);
        setError(
          "Account created. Please check your email to confirm your account, then return to login."
        );
        return;
      }

      // 3) Ask backend who this user is (role + charityId)
      const meResp = await fetch("/api/user/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const meJson = await meResp.json();

      if (!meResp.ok || !meJson.ok) {
        throw new Error(meJson?.error || "Failed to identify user after signup");
      }

      // 4) Redirect based on role and charity setup
      if (meJson.role === "operator") {
        window.location.href = "/admin";
        return;
      }

      // Default to charity user flow
      if (!meJson.charityId) {
        window.location.href = "/charity-setup";
        return;
      }

      window.location.href = "/dashboard";
    } catch (e: any) {
      setError(e?.message ?? "Signup failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2 text-center">Gift Aid Portal</h1>
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
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm password
            </label>
            <input
              type="password"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="text-sm text-gray-600 mt-4 text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
