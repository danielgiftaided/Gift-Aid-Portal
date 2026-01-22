import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function CharitySetup() {
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [charityId, setCharityId] = useState(""); // ✅ NEW (mandatory)
  const [charityNumber, setCharityNumber] = useState("");
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

      if (!name.trim()) throw new Error("Charity name is required");
      if (!contactEmail.trim()) throw new Error("Contact email is required");
      if (!charityId.trim()) throw new Error("Charity ID is required"); // ✅ NEW

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
          name: name.trim(),
          contact_email: contactEmail.trim(),
          charity_id: charityId.trim(), // ✅ NEW
          charity_number: charityNumber.trim() || null,
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

        <label
          className="block text-sm font-medium mb-1"
          htmlFor="charityName"
        >
          Charity name
        </label>
        <input
          id="charityName"
          name="charityName"
          className="w-full border rounded px-3 py-2 mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Helping Hands"
          autoComplete="organization"
          disabled={loading}
          required
        />

        <label
          className="block text-sm font-medium mb-1"
          htmlFor="contactEmail"
        >
          Contact email
        </label>
        <input
          id="contactEmail"
          name="contactEmail"
          type="email"
          className="w-full border rounded px-3 py-2 mb-3"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="contact@charity.org"
          autoComplete="email"
          disabled={loading}
          required
        />

        {/* ✅ NEW: Charity ID (mandatory) */}
        <label
          className="block text-sm font-medium mb-1"
          htmlFor="charityId"
        >
          Charity ID (required)
        </label>
        <input
          id="charityId"
          name="charityId"
          className="w-full border rounded px-3 py-2 mb-3"
          value={charityId}
          onChange={(e) => setCharityId(e.target.value)}
          placeholder="e.g. AA12345"
          autoComplete="off"
          disabled={loading}
          required
        />
        <p className="text-xs text-gray-500 mb-3">
          This is the charity’s identifier used for HMRC Charities Online submissions.
        </p>

        <label
          className="block text-sm font-medium mb-1"
          htmlFor="charityNumber"
        >
          Charity number (optional)
        </label>
        <input
          id="charityNumber"
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
