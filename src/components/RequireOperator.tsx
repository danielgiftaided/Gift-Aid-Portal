import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type MeResponse =
  | { ok: true; role: "operator" | "charity_user"; charityId: string | null }
  | { ok: false; error: string };

export default function RequireOperator({ children }: { children: JSX.Element }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // 1) Must be logged in
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          setRedirectTo("/login");
          return;
        }

        // 2) Ask backend for role
        const res = await fetch("/api/user/me", {
          headers: { Authorization: `Bearer ${token}` },
        });

        const json: MeResponse = await res.json();

        if (!res.ok || !json.ok) {
          setRedirectTo("/login");
          return;
        }

        // 3) Allow only operator
        if (json.role === "operator") {
          setAllowed(true);
        } else {
          setRedirectTo("/dashboard");
        }
      } catch {
        setRedirectTo("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // While checking, show a simple loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  // If not allowed, redirect
  if (!allowed) {
    return <Navigate to={redirectTo ?? "/dashboard"} replace />;
  }

  // If allowed, render the admin page
  return children;
}
