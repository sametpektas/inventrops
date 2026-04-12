import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AdminLayout from './components/AdminLayout';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import ProtectedRoute from './components/ProtectedRoute';
import Users from './pages/Users';
import Teams from './pages/Teams';
import Vendors from './pages/Vendors';
import Infrastructure from './pages/Infrastructure';
import Integrations from './pages/Integrations';
import LdapConfig from './pages/LdapConfig';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/admin/login" element={<AdminLogin />} />
          
          <Route element={<ProtectedRoute />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/ldap" element={<LdapConfig />} />
              <Route path="/admin/users" element={<Users />} />
              <Route path="/admin/teams" element={<Teams />} />
              <Route path="/admin/vendors" element={<Vendors />} />
              <Route path="/admin/infrastructure" element={<Infrastructure />} />
              <Route path="/admin/integrations" element={<Integrations />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
