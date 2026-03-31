import { createContext, useContext, useEffect, useState } from 'react';
import type {
  Account,
  AddAccountInput,
  AddExpenseInput,
  AddWantInput,
  AppSettings,
  AssetRecord,
  Expense,
  SetupAccountInput,
  WantItem
} from '../../lib/types';
import {
  accountsRepo,
  assetsRepo,
  clearAllLocalData,
  expensesRepo,
  settingsRepo,
  wantsRepo
} from '../../lib/storage/repositories';
import { resizeImageToDataUrl } from '../../lib/utils/image';
import { createId } from '../../lib/utils/id';
import { hashPin, verifyPin } from '../../lib/utils/pin';
import { ensureFiveIncrement } from '../../lib/utils/money';

type BootStatus = 'loading' | 'setup' | 'locked' | 'ready';

type BudgetAppContextValue = {
  bootStatus: BootStatus;
  settings: AppSettings | null;
  accounts: Account[];
  expenses: Expense[];
  wants: WantItem[];
  assets: Record<string, AssetRecord>;
  completeSetup: (pin: string, accountInputs: SetupAccountInput[]) => Promise<void>;
  addAccount: (input: AddAccountInput) => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
  quickAdjustBalance: (accountId: string, deltaCents: number) => Promise<void>;
  addExpense: (input: AddExpenseInput) => Promise<void>;
  deleteExpense: (expenseId: string) => Promise<void>;
  addWant: (input: AddWantInput) => Promise<void>;
  deleteWant: (wantId: string) => Promise<void>;
  resetApp: () => Promise<void>;
};

const BudgetAppContext = createContext<BudgetAppContextValue | undefined>(undefined);

async function loadAllData() {
  const [accounts, expenses, wants, assets] = await Promise.all([
    accountsRepo.list(),
    expensesRepo.listAll(),
    wantsRepo.list(),
    assetsRepo.listAll()
  ]);

  return {
    accounts,
    expenses,
    wants,
    assets: Object.fromEntries(assets.map((asset) => [asset.id, asset]))
  };
}

