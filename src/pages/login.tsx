import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { adminDestination, destinationAfterAuth, verifyPortalProfile, finishSignIn, type AdminLoginIntent } from "../utils/authNavigation";

function AuthShapes() {
  return (
    <div className="absolute top-0 right-0 pointer-events-none select-none overflow-hidden w-56 h-full" style={{ zIndex: 0 }}>
      <div style={{ position: 'absolute', left: '242px', top: '30px',  width: '136px', height: '142px', background: '#304675', borderTopRightRadius: '100%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '187px', width: '136px', height: '266px', background: '#0c745d' }} />
      <div style={{ position: 'absolute', left: '134px', top: '76px',  width: '97px',  height: '96px',  background: '#e8e4db', borderRadius: '50% 50% 0 50%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '468px', width: '97px',  height: '97px',  background: '#e8e4db', borderRadius: '0 50% 50% 50%' }} />
    </div>
  )
}

export default function Login({ admin = false }: { admin?: boolean }) {
  const location = useLocation();
  const intent: AdminLoginIntent = { adminLogin: admin, adminReturnTo: adminDestination((location.state as AdminLoginIntent | null)?.adminReturnTo) };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>((location.state as any)?.error || null);
  const navigate = useNavigate();
  const successMessage = (location.state as any)?.message ?? null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Goes through our own backend rather than calling Supabase directly —
      // this is what allows login lockout and audit logging to exist at all.
      const loginResp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const loginJson = await loginResp.json();
      if (!loginResp.ok || !loginJson.ok) throw new Error(loginJson?.error ?? "Login failed");

      // Hydrate the local Supabase client with the session our backend just
      // verified — everything below this line is unchanged from before.
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: loginJson.access_token,
        refresh_token: loginJson.refresh_token,
      });
      if (setSessionError) throw setSessionError;
      if (admin) {
        const profile = await verifyPortalProfile(loginJson.access_token);
        // Validate the account before asking a charity user to perform admin MFA.
        // This determines a destination only; it never navigates before MFA.
        destinationAfterAuth(profile, intent);
      }

      // ── MFA check ──────────────────────────────────────────
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (!aal) throw new Error("Could not verify your sign-in security level. Please try again.");

      if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
        // User has MFA enrolled — send to challenge
        navigate('/mfa-challenge', { state: intent });
        return;
      }

      if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal1') {
        // No MFA enrolled — force setup before proceeding
        navigate('/mfa-setup', { state: intent });
        return;
      }

      await finishSignIn(supabase, navigate, intent);

    } catch (e: any) {
      setError(e?.message ?? "Login failed");
      setLoading(false);
    }
  };

  const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent";

  return (
    <div className="min-h-screen bg-brand-surface flex overflow-hidden relative">
      {!admin && <AuthShapes />}
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 py-12 relative" style={{ zIndex: 10 }}>
        <div className="max-w-sm w-full mx-auto lg:mx-0">
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, color: '#0c745d', fontSize: '2rem', lineHeight: 1, display: 'block', marginBottom: '0.25rem' }}>
            gift aided <span style={{ fontWeight: 400 }}>Portal</span>
          </span>
          <p className="text-gray-400 text-sm mb-8">Helping charities claim what they are owed</p>

          {successMessage && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">{successMessage}</div>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

          <div className="bg-white rounded-2xl shadow-md p-7">
            <h2 className="text-lg font-bold text-brand-primary mb-0.5">{admin ? "Admin sign in" : "Sign in"}</h2>
            <p className="text-xs text-gray-400 mb-5">{admin ? "Use your registered operator account. MFA is required." : "Welcome back"}</p>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
                <input type="email" required className={inputClass} value={email} onChange={e => setEmail(e.target.value)} disabled={loading} autoComplete="email" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-medium text-gray-600">Password</label>
                  <Link to="/forgot-password" className="text-xs text-brand-accent hover:underline">Forgot password?</Link>
                </div>
                <input type="password" required className={inputClass} value={password} onChange={e => setPassword(e.target.value)} disabled={loading} autoComplete="current-password" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>
            {admin ? <p className="text-xs text-gray-400 mt-5 text-center"><Link to="/login" className="text-brand-accent font-semibold">Charity sign in</Link></p> : <p className="text-xs text-gray-400 mt-5 text-center">
              New here?{" "}<Link to="/signup" className="text-brand-accent font-semibold hover:underline">Create an account</Link>
            </p>}
          </div>
        </div>
      </div>
    </div>
  );
}
