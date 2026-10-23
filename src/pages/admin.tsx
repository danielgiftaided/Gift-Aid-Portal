import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

type Charity = {
  id: string;
  name: string;
  contact_email: string;
};



export default function Admin() {
  const [charities, setCharities] = useState<Charity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [charityName, setCharityName] = useState("");
  const [regulator, setRegulator] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");

  const [creating, setCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);


  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          throw new Error("Not logged in.");
        }

        const res = await fetch(
          "/api/admin/charities/list?limit=100&offset=0",
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const json = await res.json();

        if (!res.ok || !json.ok) {
          throw new Error(json?.error || "Failed to load");
        }

        setCharities(json.charities || []);
      } catch (e: any) {
        setError(e?.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreateCharity = async (e: React.FormEvent) => {
    e.preventDefault();

    setCreating(true);
    setCreateError(null);
    setCreateSuccess(false);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Not logged in");
      }

      const res = await fetch("/api/admin/charities/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: charityName,
          regulator: regulator || undefined,
          registration_number: registrationNumber || undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(
          json?.error || "Failed to create charity workspace",
        );
      }

      if (json.charity) {
        setCharities((current) => [json.charity, ...current]);
      }

      setCreateSuccess(true);
      setCharityName("");
      setRegulator("");
      setRegistrationNumber("");

      setTimeout(() => setCreateSuccess(false), 5000);
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">

      <div className="relative" style={{ zIndex: 10 }}>

        <div className="max-w-4xl mx-auto px-6 pt-12 pb-4">
          <h1 className="text-3xl font-bold text-brand-primary">
            Admin Dashboard
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage charities and Gift Aid submissions
          </p>
        </div>

        <div className="max-w-4xl mx-auto px-6 pb-12">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {/* Create the workspace first; its UUID owns data and invitations. */}
          <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6 mb-6">
            <h2 className="font-semibold text-brand-primary mb-1">
              Add a charity
            </h2>

            <p className="text-xs text-gray-400 mb-4">
              Create a workspace, then invite its contact from the workspace’s Onboarding tab. HMRC and
              authorised-official details are completed by the charity later.
            </p>

            <form
              onSubmit={handleCreateCharity}
              className="space-y-3"
            >
              <label htmlFor="admin-charity-name" className="block text-sm font-medium text-brand-primary">Charity name</label>
              <input
                id="admin-charity-name"
                type="text"
                required
                placeholder="Charity name"
                value={charityName}
                onChange={(e) => setCharityName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-brand-primary">Regulator (optional)
                <select
                  value={regulator}
                  onChange={(e) => setRegulator(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"
                >
                  <option value="">Regulator (optional)</option>
                  <option value="CCEW">
                    Charity Commission (England &amp; Wales)
                  </option>
                  <option value="OSCR">OSCR (Scotland)</option>
                  <option value="CCNI">
                    CCNI (Northern Ireland)
                  </option>
                </select>
                </label>

                <label className="block text-sm font-medium text-brand-primary">Registration number (optional)
                <input
                  type="text"
                  placeholder="Registration number (optional)"
                  value={registrationNumber}
                  onChange={(e) =>
                    setRegistrationNumber(e.target.value)
                  }
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"
                />
                </label>
              </div>

              <div className="flex gap-3 items-start">
                <button
                  type="submit"
                  disabled={
                    creating ||
                    !charityName ||
                    Boolean(regulator) !== Boolean(registrationNumber)
                  }
                  className="bg-brand-accent text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  {creating ? "Creating…" : "Save workspace"}
                </button>
              </div>
            </form>

            {createSuccess && (
              <p className="text-sm text-green-600 mt-3">
                ✓ Workspace created successfully
              </p>
            )}

            {createError && (
              <p className="text-sm text-red-500 mt-3">
                {createError}
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-brand-primary">
                Charities
              </h2>

              <span className="text-xs text-gray-400">
                {loading ? "Loading…" : `${charities.length} total`}
              </span>
            </div>

            {loading ? (
              <div className="px-6 py-10 text-center text-gray-300">
                Loading charities…
              </div>
            ) : charities.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-300">
                No charities found.
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {charities.map((charity) => (
                  <li key={charity.id}>
                    <div className="px-6 py-4 flex items-center justify-between hover:bg-brand-surface/40 transition-colors">
                      <div>
                        <div className="font-semibold text-brand-primary">
                          {charity.name}
                        </div>
                      </div>

                      <Link
                        to={`/admin/charities/${charity.id}`}
                        className="px-4 py-1.5 text-sm font-semibold rounded-lg border border-brand-primary/20 text-brand-primary hover:bg-brand-primary hover:text-white transition-colors"
                      >
                        View
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
