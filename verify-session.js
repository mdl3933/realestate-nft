const BASE = 'http://127.0.0.1:3001';
const fs = require('fs');
const path = require('path');

async function request(pathStr, opts = {}) {
  const res = await fetch(BASE + pathStr, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return data;
}

(async () => {
  const tokenFile = path.join(__dirname, '.session-token.json');
  let token;
  if (fs.existsSync(tokenFile)) {
    const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    token = saved.token;
    console.log('使用已保存 token:', token.slice(0, 16) + '...');
  } else {
    const username = 'sessionUser_' + Date.now();
    const r = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'Pass1234!' })
    });
    token = r.token;
    fs.writeFileSync(tokenFile, JSON.stringify({ username, token }, null, 2), 'utf8');
    console.log('注册新用户，保存 token:', token.slice(0, 16) + '...');
  }

  const me = await request('/api/me', { headers: { Authorization: 'Bearer ' + token } });
  console.log('重启后会话恢复成功:', me.username, me.address);
})();
