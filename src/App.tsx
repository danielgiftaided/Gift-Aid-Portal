import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/login'
import Signup from './pages/signup'
import Dashboard from './pages/dashboard'
import Submissions from './pages/submissions'
import Admin from './pages/admin'
import CharitySetup from './pages/charitySetup'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/submissions" element={<Submissions />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/charitySetup" element={<CharitySetup />} />
      <Route path="/" element={<Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
}

export default App
