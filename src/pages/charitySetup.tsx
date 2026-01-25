import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

function normalizeHmrcCharId(v: string) {
  return v.trim().toUpperCase();
}

function validateHmrcCharId(charId: string): string | null {
  if (!charId) return "HMRC CHARID is required";
  if (charId.length < 3) return "HMRC CHARID looks too short";
  if (charId.length > 30) return "HMRC CHARID looks too long";
  if (!/^[A-Z0-9\-]+$/.test(charId)) return "HMRC CHARID must be letters/numbers/hyphen only";
  return null;
}

export default function CharitySetup() {
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // Optional charity number (regulator number etc)
  const [charityNumber, setCharityNumber] = useState("");

  // ✅ NEW: HMRC CHARID required
  const [hmrcCharId, setHmrcCharId] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      setContactEmail(user.email ?? "");
    })();
  }, []);

  const submit = async () => {
    try {
      setLoading(true);
      setError(null);

      const cleanName = name.trim();
      const cleanEmail = contactEmail.trim();
      const cleanCharityNo = charityNumber.trim() || null;
      const cleanHmrcCharId = normalizeHmrcCharId(hmrcCharId);

      if (!cleanName) throw new Error("Charity name is required");
      if (!cleanEmail) throw new Error("Contact email is required");

      // ✅ Required
      const vErr = validateHmrcCharId(cleanHmrcCharId);
      if (vErr) throw new Error(vErr);

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not logged in");

      const res = await fetch("/api/charity/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: cleanName,
          contact_email: cleanEmail,
          charity_number: cleanCharityNo,

          // ✅ NEW: store HMRC CHARID in charities.charity_id
          charity_id: cleanHmrcCharId,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || "Failed to setup charity");
      }

      window.location.href = "/dashboard";
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-surface flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white/80 rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2 text-brand-primary">
          Set up your charity
        </h1>
        <p className="text-gray-600 mb-4">
          Enter your charity details to create your portal workspace.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <label className="block text-sm font-medium mb-1">Charity name</label>
        <input
          id="charity-name"
          name="charityName"
          className="w-full border rounded px-3 py-2 mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Helping Hands"
          autoComplete="organization"
          disabled={loading}
        />

        <label className="block text-sm font-medium mb-1">Contact email</label>
        <input
          id="contact-email"
          name="contactEmail"
          className="w-full border rounded px-3 py-2 mb-3"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="contact@charity.org"
          autoComplete="email"
          disabled={loading}
        />

        {/* ✅ NEW REQUIRED FIELD */}
        <label className="block text-sm font-medium mb-1">
          HMRC CHARID <span className="text-red-600">*</span>
        </label>
        <input
          id="hmrc-charid"
          name="hmrcCharId"
          className="w-full border rounded px-3 py-2 mb-1"
          value={hmrcCharId}
          onChange={(e) => setHmrcCharId(e.target.value)}
          placeholder="e.g. AA12345"
          autoComplete="off"
          disabled={loading}
        />
        <div className="text-xs text-gray-500 mb-3">
          This is used in HMRC Gift Aid submissions. Letters/numbers only.
        </div>

        <label className="block text-sm font-medium mb-1">
          Charity number (optional)
        </label>
        <input
          id="charity-number"
          name="charityNumber"
          className="w-full border rounded px-3 py-2 mb-4"
          value={charityNumber}
          onChange={(e) => setCharityNumber(e.target.value)}
          placeholder="e.g. 123456"
          autoComplete="off"
          disabled={loading}
        />

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-brand-accent text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create charity"}
        </button>
      </div>
    </div>
  );
}
