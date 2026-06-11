import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function CharitySetup() {
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [charityNumber, setCharityNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        setContactEmail(session.user.email);
      }
    });
  }, []);

  const submit = async () => {
    try {
      setLoading(true);
      setError(null);

      const cleanName = name.trim();
      const cleanEmail = contactEmail.trim();
      const cleanCharityNumber = charityNumber.trim();

      if (!cleanName) throw new Error("Charity name is required");
      if (!cleanEmail) throw new Error("Contact email is required");
      if (!cleanCharityNumber) throw new Error("Registered charity number is required");

      if (!/^[A-Za-z0-9]+$/.test(cleanCharityNumber)) {
        throw new Error("Charity number must contain only letters and numbers (no spaces).");
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        navigate("/login");
        return;
      }

      const res = await fetch("/api/charity/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: cleanName,
          contact_email: cleanEmail,
          charity_number: cleanCharityNumber,
        }),
      });

      // Read as text first so we can diagnose non-JSON responses
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Server returned unexpected response (HTTP ${res.status}): ${text.substring(0, 200)}`);
      }

      if (!res.ok || !json.ok) {
        throw new Error(json?.error || "Failed to set up charity");
      }

      navigate("/dashboard");
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-surface flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white/80 rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2 text-brand-primary">Set up your charity</h1>
        <p className="text-gray-600 mb-4">
          Enter your charity details to create your portal workspace.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-xs break-all">
            {error}
          </div>
        )}

        <label className="block text-sm font-medium mb-1">
          Charity name <span className="text-red-600">*</span>
        </label>
        <input
          className="w-full border rounded px-3 py-2 mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Helping Hands"
          autoComplete="organization"
          disabled={loading}
        />

        <label className="block text-sm font-medium mb-1">
          Contact email <span className="text-red-600">*</span>
        </label>
        <input
          className="w-full border rounded px-3 py-2 mb-3"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="contact@charity.org"
          autoComplete="email"
          disabled={loading}
        />

        <label className="block text-sm font-medium mb-1">
          Registered charity number <span className="text-red-600">*</span>
        </label>
        <input
          className="w-full border rounded px-3 py-2"
          value={charityNumber}
          onChange={(e) => setCharityNumber(e.target.value)}
          placeholder="e.g. 328158 or AA12345"
          autoComplete="off"
          disabled={loading}
        />
        <div className="text-xs text-gray-500 mt-2 mb-4">
          Letters and numbers only — this becomes your HMRC CHARID for Gift Aid submissions.
        </div>

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
