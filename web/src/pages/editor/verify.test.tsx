import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PaperVerify } from '../../api/types';
import { json, member, mockApi, renderApp } from '../../test/render';

const SHA = 'ab'.repeat(32);
const checked = (over: Partial<PaperVerify> = {}): PaperVerify => ({
  sha256: SHA,
  n: 1,
  latest: true,
  frozenAt: '2026-11-21T08:15:00Z',
  frozenBy: { id: 'm1', name: 'Андрій Шевчук' },
  number: 'ТЗ-2026-014',
  title: 'Технічне завдання',
  status: 'frozen',
  cancelReason: null,
  paperId: 'p1',
  signatures: [],
  ...over,
});
const api = (res: () => Response) => ({
  'GET /api/auth/me': () => json(200, member),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  [`GET /api/papers/verify/${SHA}`]: res,
});

describe('Перевірка документа за QR', () => {
  it('справжній: номер, стан, хто й коли зафіксував, код; відкрити й надрукувати цей знімок', async () => {
    mockApi(api(() => json(200, checked())));
    renderApp(`/papers/verify/${SHA}`);
    expect(await screen.findByText('Документ справжній')).toBeInTheDocument();
    expect(screen.getByText('Технічне завдання · № ТЗ-2026-014')).toBeInTheDocument();
    expect(screen.getByText('Зафіксовано', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/Андрій Шевчук$/)).toBeInTheDocument();
    expect(screen.getByText(SHA)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити документ' })).toHaveAttribute('href', '/editor/p1');
    expect(screen.getByRole('link', { name: 'Друк цього знімка' })).toHaveAttribute('href', '/api/papers/p1/print?snapshot=1');
  });

  it('графічні підписи: хто й коли підписав, кого ще чекає рядок', async () => {
    mockApi(
      api(() =>
        json(
          200,
          checked({
            signatures: [
              { label: 'Затверджую', name: 'Артур Машталер', signedAt: '2026-11-21T09:00:00Z' },
              { label: 'Роботу прийняв', name: 'Олена Коваль', signedAt: null },
            ],
          }),
        ),
      ),
    );
    renderApp(`/papers/verify/${SHA}`);
    expect(await screen.findByText('Затверджую')).toBeInTheDocument();
    expect(screen.getByText(/^Артур Машталер · підписано .*21 лист\., 11:00$/)).toBeInTheDocument();
    expect(screen.getByText('Роботу прийняв')).toBeInTheDocument();
    expect(screen.getByText('Олена Коваль · підпису в DigiComp HUB ще немає')).toBeInTheDocument();
  });

  it('скасований і не останній — так і сказано; без доступу — без посилань', async () => {
    mockApi(api(() => json(200, checked({ status: 'cancelled', cancelReason: 'помилка в балах', latest: false, paperId: null }))));
    renderApp(`/papers/verify/${SHA}`);
    expect(await screen.findByText('Документ справжній, але його скасовано')).toBeInTheDocument();
    expect(screen.getByText('Причина: помилка в балах')).toBeInTheDocument();
    expect(screen.getByText('Це не остання версія документа: є новіший знімок.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Відкрити документ' })).not.toBeInTheDocument();
    expect(screen.getByText('Сам документ вам недоступний: перевірка лише підтверджує, що папір справжній.')).toBeInTheDocument();
  });

  it('невідомий код — «Не підтверджено»', async () => {
    mockApi(api(() => json(404, { statusCode: 404, message: 'Paper snapshot not found', errorCode: 'PAPER_SNAPSHOT_NOT_FOUND' })));
    renderApp(`/papers/verify/${SHA}`);
    expect(await screen.findByText('Не підтверджено')).toBeInTheDocument();
    expect(screen.getByText('Документа з таким кодом перевірки немає: папір не справжній або код уведено з помилкою.')).toBeInTheDocument();
  });
});
