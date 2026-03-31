import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { SetupFlow } from './SetupFlow';

const completeSetup = vi.fn();

vi.mock('../../app/state/BudgetAppContext', () => ({
  useBudgetApp: () => ({
    completeSetup
  })
}));

describe('SetupFlow', () => {
  it('moves from pin step to account setup when the pin is valid', async () => {
    const user = userEvent.setup();

    render(<SetupFlow />);

    await user.type(screen.getByLabelText(/create 4-digit pin/i), '1234');
    await user.type(screen.getByLabelText(/confirm pin/i), '1234');
    await user.click(screen.getByRole('button', { name: /continue to accounts/i }));

    expect(screen.getByText(/checking/i)).toBeInTheDocument();
    expect(screen.getByText(/finish setup/i)).toBeInTheDocument();
  });
});
