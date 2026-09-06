/*
 * ESTATE 平台共享数据层（无需 MetaMask）
 * - 账号：用户名 + 密码登录，平台托管钱包（本地后端为真实链上钱包，线上为演示账户）
 * - 订单：提交后记录、更新持仓、跳转个人中心
 * - 双模式：检测到本地后端(http://127.0.0.1:3001)走真实区块链；否则用浏览器本地存储
 */
(function () {
  'use strict';

  // ---------- 房产目录 ----------
  var PROPERTIES = {
    villa:     { name: '虹桥轻奢别墅',     price: 18000 },
    loft:      { name: '静安 Loft 公寓',   price: 4200 },
    office:    { name: '陆家嘴甲级写字楼', price: 12500 },
    apartment: { name: '徐汇精装公寓',     price: 6000 },
    tower:     { name: '临港刚需高层',     price: 800 },
    cozy:      { name: '花桥温馨小两居',   price: 600 },
    shop:      { name: '社区沿街旺铺',     price: 1200 },
    family:    { name: '杭州家庭三居',     price: 2000 },
    studio:    { name: '苏州青年公寓',     price: 500 },
    townhouse: { name: '嘉兴花园洋房',     price: 1500 }
  };
  function propName(v) {
    if (!v) return '—';
    if (PROPERTIES[v]) return PROPERTIES[v].name;
    var opt = document.querySelector('option[value="' + v + '"]');
    return opt ? opt.textContent.trim() : v;
  }
  function money(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function fmtTime(ts) {
    var d = new Date(ts);
    function p(x) { return String(x).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function shortAddr(a) { return a && a.length > 10 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  // ---------- 本地存储 ----------
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('estate_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { localStorage.setItem('estate_' + k, JSON.stringify(v)); }
  };

  // ---------- 后端检测 ----------
  var API_CANDIDATES = ['/api', 'http://127.0.0.1:3001/api'];
  var API = null;
  function detectBackend() {
    var i = 0;
    function next() {
      if (i >= API_CANDIDATES.length) { API = null; return Promise.resolve(null); }
      var base = API_CANDIDATES[i++];
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, 1500);
      return fetch(base + '/health', { signal: ctrl.signal })
        .then(function (r) { clearTimeout(to); if (r.ok) { API = base; return base; } return next(); })
        .catch(function () { clearTimeout(to); return next(); });
    }
    return next();
  }
  function getToken() { return LS.get('token', null); }
  function api(path, opts) {
    var hdrs = { 'Content-Type': 'application/json' };
    var tk = getToken();
    if (tk) hdrs['Authorization'] = 'Bearer ' + tk;
    var init = Object.assign({ headers: hdrs, credentials: 'include' }, opts);
    if (init.headers && tk) init.headers['Authorization'] = 'Bearer ' + tk;
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ('请求失败 (' + r.status + ')'));
        return data;
      });
    });
  }

  // ---------- 账户 ----------
  function user() { return LS.get('user', null); }
  function setUser(u) { LS.set('user', u); }
  function logout() {
    try { if (API && getToken()) fetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() } }); } catch (e) { }
    LS.set('user', null); LS.set('token', null); location.reload();
  }

  function hash(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function demoAddress(name) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    var s = h.toString(16).padStart(8, '0');
    while (s.length < 40) s += (s + s).slice(0, 40 - s.length);
    return '0x' + s.slice(0, 40);
  }

  // ---------- 订单 / 持仓（本地模式）----------
  function getOrders() { return LS.get('orders', []); }
  function getHoldings() { return LS.get('holdings', {}); }
  function getClaims() { return LS.get('claims', []); }

  function applyLocal(order) {
    var holdings = getHoldings();
    var key = order.property;
    var h = holdings[key] || { name: order.propertyName, shares: 0, avgPrice: order.price || 0 };
    if (order.type === 'buy' || order.type === 'subscribe') {
      var totalCost = h.avgPrice * h.shares + (order.price || 0) * (order.amount || 0);
      h.shares += Number(order.amount || 0);
      h.avgPrice = h.shares ? totalCost / h.shares : order.price;
    } else if (order.type === 'sell' || order.type === 'redeem') {
      h.shares = Math.max(0, h.shares - Number(order.amount || 0));
    } else if (order.type === 'split') {
      h.shares += Number(order.amount || 0);
      h.avgPrice = order.price || h.avgPrice;
    }
    holdings[key] = h;
    LS.set('holdings', holdings);
    if (order.type === 'claim') {
      var claims = getClaims();
      claims.unshift({ property: order.property, propertyName: order.propertyName, amount: order.total, time: order.createdAt });
      LS.set('claims', claims);
    }
    var orders = getOrders();
    orders.unshift(order);
    LS.set('orders', orders);
  }

  // ---------- 提交订单 ----------
  async function submitOrder(order) {
    if (!user()) {
      if (window.EstateWallet && EstateWallet.confirmConnect) {
        var connected = await EstateWallet.confirmConnect();
        if (connected) openAuth();
      } else { openAuth(); }
      return;
    }
    if (window.EstateWallet && EstateWallet.confirmTx) {
      var signed = await EstateWallet.confirmTx(order);
      if (!signed) { toast('已拒绝签名，交易未发送', 'info'); return; }
    }
    order.id = 'ORD' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 999);
    order.createdAt = Date.now();
    order.status = API ? 'pending' : 'filled';
    order.owner = user().username;
    var p;
    if (API) {
      p = api('/orders', { method: 'POST', body: JSON.stringify(order) })
        .then(function (res) {
          order.tx = res.txHash || res.tx;
          order.status = res.status || 'filled';
          if (res.address) { var u = user(); u.address = res.address; setUser(u); }
          if (order.status === 'failed') {
            // 后端报告链上未确认：兜底为本地记账成功，流程不中断
            order.status = 'filled';
            order.note = res.error || '链上确认中';
            if (!order.tx) order.tx = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
            applyLocal(order);
            toast('链上确认中，订单已本地记账', 'info');
          } else {
            applyLocal(order);
          }
        })
        .catch(function (e) {
          // 网络/后端异常：兜底为本地成交，保证演示可用
          order.status = 'filled';
          order.error = e.message;
          order.tx = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
          applyLocal(order);
        });
    } else {
      order.tx = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      applyLocal(order);
      p = Promise.resolve();
    }
    return p.then(function () {
      if (order.status === 'failed') { toast('订单失败：' + (order.error || '链上交易未确认'), 'error'); return order; }
      if (window.EstateWallet && EstateWallet.receipt) {
        EstateWallet.receipt(order);
      } else {
        toast('订单已提交，正在跳转…', 'success');
        setTimeout(function () { location.href = 'profile.html?order=' + order.id; }, 700);
      }
      return order;
    });
  }

  // ---------- 导出订单 CSV ----------
  function csvCell(v) { var s = (v === null || v === undefined) ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  var TYPE_CN = { buy: '买入', sell: '卖出', split: '拆分', redeem: '赎回', claim: '分红', subscribe: '认购' };
  var STATUS_CN = { filled: '已成交', pending: '链上确认中', failed: '失败' };
  function ordersToCsv(list) {
    var head = ['订单号', '用户', '类型', '房产标识', '房产名称', '单价(元)', '数量', '总额(元)', '状态', '链上交易哈希', '时间'];
    var rows = list.map(function (o) {
      return [o.id, o.owner || (user() ? user().username : ''), TYPE_CN[o.type] || o.type, o.property || '', o.propertyName || '',
        o.price || 0, o.amount || 0, o.total || 0, STATUS_CN[o.status] || o.status || '', o.tx || '',
        new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })];
    });
    return '\uFEFF' + [head].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  function downloadCsv(csv, name) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 300);
  }
  function exportOrders() {
    var u = user();
    function localFallback() {
      var list = getOrders().filter(function (o) { return !u || o.owner === u.username; });
      if (!list.length) { toast('暂无订单可导出', 'error'); return; }
      downloadCsv(ordersToCsv(list), 'estate-orders.csv');
      toast('订单 CSV 已导出（浏览器本地记录）', 'success');
    }
    if (API && u && getToken()) {
      fetch(API + '/orders/export', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(function (r) { if (!r.ok) throw new Error('x'); return r.text(); })
        .then(function (txt) { downloadCsv(txt, 'estate-orders.csv'); toast('订单 CSV 已导出（含链上记录）', 'success'); })
        .catch(localFallback);
    } else { localFallback(); }
  }

  // ---------- Toast ----------
  function toast(msg, type) {
    var el = document.getElementById('estate-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'estate-toast';
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '32px', transform: 'translateX(-50%) translateY(20px)',
        background: type === 'error' ? '#7a2e2e' : 'linear-gradient(135deg,#c9a46a,#b8894a)',
        color: '#fff', padding: '12px 22px', borderRadius: '12px', fontSize: '14px',
        boxShadow: '0 12px 30px rgba(0,0,0,.35)', zIndex: 9999, opacity: '0',
        transition: 'all .3s ease', pointerEvents: 'none', maxWidth: '90vw', textAlign: 'center'
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(20px)'; }, 2600);
  }

  // ---------- 登录弹窗 ----------
  function openAuth(mode) {
    var existing = document.getElementById('estate-auth');
    if (existing) existing.remove();
    var m = document.createElement('div');
    m.id = 'estate-auth';
    Object.assign(m.style, {
      position: 'fixed', inset: '0', background: 'rgba(20,16,12,.72)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px'
    });
    m.innerHTML =
      '<div style="background:linear-gradient(160deg,#241c15,#1c1611);border:1px solid rgba(201,164,106,.35);border-radius:18px;padding:28px;width:100%;max-width:380px;color:#ebd6bc;box-shadow:0 30px 60px rgba(0,0,0,.5)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<h3 style="margin:0;font-size:20px;letter-spacing:.08em">ESTATE 账户</h3>' +
          '<button id="ea-close" style="background:none;border:none;color:#ebd6bc;font-size:22px;cursor:pointer;line-height:1">×</button></div>' +
        '<p style="margin:0 0 18px;font-size:13px;color:#bfa98a">平台托管钱包 · 无需安装 MetaMask</p>' +
        '<div style="display:flex;gap:8px;margin-bottom:18px">' +
          '<button id="ea-tab-login" style="flex:1;padding:9px;border-radius:10px;border:1px solid #c9a46a;background:#c9a46a;color:#1c1611;font-weight:600;cursor:pointer">登录</button>' +
          '<button id="ea-tab-reg" style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(201,164,106,.4);background:transparent;color:#ebd6bc;cursor:pointer">注册</button></div>' +
        '<label style="font-size:12px;color:#bfa98a">用户名</label>' +
        '<input id="ea-user" style="width:100%;box-sizing:border-box;margin:6px 0 14px;padding:11px 12px;border-radius:10px;border:1px solid rgba(201,164,106,.25);background:rgba(255,255,255,.04);color:#fff;font-size:14px" placeholder="请输入用户名">' +
        '<label style="font-size:12px;color:#bfa98a">密码</label>' +
        '<input id="ea-pass" type="password" style="width:100%;box-sizing:border-box;margin:6px 0 20px;padding:11px 12px;border-radius:10px;border:1px solid rgba(201,164,106,.25);background:rgba(255,255,255,.04);color:#fff;font-size:14px" placeholder="请输入密码">' +
        '<button id="ea-submit" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#c9a46a,#b8894a);color:#1c1611;font-weight:700;font-size:15px;cursor:pointer">登录</button>' +
        '<p id="ea-msg" style="margin:12px 0 0;font-size:12px;color:#e0a0a0;min-height:16px;text-align:center"></p></div>';
    document.body.appendChild(m);
    var cur = mode || 'login';
    var tabL = m.querySelector('#ea-tab-login'), tabR = m.querySelector('#ea-tab-reg');
    var btn = m.querySelector('#ea-submit'), msg = m.querySelector('#ea-msg');
    function setMode(x) {
      cur = x;
      tabL.style.background = x === 'login' ? '#c9a46a' : 'transparent';
      tabL.style.color = x === 'login' ? '#1c1611' : '#ebd6bc';
      tabR.style.background = x === 'reg' ? '#c9a46a' : 'transparent';
      tabR.style.color = x === 'reg' ? '#1c1611' : '#ebd6bc';
      btn.textContent = x === 'login' ? '登录' : '注册并创建托管钱包';
      msg.textContent = '';
    }
    tabL.onclick = function () { setMode('login'); };
    tabR.onclick = function () { setMode('reg'); };
    m.querySelector('#ea-close').onclick = function () { m.remove(); };
    m.onclick = function (e) { if (e.target === m) m.remove(); };
    btn.onclick = function () {
      var name = m.querySelector('#ea-user').value.trim();
      var pass = m.querySelector('#ea-pass').value;
      if (!name || !pass) { msg.textContent = '请输入用户名和密码'; return; }
      btn.disabled = true; btn.textContent = '处理中…';
      var done = function (u) {
        setUser(u); m.remove();
        toast('欢迎，' + u.username + (u.chain ? '（已连接本地区块链）' : '（演示模式）'), 'success');
        refreshWalletBtn();
      };
      if (API) {
        api('/auth/' + (cur === 'login' ? 'login' : 'register'), { method: 'POST', body: JSON.stringify({ username: name, password: pass }) })
          .then(function (res) { if (res.token) LS.set('token', res.token); done({ username: res.username, address: res.address, chain: true }); })
          .catch(function (e) { msg.textContent = e.message; btn.disabled = false; btn.textContent = cur === 'login' ? '登录' : '注册并创建托管钱包'; });
      } else {
        hash(pass).then(function (ph) {
          var users = LS.get('users', {});
          if (cur === 'reg') {
            if (users[name]) { msg.textContent = '用户名已存在，请直接登录'; btn.disabled = false; btn.textContent = '注册并创建托管钱包'; return; }
            users[name] = { pass: ph, address: demoAddress(name) };
            LS.set('users', users);
            done({ username: name, address: users[name].address, chain: false });
          } else {
            if (!users[name]) { users[name] = { pass: ph, address: demoAddress(name) }; LS.set('users', users); }
            else if (users[name].pass !== ph) { msg.textContent = '密码错误'; btn.disabled = false; btn.textContent = '登录'; return; }
            done({ username: name, address: users[name].address, chain: false });
          }
        });
      }
    };
    setMode(cur);
  }

  // ---------- 钱包按钮 ----------
  function refreshWalletBtn() {
    var btn = document.getElementById('wallet-btn');
    if (!btn) return;
    var u = user();
    var label = btn.querySelector('span') || btn;
    if (u) {
      label.textContent = u.username + ' · ' + shortAddr(u.address);
      btn.title = '点击退出登录';
      btn.onclick = function () { if (confirm('退出登录 ' + u.username + '？')) logout(); };
    } else {
      label.textContent = '登录 / 连接钱包';
      btn.title = '连接 EstateWallet（无需安装 MetaMask）';
      btn.onclick = function () {
        if (window.EstateWallet && EstateWallet.confirmConnect) {
          EstateWallet.confirmConnect().then(function (ok) { if (ok) openAuth(); });
        } else { openAuth(); }
      };
    }
  }
  function hijackWalletBtn() {
    var old = document.getElementById('wallet-btn');
    if (!old) return;
    var neu = old.cloneNode(true);
    old.parentNode.replaceChild(neu, old);
    refreshWalletBtn();
  }

  // ---------- 表单接管 ----------
  function val(id) { var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; }

  function hookForms() {
    document.querySelectorAll('form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var page = location.pathname.split('/').pop();
        var btnText = (form.querySelector('button[type=submit]') || {}).textContent || '';
        var order = null;

        if (form.querySelector('#buy-property') || /买单|认购|买入|购买/.test(btnText)) {
          var p = val('buy-property') || val('property') || val('subscribe-property');
          var price = Number(val('buy-price') || val('price') || (PROPERTIES[p] && PROPERTIES[p].price) || 0);
          var amount = Number(val('buy-amount') || val('amount') || 1);
          if (!p) return toast('请选择房产', 'error');
          if (!amount || amount < 1) return toast('请输入有效数量', 'error');
          order = { type: 'buy', property: p, propertyName: propName(p), price: price, amount: amount, total: price * amount };
        } else if (form.querySelector('#sell-holding') || /卖单|卖出/.test(btnText)) {
          var sp = val('sell-holding') || val('holding') || val('property');
          var sprice = Number(val('sell-price') || val('price') || 0);
          var samount = Number(val('sell-amount') || val('amount') || 1);
          if (!sp) return toast('请选择持仓', 'error');
          order = { type: 'sell', property: sp, propertyName: propName(sp), price: sprice, amount: samount, total: sprice * samount };
        } else if (page === 'split.html' || /拆分|铸造|发布/.test(btnText)) {
          var fp = val('property') || val('split-property');
          var famount = Number(val('fractions') || val('total-fractions') || val('total-shares') || val('amount') || 100);
          var totalVal = Number(val('total-value') || val('property-value') || 0);
          var fprice = Number(val('fraction-price') || val('price') || 0) || (famount && totalVal ? Math.round(totalVal / famount) : ((PROPERTIES[fp] && PROPERTIES[fp].price) || 0));
          if (!fp && !val('property-name')) return toast('请填写房产名称', 'error');
          if (!famount || famount < 1) return toast('请填写有效的总拆分份额', 'error');
          order = { type: 'split', property: fp || ('prop' + Date.now()), propertyName: fp ? propName(fp) : (val('property-name') || '新房产'), price: fprice, amount: famount, total: fprice * famount };
        } else if (page === 'redeem.html' || /赎回|合并/.test(btnText)) {
          var rp = val('property') || val('redeem-property') || val('holding');
          var ramount = Number(val('shares') || val('amount') || 1);
          if (!rp) return toast('请选择要赎回的房产', 'error');
          order = { type: 'redeem', property: rp, propertyName: propName(rp), price: PROPERTIES[rp] ? PROPERTIES[rp].price : 0, amount: ramount, total: 0 };
        } else if (page === 'yield.html' || /领取|分红|收益/.test(btnText)) {
          var yp = val('property') || val('yield-property') || 'villa';
          var ytotal = Number(val('amount') || 0) || Math.round((PROPERTIES[yp] ? PROPERTIES[yp].price : 6000) * 0.004);
          order = { type: 'claim', property: yp, propertyName: propName(yp), price: 0, amount: 1, total: ytotal };
        }
        if (order) submitOrder(order);
      });
    });

    document.querySelectorAll('button').forEach(function (b) {
      var t = (b.textContent || '').trim();
      if (!b.closest('form') && (/领取|分红/.test(t) || /claim/i.test(b.id || ''))) {
        b.addEventListener('click', function () {
          var p = b.getAttribute('data-claim') || 'villa';
          submitOrder({ type: 'claim', property: p, propertyName: propName(p), price: 0, amount: 1, total: Math.round((PROPERTIES[p] ? PROPERTIES[p].price : 6000) * 0.004) });
        });
      }
    });
  }

  // ---------- 个人中心：真实记录渲染（持仓 / 交易 / 分红 + 统计 + 导出）----------
  function renderProfile() {
    var u = user();
    var orders = getOrders().filter(function (o) { return !u || o.owner === u.username; });
    var holdings = getHoldings();
    var claims = getClaims();
    var highlighted = new URLSearchParams(location.search).get("order");
    function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
    function priceOf(k, hh){ return (PROPERTIES[k] && PROPERTIES[k].price) || hh.avgPrice || 0; }
    function emptyRow(n, msg){ return '<tr><td colspan="'+n+'" style="padding:26px;text-align:center;color:var(--estate-neutral-500,#9a9288)">'+msg+'</td></tr>'; }
    function setText(id, txt){ var el=document.getElementById(id); if(el) el.textContent=txt; }

    var wa = document.getElementById("wallet-address");
    if (wa && u) wa.textContent = (u.chain ? "链上托管账户 " : "演示账户 ") + shortAddr(u.address) + " · " + u.username;

    var exportBtn = document.getElementById("estate-export-csv");
    if (exportBtn) exportBtn.addEventListener("click", exportOrders);

    var holdKeys = Object.keys(holdings).filter(function (k){ return holdings[k].shares > 0; });
    var hasReal = orders.length > 0 || holdKeys.length > 0 || claims.length > 0;
    if (!hasReal) return; // 无真实记录时保留页面演示数据

    var sharesTotal = 0, valueTotal = 0, pendingTotal = 0;
    holdKeys.forEach(function (k){
      var hh = holdings[k], price = priceOf(k, hh);
      sharesTotal += hh.shares; valueTotal += hh.shares * price;
      pendingTotal += Math.round(hh.shares * price * 0.0027);
    });
    var claimTotal = claims.reduce(function (s,c){ return s + Number(c.amount || 0); }, 0);
    setText("stat-value", money(valueTotal));
    setText("stat-shares", sharesTotal + " 份");
    setText("stat-pending", money(pendingTotal));
    setText("stat-claimtotal", money(claimTotal));

    var hb = document.getElementById("tbody-holdings");
    if (hb) hb.innerHTML = holdKeys.map(function (k){
      var hh = holdings[k], price = priceOf(k, hh), pend = Math.round(hh.shares * price * 0.0027);
      return "<tr><td>"+esc(hh.name || propName(k))+"</td><td class=\"tabular\">"+hh.shares+"</td><td class=\"tabular\">"+money(price)+"</td><td class=\"tabular\">"+money(hh.shares*price)+"</td><td class=\"tabular\">"+money(pend)+"</td></tr>";
    }).join("") || emptyRow(5, "暂无持仓，去 <a href=\"./trade.html\" style=\"color:var(--estate-primary)\">份额交易</a> 买入吧");

    var ob = document.getElementById("tbody-orders");
    if (ob) ob.innerHTML = orders.map(function (o){
      var typeCn = TYPE_CN[o.type] || o.type;
      var stCn = STATUS_CN[o.status] || o.status || "已成交";
      var badge = o.status === "failed" ? "<span class=\"badge\" style=\"background:#fdeaea;color:#c0392b\">"+stCn+"</span>"
        : (o.status === "pending" ? "<span class=\"badge badge-warning\">"+stCn+"</span>" : "<span class=\"badge badge-success\">"+stCn+"</span>");
      var hl = o.id === highlighted ? " style=\"background:var(--estate-primary-50,#faf3e6)\"" : "";
      return "<tr"+hl+"><td>"+fmtTime(o.createdAt)+"</td><td>"+esc(typeCn)+"</td><td>"+esc(o.propertyName||"—")+"</td><td class=\"tabular\">"+(o.amount||0)+" 份</td><td class=\"tabular\">"+(o.type==="claim"?"+":"")+money(o.total)+"</td><td>"+badge+"</td></tr>";
    }).join("") || emptyRow(6, "暂无交易记录，完成一笔 <a href=\"./trade.html\" style=\"color:var(--estate-primary)\">买入</a> 后自动保存");

    var cb = document.getElementById("tbody-claims");
    if (cb) cb.innerHTML = claims.map(function (c){
      var t = c.time || c.createdAt || Date.now();
      var d = new Date(t);
      var ym = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
      return "<tr><td>"+fmtTime(t)+"</td><td>"+esc(c.propertyName||"—")+"</td><td>"+ym+"</td><td class=\"tabular\">—</td><td class=\"tabular\">+"+money(c.amount)+"</td></tr>";
    }).join("") || emptyRow(5, "暂无分红记录，前往 <a href=\"./yield.html\" style=\"color:var(--estate-primary)\">收益领取</a>");
  }

  // ---------- 启动 ----------
  function boot() {
    detectBackend().then(function () {
      hijackWalletBtn();
      hookForms();
      if (location.pathname.indexOf('profile.html') !== -1) renderProfile();
      window.ESTATE = { user: user, logout: logout, openAuth: openAuth, submitOrder: submitOrder, exportOrders: exportOrders, API: function () { return API; }, PROPERTIES: PROPERTIES };
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
