import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function CharitySetup() {
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [hmrcRef, setHmrcRef] = useState("");
  const [charityCommissionNumber, setCharityCommissionNumber] = useState("");
  const [authorisedOfficialName, setAuthorisedOfficialName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) setContactEmail(session.user.email);
    });
  }, []);

  const submit = async () => {
    try {
      setLoading(true);
      setError(null);

      const cleanName = name.trim();
      const cleanEmail = contactEmail.trim();
      const cleanHmrcRef = hmrcRef.trim().toUpperCase();
      const cleanCommissionNumber = charityCommissionNumber.trim();
      const cleanOfficialName = authorisedOfficialName.trim();

      if (!cleanName) throw new Error("Charity name is required");
      if (!cleanEmail) throw new Error("Contact email is required");
      if (!cleanHmrcRef) throw new Error("HMRC Charities Ref is required");
      if (!cleanCommissionNumber) throw new Error("Charity Commission Number is required");
      if (!cleanOfficialName) throw new Error("Authorised Official's name is required");

      if (!/^[A-Z]{1,2}[0-9]{1,5}$/.test(cleanHmrcRef)) {
        throw new Error('HMRC Charities Ref must be 1-2 letters followed by 1-5 numbers (e.g. "AB12345") — this is your HMRC Gift Aid reference, not your Charity Commission number.');
      }
      if (/\/(0|1|2)$/.test(cleanHmrcRef)) {
        throw new Error("HMRC Charities Ref cannot end in /0, /1 or /2 — HMRC no longer accepts these sub-fund suffixes.");
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { navigate("/login"); return; }

      const res = await fetch("/api/charity/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: cleanName,
          contact_email: cleanEmail,
          hmrc_ref: cleanHmrcRef,
          charity_commission_number: cleanCommissionNumber,
          authorised_official_name: cleanOfficialName,
        }),
      });

      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch {
        throw new Error(`Server returned unexpected response (HTTP ${res.status}): ${text.substring(0, 200)}`);
      }
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to set up charity");
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
        <p className="text-gray-600 mb-4">Enter your charity details to create your portal workspace.</p>

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
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Helping Hands" autoComplete="organization" disabled={loading}
        />

        <label className="block text-sm font-medium mb-1">
          Contact email <span className="text-red-600">*</span>
        </label>
        <input
          className="w-full border rounded px-3 py-2 mb-3"
          value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
          placeholder="contact@charity.org" autoComplete="email" disabled={loading}
        />

        <label className="block text-sm font-medium mb-1">
          HMRC Charities Ref <span className="text-red-600">*</span>
        </label>
        <input
          className="w-full border rounded px-3 py-2"
          value={hmrcRef} onChange={(e) => setHmrcRef(e.target.value)}
          placeholder="e.g. AB12345" autoComplete="off" disabled={loading}
        />
        <div className="text-xs text-gray-500 mt-1.5 mb-4">
          1-2 letters followed by 1-5 numbers, issued by HMRC specifically for Gift Aid claims. Different from your Charity Commission number.
        </div>

        <label className="block text-sm font-medium mb-1">
          Charity Commission Number <span className="text-red-600">*</span>
        </label>
        <input
          className="w-full border rounded px-3 py-2"
          value={charityCommissionNumber} onChange={(e) => setCharityCommissionNumber(e.target.value)}
          placeholder="e.g. 1234567" autoComplete="off" disabled={loading}
        />
        <div className="text-xs text-gray-500 mt-1.5 mb-4">
          Your registration number with the Charity Commission for England &amp; Wales (CCEW), OSCR, or CCNI. Different from your HMRC Charities Ref above.
        </div>

        <label className="block text-sm font-medium mb-1">
          Authorised Official's full name <span className="text-red-600">*</span>
        </label>
        <input
          className="w-full border rounded px-3 py-2"
          value={authorisedOfficialName} onChange={(e) => setAuthorisedOfficialName(e.target.value)}
          placeholder="e.g. Jane Smith" autoComplete="off" disabled={loading}
        />
        <div className="text-xs text-gray-500 mt-1.5 mb-5">
          The person HMRC recognises as authorised to act for this charity. You can update this later from your profile if it changes.
        </div>

        <button
          onClick={submit} disabled={loading}
          className="w-full bg-brand-accent text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create charity"}
        </button>
      </div>
    </div>
  );
}
