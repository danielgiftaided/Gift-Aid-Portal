import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function CharitySetup() {
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [charityNumber, setCharityNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) window.location.href = "/login";
      else setContactEmail(user.email ?? "");
    })();
  }, []);

  const submit = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!name.trim()) throw new Error("Charity name is required");
      if (!contactEmail.trim()) throw new Error("Contact email is required");

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
          charity_number: charityNumber.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to setup charity");

      window.location.href = "/dashboard";
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Set up your charity</h1>
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
        className="w-full border rounded px-3 py-2 mb-3"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Helping Hands"
      />

      <label className="block text-sm font-medium mb-1">Contact email</label>
      <input
        className="w-full border rounded px-3 py-2 mb-3"
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
        placeholder="contact@charity.org"
      />

      <label className="block text-sm font-medium mb-1">
        Charity number (optional)
      </label>
      <input
        className="w-full border rounded px-3 py-2 mb-4"
        value={charityNumber}
        onChange={(e) => setCharityNumber(e.target.value)}
        placeholder="e.g. 123456"
      />

      <button
        onClick={submit}
        disabled={loading}
        className="w-full px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Creating…" : "Create charity"}
      </button>
    </div>
  );
}
