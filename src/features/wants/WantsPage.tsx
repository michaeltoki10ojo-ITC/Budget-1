import { useState } from 'react';
import { useBudgetApp } from '../../app/state/BudgetAppContext';
import { formatCurrency, sumCents } from '../../lib/utils/money';
import type { AddWantInput } from '../../lib/types';
import { WantFormSheet } from './WantFormSheet';
import styles from './WantsPage.module.css';

export function WantsPage() {
  const { wants, assets, addWant, deleteWant } = useBudgetApp();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const totalWanted = sumCents(wants.map((want) => want.priceCents));

  async function handleAddWant(input: AddWantInput) {
    setIsSubmitting(true);

    try {
      await addWant(input);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className={styles.page}>
        <section className={styles.totalCard}>
          <p className={styles.totalLabel}>Running total</p>
          <h2 className={styles.totalValue}>{formatCurrency(totalWanted)}</h2>
          <p className={styles.totalCaption}>
            Save the things you want to buy later, complete with photo and link.
          </p>
        </section>

        <section className={styles.wantList}>
          {wants.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No wants yet</h3>
              <p>Tap the plus button to create your first wish-list item.</p>
            </div>
          ) : (
            wants.map((want) => {
              const image = assets[want.imageAssetId];

              return (
                <article key={want.id} className={styles.wantCard}>
                  <div className={styles.imageFrame}>
                    {image ? (
                      <img src={image.dataUrl} alt={want.name} />
                    ) : (
                      <span>{want.name.slice(0, 1)}</span>
                    )}
                  </div>

                  <div className={styles.wantMeta}>
                    <h3>{want.name}</h3>
                    <p>{formatCurrency(want.priceCents)}</p>
                    <div className={styles.actions}>
                      <a
                        href={want.url}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.linkButton}
                      >
                        Open link
                      </a>
                      <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={() => {
                          if (window.confirm(`Delete "${want.name}" from your wants list?`)) {
                            void deleteWant(want.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>

        <button type="button" className={styles.fab} onClick={() => setIsSheetOpen(true)}>
          +
        </button>
      </div>

      <WantFormSheet
        isOpen={isSheetOpen}
        isSubmitting={isSubmitting}
        onClose={() => {
          if (!isSubmitting) {
            setIsSheetOpen(false);
          }
        }}
        onSubmit={handleAddWant}
      />
    </>
  );
}
