import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/login";
import Signup from "./pages/signup"; // ✅ NEW
import Dashboard from "./pages/dashboard";
import CharitySetup from "./pages/charitySetup";
import Admin from "./pages/admin";
import AdminClaims from "./pages/adminClaims";
import AdminClaimDetail from "./pages/adminClaimDetail";
import AdminCharityDetail from "./pages/adminCharityDetail";
import RequireOperator from "./components/RequireOperator";

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      {/* Self-signup charity setup */}
      <Route path="/charity-setup" element={<CharitySetup />} />

      {/* Charity portal */}
      <Route path="/dashboard" element={<Dashboard />} />

      {/* Operator/Admin portal (guarded) */}
      <Route
        path="/admin"
        element={
          <RequireOperator>
            <Admin />
          </RequireOperator>
        }
      />

      <Route
        path="/admin/charities/:id"
        element={
          <RequireOperator>
            <AdminCharityDetail />
          </RequireOperator>
        }
      />

      <Route
        path="/admin/claims"
        element={
          <RequireOperator>
            <AdminClaims />
          </RequireOperator>
        }
      />

      <Route
        path="/admin/claims/:id"
        element={
          <RequireOperator>
            <AdminClaimDetail />
          </RequireOperator>
        }
      />

      {/* Default */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
