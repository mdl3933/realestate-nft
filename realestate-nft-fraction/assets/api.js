(function () {
  'use strict';

  const API_BASE = 'http://127.0.0.1:3001/api';

  function getToken() {
    return localStorage.getItem('estate_token');
  }

  function setToken(token) {
    if (token) localStorage.setItem('estate_token', token);
    else localStorage.removeItem('estate_token');
  }

  async function request(method, endpoint, body) {
    const url = `${API_BASE}${endpoint}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const token = getToken();
    if (token) options.headers.Authorization = `Bearer ${token}`;
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed: ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const api = {
    get: (endpoint) => request('GET', endpoint),
    post: (endpoint, body) => request('POST', endpoint, body),
    getToken,
    setToken,
  };

  api.auth = {
    register: (username, password) => api.post('/auth/register', { username, password }),
    login: (username, password) => api.post('/auth/login', { username, password }),
    me: () => api.get('/me'),
  };

  api.properties = {
    list: () => api.get('/properties'),
    mint: (payload) => api.post('/properties/mint', payload),
    fractionalize: (payload) => api.post('/properties/fractionalize', payload),
    redeem: (payload) => api.post('/properties/redeem', payload),
  };

  api.orders = {
    list: () => api.get('/orders'),
    create: (payload) => api.post('/orders', payload),
    buy: (orderId, amount) => api.post(`/orders/${orderId}/buy`, { amount }),
  };

  api.dividends = {
    pending: (tokenId) => api.get(`/dividends/pending/${tokenId}`),
    claim: (tokenId) => api.post(`/dividends/claim/${tokenId}`),
  };

  api.balance = {
    get: (tokenId) => api.get(`/balance/${tokenId}`),
  };

  api.admin = {
    depositRent: (payload) => api.post('/admin/deposit-rent', payload),
    faucet: (amount) => api.post('/faucet', { amount }),
  };

  window.estateApi = api;
})();
