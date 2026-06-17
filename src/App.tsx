import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/login'
import Signup from './pages/signup'
import ForgotPassword from './pages/forgotPassword'
import ResetPassword from './pages/resetPassword'
import AcceptInvite from './pages/acceptInvite'
import MfaSetup from './pages/mfaSetup'
import MfaChallenge from './pages/mfaChallenge'
import PasswordExpired from './pages/passwordExpired'
import Dashboard from './pages/dashboard'
import Submissions from './pages/submissions'
import SubmissionDetail from './pages/submissionDetail'
import Insights from './pages/insights'
import CharityProfile from './pages/charityProfile'
import CharitySetup from './pages/charitySetup'
import Admin from './pages/admin'
import AdminCharityDetail from './pages/adminCharityDetail'
import AdminCharityInsights from './pages/adminCharityInsights'
import PendingCharities from './pages/pendingCharities'
import PendingCharityInsights from './pages/pendingCharityInsights'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/mfa-setup" element={<MfaSetup />} />
      <Route path="/mfa-challenge" element={<MfaChallenge />} />
      <Route path="/password-expired" element={<PasswordExpired />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/submissions" element={<Submissions />} />
      <Route path="/submissions/:id" element={<SubmissionDetail />} />
      <Route path="/insights" element={<Insights />} />
      <Route path="/profile" element={<CharityProfile />} />
      <Route path="/charity-setup" element={<CharitySetup />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin/charities/:id" element={<AdminCharityDetail />} />
      <Route path="/admin/charities/:id/insights" element={<AdminCharityInsights />} />
      <Route path="/admin/pending-charities" element={<PendingCharities />} />
      <Route path="/admin/pending-charities/:email/insights" element={<PendingCharityInsights />} />
      <Route path="/" element={<Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
}

export default App
