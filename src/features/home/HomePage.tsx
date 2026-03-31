import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBudgetApp } from '../../app/state/BudgetAppContext';
import { formatCurrency, sumCents } from '../../lib/utils/money';
import styles from './HomePage.module.css';

export function HomePage() {
  const { accounts, assets } = useBudgetApp();
  const totalBalance = sumCents(accounts.map((account) => account.balanceCents));

  return (
    <div className={styles.page}>
      <section className={styles.summaryCard}>
        <p className={styles.summaryLabel}>Total tracked balance</p>
        <h2 className={styles.summaryValue}>{formatCurrency(totalBalance)}</h2>
        <p className={styles.summaryCaption}>Tap an account card to view expenses and make quick adjustments.</p>
      </section>

      <section className={styles.accountList}>
        {accounts.map((account) => {
          const logo = assets[account.logoAssetId];

          return (
            <Link key={account.id} to={`/account/${account.id}`} className={styles.linkCard}>
              <motion.article
                layoutId={`account-card-${account.id}`}
                className={styles.accountCard}
                whileTap={{ scale: 0.985 }}
              >
                <motion.div layoutId={`account-logo-${account.id}`} className={styles.logoShell}>
                  {logo ? (
                    <img src={logo.dataUrl} alt={`${account.name} logo`} className={styles.logoImage} />
                  ) : (
                    <span>{account.name.slice(0, 1)}</span>
                  )}
                </motion.div>

                <div className={styles.accountMeta}>
                  <p className={styles.accountName}>{account.name}</p>
                  <p className={styles.accountHint}>Open account details</p>
                </div>

                <motion.p layoutId={`account-balance-${account.id}`} className={styles.accountBalance}>
                  {formatCurrency(account.balanceCents)}
                </motion.p>
              </motion.article>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
