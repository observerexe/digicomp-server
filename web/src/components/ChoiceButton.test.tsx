import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceButton } from './ChoiceButton';

const choices = [
  { id: null, title: 'Порожній документ' },
  { id: 'a', title: 'Акт' },
];

describe('ChoiceButton', () => {
  it('дотик до затемнення під меню (телефон) закриває меню без вибору', async () => {
    const onPick = vi.fn();
    const { container } = render(<ChoiceButton label="Новий документ" choices={choices} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Новий документ' }));
    expect(screen.getByRole('menu', { name: 'Новий документ' })).toBeInTheDocument();
    await userEvent.click(container.querySelector('div[aria-hidden="true"]')!);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('вибір пункту закриває меню й передає вибране', async () => {
    const onPick = vi.fn();
    const { container } = render(<ChoiceButton label="Новий документ" choices={choices} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Новий документ' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Акт' }));
    expect(onPick).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(container.querySelector('div[aria-hidden="true"]')).toBeNull();
  });
});
