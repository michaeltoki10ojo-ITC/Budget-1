import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WantsPage } from './WantsPage';

const addWant = vi.fn();
const deleteWant = vi.fn();

vi.mock('../../app/state/BudgetAppContext', () => ({
  useBudgetApp: () => ({
    wants: [
      {
        id: 'want-1',
        name: 'Headphones',
        priceCents: 12999,
        imageAssetId: 'asset-1',
        url: 'https://example.com/headphones',
        createdAt: '2026-03-30T00:00:00.000Z'
      }
    ],
    assets: {
      'asset-1': {
        id: 'asset-1',
        dataUrl: 'data:image/png;base64,abc',
        mimeType: 'image/png',
        width: 48,
        height: 48,
        createdAt: '2026-03-30T00:00:00.000Z'
      }
    },
    addWant,
    deleteWant
  })
}));

describe('WantsPage', () => {
  it('shows the running total and opens the create form', async () => {
    const user = userEvent.setup();

    render(<WantsPage />);

    expect(screen.getAllByText('$129.99')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '+' }));

    expect(screen.getByText(/add something you’re saving for/i)).toBeInTheDocument();
  });
});
