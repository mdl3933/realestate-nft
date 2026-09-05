(function () {
  'use strict';

  const api = window.estateApi;
  const MODAL_ID = 'estate-auth-modal';

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  function injectStyles() {
    if (document.getElementById('estate-auth-styles')) return;
    const css = `
      .estate-auth-overlay { position: fixed; inset: 0; background: rgba(26,23,20,0.45); z-index: 100; display: flex; align-items: center; justify-content: center; }
      .estate-auth-modal { background: var(--estate-card, #fff); border: 1px solid var(--estate-border, #e8e4df); border-radius: 12px; width: 100%; max-width: 420px; padding: 28px; box-shadow: 0 12px 40px -16px rgba(26,23,20,0.15); }
      .estate-auth-modal h2 { margin: 0 0 20px; font-size: 1.35rem; color: var(--estate-neutral-900, #1a1714); }
      .estate-auth-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
      .estate-auth-tab { flex: 1; padding: 10px; border: 1px solid var(--estate-border, #e8e4df); background: var(--estate-neutral-50, #faf8f5); color: var(--estate-neutral-700, #4f4b47); border-radius: 8px; cursor: pointer; font-weight: 500; }
      .estate-auth-tab.active { background: var(--estate-primary-500, #b8956b); border-color: var(--estate-primary-500, #b8956b); color: #fff; }
      .estate-auth-error { color: var(--estate-state-error, #a93e3e); background: var(--estate-state-error-bg, #ffebee); padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; display: none; }
      .estate-auth-success { color: var(--estate-state-success, #2d6a4f); background: var(--estate-state-success-bg, #e8f5e9); padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; display: none; }
      .estate-auth-field { margin-bottom: 16px; }
      .estate-auth-field label { display: block; font-size: 0.9rem; margin-bottom: 6px; color: var(--estate-neutral-800, #363330); }
      .estate-auth-field input { width: 100%; padding: 10px 12px; border: 1px solid var(--estate-input, #efeae4); border-radius: 8px; background: var(--estate-neutral-0, #fff); color: var(--estate-foreground, #1a1714); }
      .estate-auth-field input:focus { outline: none; border-color: var(--estate-primary-500, #b8956b); box-shadow: 0 0 0 3px rgba(184,149,107,0.15); }
      .estate-auth-submit { width: 100%; padding: 12px; background: var(--estate-primary-500, #b8956b); color: #fff; border: none; border-radius: 8px; font-weight: 500; cursor: pointer; }
      .estate-auth-submit:hover { background: var(--estate-primary-600, #a6835a); }
      .estate-auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }
      .estate-auth-hint { font-size: 0.85rem; color: var(--estate-muted-foreground, #8a837a); margin-top: 16px; }
    `;
    document.head.appendChild(el('style', { id: 'estate-auth-styles', text: css }));
  }

  function createModal() {
    injectStyles();
    if (document.getElementById(MODAL_ID)) return;

    const errorBox = el('div', { class: 'estate-auth-error' });
    const successBox = el('div', { class: 'estate-auth-success' });

    const usernameField = el('div', { class: 'estate-auth-field' }, [
      el('label', { for: 'estate-auth-username', text: '用户名' }),
      el('input', { id: 'estate-auth-username', type: 'text', placeholder: '3-32 位字母数字或下划线', autocomplete: 'username' }),
    ]);
    const passwordField = el('div', { class: 'estate-auth-field' }, [
      el('label', { for: 'estate-auth-password', text: '密码' }),
      el('input', { id: 'estate-auth-password', type: 'password', placeholder: '至少 6 位', autocomplete: 'current-password' }),
    ]);
    const submitBtn = el('button', { class: 'estate-auth-submit', type: 'submit', text: '登录' });

    const form = el('form', {}, [errorBox, successBox, usernameField, passwordField, submitBtn, el('p', { class: 'estate-auth-hint', text: '首次使用请切换到“注册”创建账号与托管钱包。' })]);

    const loginTab = el('button', { class: 'estate-auth-tab active', type: 'button', text: '登录' });
    const registerTab = el('button', { class: 'estate-auth-tab', type: 'button', text: '注册' });
    const tabs = el('div', { class: 'estate-auth-tabs' }, [loginTab, registerTab]);

    const modal = el('div', { class: 'estate-auth-modal' }, [el('h2', { text: '欢迎回到 ESTATE' }), tabs, form]);
    const overlay = el('div', { id: MODAL_ID, class: 'estate-auth-overlay' }, [modal]);

    let mode = 'login';
    function setMode(m) {
      mode = m;
      loginTab.classList.toggle('active', m === 'login');
      registerTab.classList.toggle('active', m === 'register');
      submitBtn.textContent = m === 'login' ? '登录' : '注册';
      errorBox.style.display = 'none';
      successBox.style.display = 'none';
    }
    loginTab.addEventListener('click', () => setMode('login'));
    registerTab.addEventListener('click', () => setMode('register'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('estate-auth-username').value.trim();
      const password = document.getElementById('estate-auth-password').value;
      errorBox.style.display = 'none';
      successBox.style.display = 'none';
      submitBtn.disabled = true;
      try {
        const res = mode === 'login' ? await api.auth.login(username, password) : await api.auth.register(username, password);
        api.setToken(res.token);
        successBox.textContent = mode === 'login' ? '登录成功' : '注册成功，正在进入…';
        successBox.style.display = 'block';
        await finishAuth();
        hideModal();
      } catch (err) {
        errorBox.textContent = err.message || '请求失败';
        errorBox.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
    });

    document.body.appendChild(overlay);
  }

  function showModal() {
    createModal();
    document.getElementById(MODAL_ID).style.display = 'flex';
  }

  function hideModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.style.display = 'none';
  }

  let currentUser = null;

  async function finishAuth() {
    try {
      currentUser = await api.auth.me();
      updateNavbar();
      document.dispatchEvent(new CustomEvent('estate:auth', { detail: currentUser }));
      return currentUser;
    } catch (err) {
      api.setToken(null);
      showModal();
      throw err;
    }
  }

  function updateNavbar() {
    const btn = document.getElementById('wallet-btn');
    if (!btn) return;
    if (currentUser) {
      const label = btn.querySelector('span') || btn;
      label.textContent = currentUser.username;
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-neutral');
      btn.onclick = () => {
        if (confirm('退出登录？')) {
          api.setToken(null);
          currentUser = null;
          updateNavbar();
          showModal();
        }
      };
    } else {
      const label = btn.querySelector('span') || btn;
      label.textContent = '登录 / 注册';
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-neutral');
      btn.onclick = showModal;
    }
  }

  async function init() {
    const token = api.getToken();
    if (token) {
      try {
        await finishAuth();
        return;
      } catch (e) {
        console.warn('Auth check failed:', e.message);
      }
    }
    updateNavbar();
    showModal();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    const featureWallet = document.getElementById('feature-wallet');
    if (featureWallet) {
      featureWallet.textContent = '登录 / 注册';
      featureWallet.classList.remove('btn-primary');
      featureWallet.classList.add('btn-outline');
      featureWallet.addEventListener('click', showModal);
    }
  });

  window.estateAuth = { init, showModal, hideModal, getUser: () => currentUser };
})();
