import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  Account,
  AddAccountInput,
  AddExpenseInput,
  AddWishlistInput,
  AppSettings,
  AssetRecord,
  BudgetVault,
  Expense,
  SetupAccountInput,
  WishlistItem
} from '../../lib/types';
import { clearAllLocalData, settingsRepo } from '../../lib/storage/repositories';
import {
  initializeSecureVault,
  isLegacySecuritySettings,
  migrateLegacyPlaintextVault,
  persistSecureVault,
  unlockSecureVault
} from '../../lib/storage/secureVault';
import { resizeImageToDataUrl } from '../../lib/utils/image';
import { createId } from '../../lib/utils/id';
import { ensureFiveIncrement } from '../../lib/utils/money';

type BootStatus = 'loading' | 'setup' | 'locked' | 'ready';

type UnlockResult = {
  ok: boolean;
  message?: string;
};

type BudgetAppContextValue = {
  bootStatus: BootStatus;
  settings: AppSettings | null;
  accounts: Account[];
  expenses: Expense[];
  wishlistItems: WishlistItem[];
  assets: Record<string, AssetRecord>;
  completeSetup: (pin: string, accountInputs: SetupAccountInput[]) => Promise<void>;
  addAccount: (input: AddAccountInput) => Promise<void>;
  unlock: (pin: string) => Promise<UnlockResult>;
  lock: () => void;
  quickAdjustBalance: (accountId: string, deltaCents: number) => Promise<void>;
  addExpense: (input: AddExpenseInput) => Promise<void>;
  deleteExpense: (expenseId: string) => Promise<void>;
  addWishlistItem: (input: AddWishlistInput) => Promise<void>;
  deleteWishlistItem: (wishlistItemId: string) => Promise<void>;
  resetApp: () => Promise<void>;
};

const LOCKOUT_START_ATTEMPT = 5;
const LOCKOUT_BASE_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;

const BudgetAppContext = createContext<BudgetAppContextValue | undefined>(undefined);

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

function lockoutMessage(remainingMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `Too many attempts. Try again in ${minutes}m ${seconds}s.`;
  }

  return `Too many attempts. Try again in ${seconds}s.`;
}

function normalizeSecuritySettings(settings: AppSettings | null): AppSettings | null {
  if (!settings) {
    return null;
  }

  const lockoutUntilMs = settings.lockoutUntilISO
    ? new Date(settings.lockoutUntilISO).getTime()
    : null;

  if (lockoutUntilMs && lockoutUntilMs <= Date.now()) {
    return {
      ...settings,
      failedUnlockAttempts: 0,
      lockoutUntilISO: undefined
    };
  }

  return settings;
}

function nextLockoutDurationMs(failedUnlockAttempts: number): number {
  if (failedUnlockAttempts < LOCKOUT_START_ATTEMPT) {
    return 0;
  }

  return Math.min(
    MAX_LOCKOUT_MS,
    LOCKOUT_BASE_MS * 2 ** (failedUnlockAttempts - LOCKOUT_START_ATTEMPT)
  );
}

function toAssetMap(assets: AssetRecord[]) {
  return Object.fromEntries(assets.map((asset) => [asset.id, asset]));
}

