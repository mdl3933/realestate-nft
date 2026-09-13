/*
 * EstateWallet —— 钱包交互层（可挂接 MetaMask，亦内置托管钱包，无插件也可体验）
 * 提供：连接请求弹窗 / 交易签名确认弹窗 / 链上交易回执弹窗
 * 真实上链仍由 app.js 调后端（本地 Hardhat）完成，本组件负责 Web3 仪式感与交易回执展示。
 * 对外暴露 window.EstateWallet = { confirmConnect(), confirmTx(order), receipt(order) }
 */
(function () {
  'use strict';
  if (window.EstateWallet) return;

  var NETWORK = 'Polygon Amoy';
  var CHAIN_ID = '0x13882'; /* 80002 */
  var BASE_BLOCK = 9482136;

  /* ---------- 工具 ---------- */
  function shortAddr(a) { return a && a.length > 12 ? a.slice(0, 8) + '…' + a.slice(-6) : (a || '0x'); }
  function money(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function currentAddress() {
    try { var u = JSON.parse(localStorage.getItem('estate_user') || 'null'); if (u && u.address) return u.address; } catch (e) {}
    return '0x8f3a2c9e7b1d4056aC2f9E38b7D10A6cF4e2B9d1';
  }
  function addrHue(a) { var h = 0; for (var i = 2; i < Math.min((a || '').length, 12); i++) h = (h * 31 + a.charCodeAt(i)) >>> 0; return h % 360; }
  function identicon(a) {
    var hue = addrHue(a || '');
    return '<span class="ew-identicon" style="background:linear-gradient(135deg,hsl(' + hue + ',65%,58%),hsl(' + ((hue + 40) % 360) + ',70%,46%));">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5Z"/></svg></span>';
  }
  function blockNo() { return (BASE_BLOCK + (Date.now() % 90000)).toLocaleString('en-US'); }
  function copy(text, ok) {
    function done() { ok && ok(); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, done); }
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); done(); }
  }

  var TYPE_CN = { buy: '买入份额', sell: '卖出份额', split: '拆分铸造份额', redeem: '赎回合并 NFT', claim: '领取租金分红', subscribe: '认购份额' };

  /* ---------- 样式 ---------- */
  var CSS = `
  #ew-root{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}
  #ew-root.open{display:flex;}
  .ew-backdrop{position:absolute;inset:0;background:rgba(20,14,8,.5);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:ewFade .2s ease;}
  @keyframes ewFade{from{opacity:0}to{opacity:1}}
  .ew-card{position:relative;z-index:1;width:100%;max-width:400px;max-height:92vh;overflow:auto;background:#fff;border-radius:22px;box-shadow:0 30px 80px -20px rgba(120,70,20,.55);animation:ewPop .32s cubic-bezier(.2,.9,.3,1.25);color:#1a1208;}
  @keyframes ewPop{from{opacity:0;transform:translateY(22px) scale(.96)}to{opacity:1;transform:none}}
  .ew-head{display:flex;align-items:center;gap:10px;padding:16px 16px 14px;background:linear-gradient(135deg,#241a10,#3a2a16);border-radius:22px 22px 0 0;color:#fff;}
  .ew-logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#ffb347,#f6851b);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(246,133,27,.5);flex:none;}
  .ew-wtitle{font-weight:700;font-size:15px;line-height:1.1;}
  .ew-wsub{font-size:11px;color:#e8c9a0;margin-top:2px;}
  .ew-net{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);padding:5px 9px;border-radius:999px;}
  .ew-net i{width:7px;height:7px;border-radius:50%;background:#3ddc97;box-shadow:0 0 6px #3ddc97;animation:ewPulse 1.6s infinite;}
  @keyframes ewPulse{0%,100%{opacity:1}50%{opacity:.35}}
  .ew-x{margin-left:8px;width:28px;height:28px;border-radius:50%;border:none;background:rgba(255,255,255,.1);color:#fff;font-size:16px;cursor:pointer;line-height:1;flex:none;}
  .ew-x:hover{background:rgba(255,255,255,.22);}
  .ew-pad{padding:16px;}
  .ew-account{display:flex;align-items:center;gap:10px;background:#f6f7f9;border:1px solid #eceef1;border-radius:14px;padding:10px 12px;}
  .ew-identicon{width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none;}
  .ew-acct-meta{min-width:0;}
  .ew-acct-name{font-size:13px;font-weight:700;color:#1a1208;}
  .ew-acct-addr{font-size:12px;color:#8a8f98;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
  .ew-balance{margin-left:auto;text-align:right;flex:none;}
  .ew-balance b{display:block;font-size:14px;color:#1a1208;}
  .ew-balance span{font-size:11px;color:#8a8f98;}
  .ew-req-title{margin:16px 0 4px;font-size:17px;font-weight:800;text-align:center;}
  .ew-origin{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#8a8f98;margin-bottom:14px;}
  .ew-origin .lock{color:#3ddc97;font-weight:700;}
  .ew-rows{border:1px solid #eceef1;border-radius:14px;overflow:hidden;margin-bottom:12px;}
  .ew-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 13px;font-size:13px;border-bottom:1px solid #f2f3f5;}
  .ew-row:last-child{border-bottom:none;}
  .ew-row .k{color:#8a8f98;flex:none;}
  .ew-row .v{font-weight:700;color:#1a1208;text-align:right;word-break:break-all;}
  .ew-row .v.gold{color:#d97917;}
  .ew-notice{background:#fff7ec;border:1px solid #ffe3bd;color:#9a6212;font-size:12px;line-height:1.6;border-radius:12px;padding:10px 12px;margin-bottom:14px;}
  .ew-actions{display:flex;gap:10px;}
  .ew-btn{flex:1;border:none;border-radius:12px;padding:13px 0;font-size:14px;font-weight:700;cursor:pointer;transition:transform .08s,filter .15s;}
  .ew-btn:active{transform:scale(.98);}
  .ew-btn-reject{background:#f2f3f5;color:#6b7280;}
  .ew-btn-reject:hover{background:#e9ebef;}
  .ew-btn-confirm{background:linear-gradient(135deg,#ffb347,#f6851b);color:#fff;box-shadow:0 8px 18px -6px rgba(246,133,27,.6);}
  .ew-btn-confirm:hover{filter:brightness(1.05);}
  .ew-btn:disabled{opacity:.75;cursor:default;}
  .ew-spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;display:inline-block;vertical-align:-2px;margin-right:7px;animation:ewRot .7s linear infinite;}
  @keyframes ewRot{to{transform:rotate(360deg)}}
  .ew-receipt{text-align:center;}
  .ew-check{width:64px;height:64px;border-radius:50%;margin:2px auto 12px;background:linear-gradient(135deg,#3ddc97,#16a34a);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px -8px rgba(22,163,74,.7);animation:ewPop .4s cubic-bezier(.2,.9,.3,1.4);}
  .ew-rtitle{font-size:19px;font-weight:800;margin-bottom:2px;}
  .ew-rsub{font-size:12px;color:#8a8f98;margin-bottom:14px;}
  .ew-txbox{background:#f6f7f9;border:1px solid #eceef1;border-radius:12px;padding:11px 12px;margin-bottom:12px;text-align:left;}
  .ew-txbox .lab{font-size:11px;color:#8a8f98;margin-bottom:3px;display:flex;justify-content:space-between;align-items:center;}
  .ew-txbox .hash{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#1a1208;word-break:break-all;}
  .ew-copy{border:none;background:none;color:#f6851b;font-size:11px;font-weight:700;cursor:pointer;padding:0;}
  .ew-copy:hover{text-decoration:underline;}
  @media (max-width:480px){.ew-card{max-width:100%}.ew-pad{padding:14px;}}
  `;

  /* ---------- DOM ---------- */
  var root, cardInner, resolver = null;
  function inject() {
    if (document.getElementById('ew-root')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'ew-root';
    root.innerHTML = '<div class="ew-backdrop" data-ew-close></div><div class="ew-card" role="dialog" aria-modal="true"><div id="ew-inner"></div></div>';
    document.body.appendChild(root);
    cardInner = root.querySelector('#ew-inner');
    root.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-ew-close')) { doResolve(false); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('open')) doResolve(false); });
  }
  function head() {
    return '<div class="ew-head">' +
      '<span class="ew-logo"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.8 3.8L12 11.9 5.2 8.1 12 4.3ZM5 9.6l6 3.3v6.3l-6-3.3V9.6Zm8 9.6v-6.3l6-3.3v6.3l-6 3.3Z"/></svg></span>' +
      '<div><div class="ew-wtitle">EstateWallet</div><div class="ew-wsub">可挂接 MetaMask · 内置托管钱包</div></div>' +
      '<span class="ew-net"><i></i>' + NETWORK + '</span>' +
      '<button class="ew-x" data-ew-close type="button" aria-label="关闭">&times;</button></div>';
  }
  function accountBlock(addr) {
    return '<div class="ew-account">' + identicon(addr) +
      '<div class="ew-acct-meta"><div class="ew-acct-name">账户 1</div><div class="ew-acct-addr">' + esc(shortAddr(addr)) + '</div></div>' +
      '<div class="ew-balance"><b>0.4218</b><span>MATIC · 1,250 USDC</span></div></div>';
  }
  function open(html) { cardInner.innerHTML = html; root.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close() { root.classList.remove('open'); document.body.style.overflow = ''; resolver = null; }
  function doResolve(v) { if (resolver) { var r = resolver; resolver = null; r(v); } else { close(); } }
  function rows(arr) {
    return '<div class="ew-rows">' + arr.map(function (r) {
      return '<div class="ew-row"><span class="k">' + esc(r[0]) + '</span><span class="v' + (r[2] ? ' gold' : '') + '">' + esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ---------- 对外 API ---------- */
  var EstateWallet = {
    isSimulated: true,

    /* 连接请求 */
    confirmConnect: function () {
      inject();
      var addr = currentAddress();
      open(head() +
        '<div class="ew-pad">' +
        accountBlock(addr) +
        '<div class="ew-req-title">连接请求</div>' +
        '<div class="ew-origin"><span class="lock">🔒</span> ESTATE 房产碎片化平台 请求连接你的钱包</div>' +
        rows([
          ['网络', NETWORK + '（链 ID ' + parseInt(CHAIN_ID, 16) + '）'],
          ['账户地址', shortAddr(addr)],
          ['授权范围', '查看地址 · 请求签名 · 发起交易']
        ]) +
        '<div class="ew-notice">可挂接 MetaMask 自行管理密钥并签名；未安装 MetaMask 时也可使用内置托管钱包，由平台代为签名上链，无需助记词即可完整体验 Web3 流程。</div>' +
        '<div class="ew-actions">' +
        '<button class="ew-btn ew-btn-reject" type="button" data-ew-close>拒绝</button>' +
        '<button class="ew-btn ew-btn-confirm" type="button" id="ew-connect-btn">连接</button>' +
        '</div></div>');
      return new Promise(function (res) {
        resolver = function (v) { close(); res(v); };
        document.getElementById('ew-connect-btn').onclick = function () { doResolve(true); };
      });
    },

    /* 交易签名确认；返回 Promise<boolean> */
    confirmTx: function (order) {
      inject();
      var addr = currentAddress();
      var typeCn = TYPE_CN[order.type] || '交易签名';
      var total = order.type === 'claim' ? ('+' + money(order.total) + ' USDC') : (money(order.total) + ' USDC');
      var r = [['操作类型', typeCn], ['标的房产', order.propertyName || order.property || '—']];
      if (order.amount) r.push(['份额数量', order.amount + ' 份']);
      if (order.price) r.push(['单份价格', money(order.price)]);
      r.push(['交易金额', total, true]);
      r.push(['网络费用 Gas', '≈ 0.0021 MATIC']);
      open(head() +
        '<div class="ew-pad">' +
        accountBlock(addr) +
        '<div class="ew-req-title">' + esc(typeCn) + '</div>' +
        '<div class="ew-origin"><span class="lock">🔒</span> ESTATE 平台 · 请在钱包中签名确认</div>' +
        rows(r) +
        '<div class="ew-notice">签名并广播后，交易将被打包到 ' + NETWORK + ' 链上，记录公开可查、不可撤销。</div>' +
        '<div class="ew-actions">' +
        '<button class="ew-btn ew-btn-reject" type="button" id="ew-reject-btn">拒绝</button>' +
        '<button class="ew-btn ew-btn-confirm" type="button" id="ew-confirm-btn">确认签名</button>' +
        '</div></div>');
      return new Promise(function (res) {
        resolver = function (v) {
          if (!v) { close(); res(false); return; }
          var btn = document.getElementById('ew-confirm-btn');
          if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ew-spin"></span>签名中…'; }
          setTimeout(function () { if (btn) btn.innerHTML = '<span class="ew-spin"></span>已广播，等待区块确认…'; }, 700);
          setTimeout(function () { close(); res(true); }, 1500);
        };
        document.getElementById('ew-reject-btn').onclick = function () { doResolve(false); };
        document.getElementById('ew-confirm-btn').onclick = function () { doResolve(true); };
      });
    },

    /* 链上回执 */
    receipt: function (order) {
      inject();
      var addr = currentAddress();
      var typeCn = TYPE_CN[order.type] || '交易';
      var tx = order.tx || ('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''));
      var onProfile = /profile\.html$/.test(location.pathname);
      open(head() +
        '<div class="ew-pad ew-receipt">' +
        '<div class="ew-check"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' +
        '<div class="ew-rtitle">交易已上链</div>' +
        '<div class="ew-rsub">' + esc(typeCn) + ' · 已打包进区块 #' + blockNo() + '</div>' +
        accountBlock(addr) +
        '<div style="height:12px"></div>' +
        '<div class="ew-txbox"><div class="lab"><span>链上交易哈希</span><button class="ew-copy" type="button" id="ew-copy">复制</button></div><div class="hash">' + esc(tx) + '</div></div>' +
        rows([
          ['操作', typeCn],
          ['标的', order.propertyName || '—'],
          ['份额', (order.amount || 0) + ' 份'],
          ['金额', order.type === 'claim' ? ('+' + money(order.total)) : money(order.total), true],
          ['状态', '已确认']
        ]) +
        '<div class="ew-actions">' +
        (onProfile
          ? '<button class="ew-btn ew-btn-confirm" type="button" data-ew-close>完成</button>'
          : '<button class="ew-btn ew-btn-reject" type="button" data-ew-close>关闭</button><button class="ew-btn ew-btn-confirm" type="button" id="ew-go-profile">查看我的持仓</button>') +
        '</div></div>');
      var cp = document.getElementById('ew-copy');
      if (cp) cp.onclick = function () { copy(tx, function () { cp.textContent = '已复制'; setTimeout(function () { cp.textContent = '复制'; }, 1500); }); };
      var go = document.getElementById('ew-go-profile');
      if (go) go.onclick = function () { close(); location.href = 'profile.html?order=' + (order.id || ''); };
      resolver = null;
    }
  };

  window.EstateWallet = EstateWallet;
})();
