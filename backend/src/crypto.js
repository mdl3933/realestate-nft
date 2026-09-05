const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;

function deriveKey() {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY or JWT_SECRET is required for wallet encryption');
  }
  return crypto.pbkdf2Sync(ENCRYPTION_KEY, 'estate-nft-wallet-salt', 100000, 32, 'sha256');
}

function encryptPrivateKey(plainPrivateKey) {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainPrivateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptPrivateKey(encryptedPrivateKey) {
  const key = deriveKey();
  const parts = encryptedPrivateKey.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted private key format');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encryptPrivateKey,
  decryptPrivateKey,
};
