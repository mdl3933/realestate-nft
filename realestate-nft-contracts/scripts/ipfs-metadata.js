/*
 * IPFS 元数据存证脚本（零依赖，Node 18+）
 * 作用：为每套房产生成 ERC-721/ERC-1155 标准 metadata JSON，
 *   1) 若本机运行 IPFS 节点（http://127.0.0.1:5001），则自动上传并 pin，得到 ipfs://<cid>；
 *   2) 否则把 metadata 写入前端 assets/ipfs/，并生成 base64 data: URI 作为链上兜底；
 *   3) 输出 deployments/ipfs-metadata.json，供铸造/前端引用。
 * 用法：node scripts/ipfs-metadata.js   （或 npx hardhat run scripts/ipfs-metadata.js）
 */
const fs = require('fs');
const path = require('path');

const IPFS_API = process.env.IPFS_API || 'http://127.0.0.1:5001';

const METAS = [
  { key: 'villa', tokenId: 0, name: '虹桥轻奢别墅', location: '上海·虹桥', area: '268㎡', rooms: '5室2厅', valuation: '$1,800,000', shares: 1000 },
  { key: 'loft', tokenId: 1, name: '静安 Loft 公寓', location: '上海·静安', area: '96㎡', rooms: '2室1厅', valuation: '$520,000', shares: 1000 },
  { key: 'office', tokenId: 2, name: '陆家嘴甲级写字楼', location: '上海·陆家嘴', area: '420㎡', rooms: '甲级办公', valuation: '$3,600,000', shares: 1000 },
  { key: 'apartment', tokenId: 3, name: '徐汇精装公寓', location: '上海·徐汇', area: '88㎡', rooms: '3室1厅', valuation: '$620,000', shares: 1000 }
];

function buildMetadata(m) {
  return {
    name: m.name,
    description: 'RWA 房产分片所有权凭证 · ' + m.location + ' · 共 ' + m.shares + ' 份',
    image: 'ipfs://estate/' + m.key + '.png',
    external_url: 'https://mdl3933.github.io/realestate-nft/',
    attributes: [
      { trait_type: '位置', value: m.location },
      { trait_type: '建筑面积', value: m.area },
      { trait_type: '户型', value: m.rooms },
      { trait_type: '评估价', value: m.valuation },
      { trait_type: '总份额', value: m.shares },
      { trait_type: '资产类别', value: 'Real Estate (RWA)' }
    ]
  };
}

async function addToIpfs(jsonStr, filename) {
  try {
    const form = new FormData();
    form.append('file', new Blob([jsonStr], { type: 'application/json' }), filename);
    const res = await fetch(IPFS_API + '/api/v0/add?pin=true', { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = await res.json();
    return data.Hash ? 'ipfs://' + data.Hash : null;
  } catch (e) {
    return null;
  }
}

function toDataUri(jsonStr) {
  return 'data:application/json;base64,' + Buffer.from(jsonStr, 'utf8').toString('base64');
}

async function main() {
  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const feIpfsDir = path.join(__dirname, '..', '..', 'realestate-nft-fraction', 'assets', 'ipfs');
  fs.mkdirSync(feIpfsDir, { recursive: true });

  let pinned = 0;
  const result = [];
  for (const m of METAS) {
    const meta = buildMetadata(m);
    const jsonStr = JSON.stringify(meta, null, 2);
    fs.writeFileSync(path.join(feIpfsDir, m.key + '.json'), jsonStr, 'utf8');

    let uri = await addToIpfs(jsonStr, m.key + '.json');
    if (uri) pinned++;
    const dataUri = toDataUri(jsonStr);
    result.push({ tokenId: m.tokenId, key: m.key, name: m.name, ipfsUri: uri, dataUri, local: 'assets/ipfs/' + m.key + '.json' });
    console.log((uri ? '[IPFS] ' : '[本地] ') + m.key + ' -> ' + (uri || dataUri.slice(0, 40) + '...'));
  }

  fs.writeFileSync(path.join(outDir, 'ipfs-metadata.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ipfsNode: pinned ? IPFS_API : null, items: result }, null, 2), 'utf8');
  console.log('\n元数据已生成：' + result.length + ' 套，IPFS 上链 pin：' + pinned + ' 套');
  if (!pinned) {
    console.log('提示：未检测到本地 IPFS 节点。安装并启动 IPFS Desktop / kubo 后重跑本脚本即可自动 pin；');
    console.log('      当前已用 base64 data URI 作为链上 metadata 兜底，前端 assets/ipfs/ 也留有 JSON 文件。');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