export function BudgetAppProvider({ children }: { children: React.ReactNode }) {
  const [bootStatus, setBootStatus] = useState<BootStatus>('loading');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [assets, setAssets] = useState<Record<string, AssetRecord>>({});
  const sessionKeyRef = useRef<CryptoKey | null>(null);

  const applyVaultToState = useCallback((vault: BudgetVault) => {
    setAccounts(sortAccounts(vault.accounts));
    setExpenses(sortExpenses(vault.expenses));
    setWishlistItems(sortWishlistItems(vault.wishlistItems));
    setAssets(toAssetMap(vault.assets));
  }, []);

  const clearSensitiveState = useCallback(() => {
    sessionKeyRef.current = null;
    setAccounts([]);
    setExpenses([]);
    setWishlistItems([]);
    setAssets({});
  }, []);

  const currentVault = useMemo<BudgetVault>(
    () => ({
      accounts,
      expenses,
      wishlistItems,
      assets: Object.values(assets)
    }),
    [accounts, expenses, wishlistItems, assets]
  );

  const persistVaultState = useCallback(
    async (vault: BudgetVault) => {
      if (!sessionKeyRef.current) {
        throw new Error('Unlock the app before editing your budget.');
      }

      await persistSecureVault(sessionKeyRef.current, vault);
      applyVaultToState(vault);
    },
    [applyVaultToState]
  );

  const lock = useCallback(() => {
    setBootStatus((currentStatus) => {
      if (currentStatus === 'ready') {
        clearSensitiveState();
        return 'locked';
      }

      return currentStatus;
    });
  }, [clearSensitiveState]);

  useEffect(() => {
    const nextSettings = normalizeSecuritySettings(settingsRepo.get());

    if (nextSettings) {
      settingsRepo.save(nextSettings);
    }

    setSettings(nextSettings);

    if (!nextSettings?.isSeeded) {
      clearSensitiveState();
      setBootStatus('setup');
      return;
    }

    clearSensitiveState();
    setBootStatus('locked');
  }, [clearSensitiveState]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        lock();
      }
    }

    function handlePageHide() {
      lock();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [lock]);

  async function completeSetup(pin: string, accountInputs: SetupAccountInput[]) {
    const seededAccounts: Account[] = [];
    const nextAssets: AssetRecord[] = [];

    for (let index = 0; index < accountInputs.length; index += 1) {
      const accountInput = accountInputs[index];
      const resizedImage = await resizeImageToDataUrl(accountInput.logoFile);
      const asset: AssetRecord = {
        id: createId(),
        createdAt: new Date().toISOString(),
        dataUrl: resizedImage.dataUrl,
        mimeType: resizedImage.mimeType,
        width: resizedImage.width,
        height: resizedImage.height
      };
      const account: Account = {
        id: createId(),
        name: accountInput.name,
        logoAssetId: asset.id,
        balanceCents: accountInput.balanceCents,
        sortOrder: index,
        createdAt: new Date().toISOString()
      };

      seededAccounts.push(account);
      nextAssets.push(asset);
    }

    const nextSettings = await initializeSecureVault(pin, {
      accounts: seededAccounts,
      expenses: [],
      wishlistItems: [],
      assets: nextAssets
    });

    settingsRepo.save(nextSettings);
    setSettings(nextSettings);
    clearSensitiveState();
    setBootStatus('locked');
  }

  async function addAccount(input: AddAccountInput) {
    ensureFiveIncrement(input.balanceCents);

    const resizedImage = await resizeImageToDataUrl(input.logoFile);
    const asset: AssetRecord = {
      id: createId(),
      createdAt: new Date().toISOString(),
      dataUrl: resizedImage.dataUrl,
      mimeType: resizedImage.mimeType,
      width: resizedImage.width,
      height: resizedImage.height
    };
    const account: Account = {
      id: createId(),
      createdAt: new Date().toISOString(),
      name: input.name,
      logoAssetId: asset.id,
      balanceCents: input.balanceCents,
      sortOrder: currentVault.accounts.length
    };

    await persistVaultState({
      ...currentVault,
      accounts: [...currentVault.accounts, account],
      assets: [...currentVault.assets, asset]
    });
  }

  async function unlock(pin: string): Promise<UnlockResult> {
    if (!settings) {
      return {
        ok: false,
        message: 'Set up the app before unlocking it.'
      };
    }

    const normalizedSettings = normalizeSecuritySettings(settings) ?? settings;

    if (normalizedSettings !== settings) {
      settingsRepo.save(normalizedSettings);
      setSettings(normalizedSettings);
    }

    const lockoutUntilMs = normalizedSettings.lockoutUntilISO
      ? new Date(normalizedSettings.lockoutUntilISO).getTime()
      : null;

    if (lockoutUntilMs && lockoutUntilMs > Date.now()) {
      return {
        ok: false,
        message: lockoutMessage(lockoutUntilMs - Date.now())
      };
    }

    const unlockResult = isLegacySecuritySettings(normalizedSettings)
      ? await migrateLegacyPlaintextVault(pin, normalizedSettings)
      : await unlockSecureVault(pin, normalizedSettings);

    if (unlockResult) {
      sessionKeyRef.current = unlockResult.key;
      applyVaultToState(unlockResult.vault);
      const baseUnlockedSettings =
        (unlockResult as { nextSettings?: AppSettings }).nextSettings ?? normalizedSettings;

      const unlockedSettings: AppSettings = {
        ...baseUnlockedSettings,
        failedUnlockAttempts: 0,
        lockoutUntilISO: undefined
      };

      settingsRepo.save(unlockedSettings);
      setSettings(unlockedSettings);
      setBootStatus('ready');

      return { ok: true };
    }

    const failedUnlockAttempts = (normalizedSettings.failedUnlockAttempts ?? 0) + 1;
    const lockoutDurationMs = nextLockoutDurationMs(failedUnlockAttempts);
    const nextSettings: AppSettings = {
      ...normalizedSettings,
      failedUnlockAttempts,
      lockoutUntilISO:
        lockoutDurationMs > 0 ? new Date(Date.now() + lockoutDurationMs).toISOString() : undefined
    };

    settingsRepo.save(nextSettings);
    setSettings(nextSettings);

    return {
      ok: false,
      message:
        lockoutDurationMs > 0
          ? lockoutMessage(lockoutDurationMs)
          : 'Incorrect PIN. Try again.'
    };
  }

  async function quickAdjustBalance(accountId: string, deltaCents: number) {
    ensureFiveIncrement(deltaCents);

    const nextAccounts = currentVault.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      const nextBalance = account.balanceCents + deltaCents;
      ensureFiveIncrement(nextBalance);

      return {
        ...account,
        balanceCents: nextBalance
      };
    });

    await persistVaultState({
      ...currentVault,
      accounts: nextAccounts
    });
  }

  async function addExpense(input: AddExpenseInput) {
    ensureFiveIncrement(input.amountCents);

    const expense: Expense = {
      id: createId(),
      createdAt: new Date().toISOString(),
      accountId: input.accountId,
      name: input.name,
      dateISO: input.dateISO,
      amountCents: input.amountCents
    };
    const nextAccounts = currentVault.accounts.map((account) =>
      account.id === input.accountId
        ? {
            ...account,
            balanceCents: account.balanceCents - input.amountCents
          }
        : account
    );

    await persistVaultState({
      ...currentVault,
      accounts: nextAccounts,
      expenses: [expense, ...currentVault.expenses]
    });
  }

  async function deleteExpense(expenseId: string) {
    const expense = currentVault.expenses.find((entry) => entry.id === expenseId);

    if (!expense) {
      return;
    }

    const nextAccounts = currentVault.accounts.map((account) =>
      account.id === expense.accountId
        ? {
            ...account,
            balanceCents: account.balanceCents + expense.amountCents
          }
        : account
    );

    await persistVaultState({
      ...currentVault,
      accounts: nextAccounts,
      expenses: currentVault.expenses.filter((entry) => entry.id !== expenseId)
    });
  }

  async function addWishlistItem(input: AddWishlistInput) {
    const resizedImage = await resizeImageToDataUrl(input.imageFile);
    const asset: AssetRecord = {
      id: createId(),
      createdAt: new Date().toISOString(),
      dataUrl: resizedImage.dataUrl,
      mimeType: resizedImage.mimeType,
      width: resizedImage.width,
      height: resizedImage.height
    };
    const wishlistItem: WishlistItem = {
      id: createId(),
      createdAt: new Date().toISOString(),
      imageAssetId: asset.id,
      name: input.name,
      priceCents: input.priceCents,
      url: input.url
    };

    await persistVaultState({
      ...currentVault,
      wishlistItems: [wishlistItem, ...currentVault.wishlistItems],
      assets: [...currentVault.assets, asset]
    });
  }

  async function deleteWishlistItem(wishlistItemId: string) {
    const wishlistItem = currentVault.wishlistItems.find((entry) => entry.id === wishlistItemId);

    if (!wishlistItem) {
      return;
    }

    await persistVaultState({
      ...currentVault,
      wishlistItems: currentVault.wishlistItems.filter(
        (entry) => entry.id !== wishlistItemId
      ),
      assets: currentVault.assets.filter((asset) => asset.id !== wishlistItem.imageAssetId)
    });
  }

  async function resetApp() {
    await clearAllLocalData();
    setSettings(null);
    clearSensitiveState();
    setBootStatus('setup');
    window.location.hash = '#/';
  }

  return (
    <BudgetAppContext.Provider
      value={{
        bootStatus,
        settings,
        accounts,
        expenses,
        wishlistItems,
        assets,
        completeSetup,
        addAccount,
        unlock,
        lock,
        quickAdjustBalance,
        addExpense,
        deleteExpense,
        addWishlistItem,
        deleteWishlistItem,
        resetApp
      }}
    >
      {children}
    </BudgetAppContext.Provider>
  );
}

export function useBudgetApp() {
  const context = useContext(BudgetAppContext);

  if (!context) {
    throw new Error('useBudgetApp must be used within BudgetAppProvider.');
  }

  return context;
}
