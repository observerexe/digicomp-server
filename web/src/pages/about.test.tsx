import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { json, member, mockApi, renderApp } from '../test/render';

describe('Про застосунок', () => {
  it('атрибуція шрифтів: e-Ukraine і Liberation Serif', async () => {
    mockApi({
      'GET /api/auth/me': () => json(200, member),
      'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    });
    renderApp('/about');
    expect(await screen.findByText(/Гарнітура e-Ukraine/)).toBeInTheDocument();
    expect(screen.getByText(/Liberation Serif © Google Corporation, Red Hat, Inc./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SIL Open Font License 1.1' })).toHaveAttribute('href', 'https://openfontlicense.org');
  });
});
