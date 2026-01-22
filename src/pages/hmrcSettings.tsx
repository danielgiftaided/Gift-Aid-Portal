import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function HmrcSettings() {
  const [gatewayUserId, setGatewayUserId] = useState("");
  const [gatewayPassword, setGatewayPassword] = useState("");

  const [connected, setConnected] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Not logged in");
    return token;
  };

  const loadStatus = async () => {
    try {
      setChecking(true);
      setError(null);

      const token = await getToken();
      const res = await fetch("/api/hmrc/connection/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load HMRC status");
      setConnected(!!json.connected);
    } catch (e: any) {
      setError(e?.message ?? "Error");
      setConnected(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) window.location.href = "/login";
      else loadStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      setOkMsg(null);

      if (!gatewayUserId.trim()) throw new Error("HMRC/Gateway User ID is required");
      if (!gatewayPassword.trim()) throw new Error("HMRC/Gateway Password is required");

      const token = await getToken();
      const res = await fetch("/api/hmrc/connection/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          gatewayUserId: gatewayUserId.trim(),
          gatewayPassword: gatewayPassword.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to save HMRC credentials");

      setOkMsg("Saved successfully. HMRC connection is now set.");
      setGatewayPassword(""); // good practice: clear password field
      await loadStatus();
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-xl mx-auto p-6">
        <div className="bg-white/80 rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-brand-primary mb-2">HMRC Connection</h1>
          <p className="text-gray-600 mb-4">
            Enter your charity’s HMRC (Charities Online) credentials. Gift Aided will use these when an operator submits claims.
          </p>

          <div className="mb-4">
            <div className="text-sm text-gray-600">Status</div>
            <div className="mt-1">
              {checking ? (
                <span className="text-gray-500">Checking…</span>
              ) : connected ? (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-brand-accent/10 text-brand-accent">
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">
                  Not connected
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {okMsg && (
            <div className="bg-brand-primary/10 border border-brand-primary/20 text-brand-primary px-4 py-3 rounded mb-4">
              {okMsg}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                HMRC / Government Gateway User ID
              </label>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                value={gatewayUserId}
                onChange={(e) => setGatewayUserId(e.target.value)}
                autoComplete="username"
                placeholder="Enter your HMRC user ID"
                disabled={saving}
                name="hmrcUserId"
                id="hmrcUserId"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                HMRC / Government Gateway Password
              </label>
              <input
                type="password"
                className="w-full border rounded px-3 py-2 text-sm"
                value={gatewayPassword}
                onChange={(e) => setGatewayPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your HMRC password"
                disabled={saving}
                name="hmrcPassword"
                id="hmrcPassword"
              />
            </div>

            <button
              onClick={save}
              disabled={saving}
              className="w-full bg-brand-primary text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save HMRC credentials"}
            </button>

            <button
              onClick={loadStatus}
              disabled={checking}
              className="w-full rounded px-4 py-2 text-sm font-medium border border-brand-primary/20 text-brand-primary hover:bg-brand-primary/10 disabled:opacity-50"
            >
              {checking ? "Refreshing…" : "Refresh status"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
