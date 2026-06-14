import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/login'
import Signup from './pages/signup'
import ForgotPassword from './pages/forgotPassword'
import ResetPassword from './pages/resetPassword'
import Dashboard from './pages/dashboard'
import Submissions from './pages/submissions'
import SubmissionDetail from './pages/submissionDetail'
import Insights from './pages/insights'
import Admin from './pages/admin'
import CharitySetup from './pages/charitySetup'
import AdminCharityDetail from './pages/adminCharityDetail'
import CharityProfile from './pages/charityProfile'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/submissions" element={<Submissions />} />
      <Route path="/submissions/:id" element={<SubmissionDetail />} />
      <Route path="/insights" element={<Insights />} />
      <Route path="/profile" element={<CharityProfile />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin/charities/:id" element={<AdminCharityDetail />} />
      <Route path="/charity-setup" element={<CharitySetup />} />
      <Route path="/" element={<Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
}

export default App
