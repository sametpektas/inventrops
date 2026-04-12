import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      api.get('/auth/me/')
        .then(userData => {
          if (userData?.role === 'admin') {
            setUser(userData);
          } else {
            api.clearTokens();
          }
          setLoading(false);
        })
        .catch(() => {
          api.clearTokens();
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const userData = await api.login(username, password);
    if (userData.role !== 'admin') {
      api.clearTokens();
      throw { data: { detail: 'Admin access required.' } };
    }
    setUser(userData);
    return userData;
  };

  const logout = () => {
    api.logout();
    setUser(null);
    navigate('/admin/login', { replace: true });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
