import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import Admin from "./pages/admin";
import AdminClaims from "./pages/adminClaims";
import AdminClaimDetail from "./pages/adminClaimDetail";

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Charity portal */}
      <Route path="/dashboard" element={<Dashboard />} />

      {/* Operator/Admin portal */}
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin/claims" element={<AdminClaims />} />
      <Route path="/admin/claims/:id" element={<AdminClaimDetail />} />

      {/* Default */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
