import type { AppSettings } from '../types';
import { resetBudgetDb } from './db';

const SETTINGS_STORAGE_KEY = 'budget-pwa-settings';

export const settingsRepo = {
  get(): AppSettings | null {
    const rawValue = localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue) as AppSettings;
  },

  save(settings: AppSettings): void {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  },

  reset(): void {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  }
};

export async function clearAllLocalData(): Promise<void> {
  settingsRepo.reset();
  await resetBudgetDb();
}
