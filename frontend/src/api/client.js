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
    const headers = { ...options.headers };

    // Don't set Content-Type if it's FormData (browser handles it)
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(url, { ...options, headers });

    // Handle token refresh... (same as before)
    if (response.status === 401 && this.accessToken) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(url, { ...options, headers });
      } else {
        this.clearTokens();
        window.location.href = '/login';
        return null;
      }
    }

    return response;
  }

  // ... (refresh token stays same)

  async get(endpoint) {
    const res = await this.request(endpoint);
    if (!res) return null;
    if (!res.ok) throw new Error(`GET ${endpoint}: ${res.status}`);
    return res.json();
  }

  async getBlob(endpoint) {
    const res = await this.request(endpoint);
    if (!res) return null;
    if (!res.ok) throw new Error(`GET BLOB ${endpoint}: ${res.status}`);
    return res.blob();
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

  async postMultipart(endpoint, formData) {
    const res = await this.request(endpoint, {
      method: 'POST',
      body: formData, // fetch handles multipart headers automatically for FormData
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

  // ... rest of the file ...

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
