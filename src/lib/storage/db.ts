import { DBSchema, deleteDB, openDB } from 'idb';
import type { Account, AssetRecord, Expense, WantItem } from '../types';

interface BudgetDbSchema extends DBSchema {
  accounts: {
    key: string;
    value: Account;
  };
  expenses: {
    key: string;
    value: Expense;
    indexes: {
      'by-account': string;
      'by-createdAt': string;
    };
  };
  wants: {
    key: string;
    value: WantItem;
    indexes: {
      'by-createdAt': string;
    };
  };
  assets: {
    key: string;
    value: AssetRecord;
  };
}

const DB_NAME = 'budget-pwa-v1';
const DB_VERSION = 1;

let dbPromise: Promise<import('idb').IDBPDatabase<BudgetDbSchema>> | null = null;

export function getBudgetDb() {
  dbPromise ??= openDB<BudgetDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('expenses')) {
        const expenseStore = db.createObjectStore('expenses', { keyPath: 'id' });
        expenseStore.createIndex('by-account', 'accountId');
        expenseStore.createIndex('by-createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains('wants')) {
        const wantStore = db.createObjectStore('wants', { keyPath: 'id' });
        wantStore.createIndex('by-createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'id' });
      }
    }
  });

  return dbPromise;
}

export async function resetBudgetDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }

  await deleteDB(DB_NAME);
}
