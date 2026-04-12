const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.accessToken = localStorage.getItem('access_token');
  }

  setTokens(access, refresh) {
    this.accessToken = access;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
  }

  clearTokens() {
    this.accessToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401 && this.accessToken) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(url, { ...options, headers });
      } else {
        this.clearTokens();
        window.location.href = '/admin/login';
        return null;
      }
    }

    return response;
  }

  async refreshToken() {
    const refresh = localStorage.getItem('refresh_token');
    if (!refresh) return false;

    try {
      const res = await fetch(`${API_BASE}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      this.accessToken = data.access;
      localStorage.setItem('access_token', data.access);
      return true;
    } catch {
      return false;
    }
  }

  async get(endpoint) {
    const res = await this.request(endpoint);
    if (!res) return null;
    if (!res.ok) throw new Error(`GET ${endpoint}: ${res.status}`);
    return res.json();
  }

  async post(endpoint, data) {
    const res = await this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw { status: res.status, data: err };
    }
    return res.json();
  }

  async patch(endpoint, data) {
    const res = await this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw { status: res.status, data: err };
    }
    return res.json();
  }

  async put(endpoint, data) {
    const res = await this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!res) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw { status: res.status, data: err };
    }
    return res.json();
  }

  async del(endpoint) {
    const res = await this.request(endpoint, { method: 'DELETE' });
    if (!res) return null;
    if (!res.ok) throw new Error(`DELETE ${endpoint}: ${res.status}`);
    return true;
  }

  async login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw { status: res.status, data: err };
    }

    const data = await res.json();
    this.setTokens(data.access, data.refresh);
    return data.user;
  }

  logout() {
    this.clearTokens();
  }
}

const api = new ApiClient();
export default api;
