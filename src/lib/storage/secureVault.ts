import type {
  Account,
  AppSettings,
  AssetRecord,
  BudgetVault,
  Expense,
  WishlistItem
} from '../types';
import { getBudgetDb } from './db';
import { verifyPin } from '../utils/pin';

const SECURE_VAULT_RECORD_ID = 'vault';
const SECURE_VAULT_MAGIC = 'budget-vault-v2';
const SECURE_VAULT_VERSION = 2;
const DEFAULT_PBKDF2_ITERATIONS = 250_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type SecureVaultRecord = {
  id: string;
  cipherTextBase64: string;
  ivBase64: string;
  updatedAt: string;
};

function sortAccounts(accounts: Account[]) {
  return [...accounts].sort((left, right) => left.sortOrder - right.sortOrder);
}

function sortExpenses(expenses: Expense[]) {
  return [...expenses].sort((left, right) => {
    if (left.dateISO !== right.dateISO) {
      return right.dateISO.localeCompare(left.dateISO);
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

function sortWishlistItems(wishlistItems: WishlistItem[]) {
  return [...wishlistItems].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';

  for (const value of new Uint8Array(buffer)) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function normalizeVault(vault: BudgetVault): BudgetVault {
  return {
    accounts: sortAccounts(vault.accounts),
    expenses: sortExpenses(vault.expenses),
    wishlistItems: sortWishlistItems(vault.wishlistItems),
    assets: [...vault.assets]
  };
}

async function deriveVaultKey(
  pin: string,
  pinSaltBase64: string,
  keyDerivationIterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const pinMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToArrayBuffer(pinSaltBase64),
      iterations: keyDerivationIterations,
      hash: 'SHA-256'
    },
    pinMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVault(vault: BudgetVault, key: CryptoKey): Promise<SecureVaultRecord> {
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const payloadBytes = textEncoder.encode(
    JSON.stringify({
      magic: SECURE_VAULT_MAGIC,
      vault: normalizeVault(vault)
    })
  );
  const cipherText = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    payloadBytes
  );

  return {
    id: SECURE_VAULT_RECORD_ID,
    cipherTextBase64: arrayBufferToBase64(cipherText),
    ivBase64: arrayBufferToBase64(ivBytes.buffer),
    updatedAt: new Date().toISOString()
  };
}

async function decryptVault(record: SecureVaultRecord, key: CryptoKey): Promise<BudgetVault> {
  const decryptedBytes = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToArrayBuffer(record.ivBase64)
    },
    key,
    base64ToArrayBuffer(record.cipherTextBase64)
  );
  const parsedPayload = JSON.parse(textDecoder.decode(decryptedBytes)) as {
    magic?: string;
    vault?: BudgetVault;
  };

  if (parsedPayload.magic !== SECURE_VAULT_MAGIC || !parsedPayload.vault) {
    throw new Error('Vault data is invalid.');
  }

  return normalizeVault(parsedPayload.vault);
}

async function getSecureVaultRecord(): Promise<SecureVaultRecord | undefined> {
  const db = await getBudgetDb();
  return db.get('secureVault', SECURE_VAULT_RECORD_ID);
}

export async function initializeSecureVault(pin: string, vault: BudgetVault): Promise<AppSettings> {
  const pinSaltBytes = crypto.getRandomValues(new Uint8Array(16));
  const pinSaltBase64 = arrayBufferToBase64(pinSaltBytes.buffer);
  const keyDerivationIterations = DEFAULT_PBKDF2_ITERATIONS;
  const key = await deriveVaultKey(pin, pinSaltBase64, keyDerivationIterations);
  const encryptedVault = await encryptVault(vault, key);
  const db = await getBudgetDb();

  await db.put('secureVault', encryptedVault);

  return {
    isSeeded: true,
    securityVersion: SECURE_VAULT_VERSION,
    pinSaltBase64,
    keyDerivationIterations,
    failedUnlockAttempts: 0
  };
}

export async function unlockSecureVault(
  pin: string,
  settings: AppSettings
): Promise<{ key: CryptoKey; vault: BudgetVault } | null> {
  if (!settings.pinSaltBase64) {
    return null;
  }

  const record = await getSecureVaultRecord();

  if (!record) {
    return null;
  }

  try {
    const key = await deriveVaultKey(
      pin,
      settings.pinSaltBase64,
      settings.keyDerivationIterations ?? DEFAULT_PBKDF2_ITERATIONS
    );
    const vault = await decryptVault(record, key);

    return { key, vault };
  } catch {
    return null;
  }
}

export async function persistSecureVault(key: CryptoKey, vault: BudgetVault): Promise<void> {
  const db = await getBudgetDb();
  const encryptedVault = await encryptVault(vault, key);

  await db.put('secureVault', encryptedVault);
}

export async function readLegacyPlaintextVault(): Promise<BudgetVault> {
  const db = await getBudgetDb();
  const [accounts, expenses, wishlistItems, assets] = await Promise.all([
    db.getAll('accounts'),
    db.getAll('expenses'),
    db.getAll('wishlist'),
    db.getAll('assets')
  ]);

  return normalizeVault({
    accounts,
    expenses,
    wishlistItems,
    assets
  });
}

export async function migrateLegacyPlaintextVault(
  pin: string,
  settings: AppSettings
): Promise<{ key: CryptoKey; nextSettings: AppSettings; vault: BudgetVault } | null> {
  if (!settings.pinHash) {
    return null;
  }

  const matches = await verifyPin(pin, settings.pinHash);

  if (!matches) {
    return null;
  }

  const vault = await readLegacyPlaintextVault();
  const nextSettings = await initializeSecureVault(pin, vault);
  const secureUnlockResult = await unlockSecureVault(pin, nextSettings);

  if (!secureUnlockResult) {
    throw new Error('Unable to unlock the migrated vault.');
  }

  await clearLegacyPlaintextData();

  return {
    key: secureUnlockResult.key,
    nextSettings,
    vault
  };
}

export async function clearLegacyPlaintextData(): Promise<void> {
  const db = await getBudgetDb();
  const transaction = db.transaction(
    ['accounts', 'expenses', 'wants', 'wishlist', 'assets'],
    'readwrite'
  );

  await Promise.all([
    transaction.objectStore('accounts').clear(),
    transaction.objectStore('expenses').clear(),
    transaction.objectStore('wants').clear(),
    transaction.objectStore('wishlist').clear(),
    transaction.objectStore('assets').clear()
  ]);
  await transaction.done;
}

export function isLegacySecuritySettings(settings: AppSettings | null): boolean {
  return Boolean(settings?.isSeeded && settings.pinHash && !settings.pinSaltBase64);
}