export function BudgetAppProvider({ children }: { children: React.ReactNode }) {
  const [bootStatus, setBootStatus] = useState<BootStatus>('loading');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [wants, setWants] = useState<WantItem[]>([]);
  const [assets, setAssets] = useState<Record<string, AssetRecord>>({});

  async function saveAccountWithLogo(
    input: Pick<AddAccountInput, 'name' | 'balanceCents' | 'logoFile'>,
    sortOrder?: number
  ) {
    const resizedImage = await resizeImageToDataUrl(input.logoFile);
    const savedAsset = await assetsRepo.save(resizedImage);
    const account =
      typeof sortOrder === 'number'
        ? {
            id: createId(),
            name: input.name,
            logoAssetId: savedAsset.id,
            balanceCents: input.balanceCents,
            sortOrder,
            createdAt: new Date().toISOString()
          }
        : await accountsRepo.create({
            name: input.name,
            balanceCents: input.balanceCents,
            logoAssetId: savedAsset.id
          });

    return { account, asset: savedAsset };
  }

  useEffect(() => {
    async function bootstrap() {
      const nextSettings = settingsRepo.get();

      if (!nextSettings?.isSeeded || !nextSettings.pinHash) {
        setSettings(null);
        setAccounts([]);
        setExpenses([]);
        setWants([]);
        setAssets({});
        setBootStatus('setup');
        return;
      }

      const data = await loadAllData();
      setSettings(nextSettings);
      setAccounts(data.accounts);
      setExpenses(data.expenses);
      setWants(data.wants);
      setAssets(data.assets);
      setBootStatus('locked');
    }

    void bootstrap();
  }, []);

  async function completeSetup(pin: string, accountInputs: SetupAccountInput[]) {
    const pinHash = await hashPin(pin);
    const seededAccounts: Account[] = [];
    const nextAssets: Record<string, AssetRecord> = {};

    for (let index = 0; index < accountInputs.length; index += 1) {
      const accountInput = accountInputs[index];
      const { account, asset } = await saveAccountWithLogo(accountInput, index);

      seededAccounts.push(account);
      nextAssets[asset.id] = asset;
    }

    await accountsRepo.seedStarterAccounts(seededAccounts);

    const nextSettings: AppSettings = {
      pinHash,
      isSeeded: true
    };

    settingsRepo.save(nextSettings);

    setSettings(nextSettings);
    setAccounts(seededAccounts);
    setExpenses([]);
    setWants([]);
    setAssets(nextAssets);
    setBootStatus('locked');
  }

  async function addAccount(input: AddAccountInput) {
    ensureFiveIncrement(input.balanceCents);
    const { account, asset } = await saveAccountWithLogo(input);

    setAccounts((currentAccounts) => [...currentAccounts, account]);
    setAssets((currentAssets) => ({
      ...currentAssets,
      [asset.id]: asset
    }));
  }

  async function unlock(pin: string): Promise<boolean> {
    if (!settings) {
      return false;
    }

    const matches = await verifyPin(pin, settings.pinHash);

    if (!matches) {
      return false;
    }

    const data = await loadAllData();
    setAccounts(data.accounts);
    setExpenses(data.expenses);
    setWants(data.wants);
    setAssets(data.assets);
    setBootStatus('ready');
    return true;
  }

  function lock() {
    if (settings?.isSeeded) {
      setBootStatus('locked');
    }
  }

  async function quickAdjustBalance(accountId: string, deltaCents: number) {
    ensureFiveIncrement(deltaCents);
    const updatedAccount = await accountsRepo.updateBalance(accountId, deltaCents);

    setAccounts((currentAccounts) =>
      currentAccounts.map((account) =>
        account.id === updatedAccount.id ? updatedAccount : account
      )
    );
  }

  async function addExpense(input: AddExpenseInput) {
    ensureFiveIncrement(input.amountCents);
    const savedExpense = await expensesRepo.create(input);
    const updatedAccount = await accountsRepo.updateBalance(input.accountId, -input.amountCents);

    setExpenses((currentExpenses) =>
      [savedExpense, ...currentExpenses].sort((left, right) => {
        if (left.dateISO !== right.dateISO) {
          return right.dateISO.localeCompare(left.dateISO);
        }

        return right.createdAt.localeCompare(left.createdAt);
      })
    );
    setAccounts((currentAccounts) =>
      currentAccounts.map((account) =>
        account.id === updatedAccount.id ? updatedAccount : account
      )
    );
  }

  async function deleteExpense(expenseId: string) {
    const expense = expenses.find((entry) => entry.id === expenseId);

    if (!expense) {
      return;
    }

    await expensesRepo.delete(expenseId);
    const updatedAccount = await accountsRepo.updateBalance(expense.accountId, expense.amountCents);

    setExpenses((currentExpenses) =>
      currentExpenses.filter((entry) => entry.id !== expenseId)
    );
    setAccounts((currentAccounts) =>
      currentAccounts.map((account) =>
        account.id === updatedAccount.id ? updatedAccount : account
      )
    );
  }

  async function addWant(input: AddWantInput) {
    const resizedImage = await resizeImageToDataUrl(input.imageFile);
    const savedAsset = await assetsRepo.save(resizedImage);
    const want = await wantsRepo.create({
      name: input.name,
      priceCents: input.priceCents,
      url: input.url,
      imageAssetId: savedAsset.id
    });

    setAssets((currentAssets) => ({
      ...currentAssets,
      [savedAsset.id]: savedAsset
    }));
    setWants((currentWants) =>
      [want, ...currentWants].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
      )
    );
  }

  async function deleteWant(wantId: string) {
    const want = wants.find((entry) => entry.id === wantId);

    if (!want) {
      return;
    }

    await wantsRepo.delete(wantId);
    await assetsRepo.delete(want.imageAssetId);

    setWants((currentWants) => currentWants.filter((entry) => entry.id !== wantId));
    setAssets((currentAssets) => {
      const nextAssets = { ...currentAssets };
      delete nextAssets[want.imageAssetId];
      return nextAssets;
    });
  }

  async function resetApp() {
    await clearAllLocalData();
    setSettings(null);
    setAccounts([]);
    setExpenses([]);
    setWants([]);
    setAssets({});
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
        wants,
        assets,
        completeSetup,
        addAccount,
        unlock,
        lock,
        quickAdjustBalance,
        addExpense,
        deleteExpense,
        addWant,
        deleteWant,
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
