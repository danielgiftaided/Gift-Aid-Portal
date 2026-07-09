import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/login'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  )
}
