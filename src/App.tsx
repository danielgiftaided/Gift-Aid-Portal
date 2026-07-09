import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/login'
import Signup from './pages/signup'
import ForgotPassword from './pages/forgotPassword'
import ResetPassword from './pages/resetPassword'
import AcceptInvite from './pages/acceptInvite'
import MfaSetup from './pages/mfaSetup'
import MfaChallenge from './pages/mfaChallenge'
import PasswordExpired from './pages/passwordExpired'
import Dashboard from './pages/dashboard'
import SubmissionDetail from './pages/submissionDetail'
import Insights from './pages/insights'
import CharityProfile from './pages/charityProfile'
import CharitySetup from './pages/charitySetup'
import Admin from './pages/admin'
import AdminCharityDetail from './pages/adminCharityDetail'
import AdminCharityInsights from './pages/adminCharityInsights'
import PendingCharities from './pages/pendingCharities'
import PendingCharityInsights from './pages/pendingCharityInsights'
import ActivityLog from './pages/activityLog'
import AdminInsights from './pages/adminInsights'
import AdminDonorMatching from './pages/adminDonorMatching'
import RecognitionPackage from './pages/recognitionPackage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth */}
        <Route path="/login"            element={<Login />} />
        <Route path="/signup"           element={<Signup />} />
        <Route path="/forgot-password"  element={<ForgotPassword />} />
        <Route path="/reset-password"   element={<ResetPassword />} />
        <Route path="/accept-invite"    element={<AcceptInvite />} />
        <Route path="/mfa-setup"        element={<MfaSetup />} />
        <Route path="/mfa-challenge"    element={<MfaChallenge />} />
        <Route path="/password-expired" element={<PasswordExpired />} />

        {/* Charity-facing */}
        <Route path="/dashboard"        element={<Dashboard />} />
        <Route path="/submissions/:id"  element={<SubmissionDetail />} />
        <Route path="/insights"         element={<Insights />} />
        <Route path="/profile"          element={<CharityProfile />} />
        <Route path="/charity-setup"    element={<CharitySetup />} />

        {/* Admin */}
        <Route path="/admin"                                    element={<Admin />} />
        <Route path="/admin/charities/:id"                      element={<AdminCharityDetail />} />
        <Route path="/admin/charities/:id/insights"             element={<AdminCharityInsights />} />
        <Route path="/admin/pending-charities"                  element={<PendingCharities />} />
        <Route path="/admin/pending-charities/:email/insights"  element={<PendingCharityInsights />} />
        <Route path="/admin/activity-log"                       element={<ActivityLog />} />
        <Route path="/admin/insights"                           element={<AdminInsights />} />
        <Route path="/admin/donor-matching"                     element={<AdminDonorMatching />} />
        <Route path="/admin/recognition-package"                element={<RecognitionPackage />} />
      </Routes>
    </BrowserRouter>
  )
}
