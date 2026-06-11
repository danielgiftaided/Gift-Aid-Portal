import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/login'
import Signup from './pages/signup'
import Dashboard from './pages/dashboard'
import Submissions from './pages/submissions'
import SubmissionDetail from './pages/submissionDetail'
import Admin from './pages/admin'
import CharitySetup from './pages/charitySetup'
import AdminCharityDetail from './pages/adminCharityDetail'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/submissions" element={<Submissions />} />
      <Route path="/submissions/:id" element={<SubmissionDetail />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin/charities/:id" element={<AdminCharityDetail />} />
      <Route path="/charity-setup" element={<CharitySetup />} />
      <Route path="/" element={<Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
}

export default App
