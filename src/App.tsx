import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Admin from "./pages/admin";
import AdminClaims from "./pages/adminClaims";
import AdminClaimDetail from "./pages/adminClaimDetail";
import RequireOperator from "./components/RequireOperator";

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

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
