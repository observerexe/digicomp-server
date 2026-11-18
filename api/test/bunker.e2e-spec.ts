import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { BunkerRoom } from '../src/bunker/bunker.entities';
import {
  BunkerRoomsService,
  IDLE_MS,
} from '../src/bunker/bunker-rooms.service';
import type { GameState } from '../src/bunker/engine';
import type {
  BunkerPackDetailDto,
  BunkerRoomDto,
} from '../src/bunker/responses.dto';
import { Bunker1834000000000 } from '../src/migrations/1834000000000-Bunker';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, type TestUser } from './helpers';

// «Розваги» → «Бункер»: карти, паки, кімнати й гра через API
// (правила гри окремо — src/bunker/engine.spec.ts).

describe('Бункер (e2e)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let mod: TestUser;
  let mod2: TestUser;
  let u: TestUser[];

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const q = app.get(DataSource).createQueryRunner();
    try {
      await Bunker1834000000000.insertBasePack(q);
    } finally {
      await q.release();
    }
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    mod2 = await makeUser(app, Role.Moderator);
    u = [];
    for (let i = 0; i < 6; i++) u.push(await makeUser(app, Role.Member));
  });

  const audit = (action: string) =>
    app
      .get(DataSource)
      .getRepository(AuditLog)
      .findBy({ action: action as never });

  describe('Карти', () => {
    it('учасник створює й змінює свою карту; чужу — ні', async () => {
      const c = await as(app, u[0])
        .post('/api/bunker/cards')
        .send({ kind: 'profession', text: '  Оператор 3D-принтера ' })
        .expect(201);
      expect(c.body).toMatchObject({
        text: 'Оператор 3D-принтера',
        canEdit: true,
        builtin: false,
        author: { id: u[0].id },
      });
      await as(app, u[0])
        .patch(`/api/bunker/cards/${c.body.id}`)
        .send({ text: 'Лаборант' })
        .expect(200);
      const r = await as(app, u[1])
        .patch(`/api/bunker/cards/${c.body.id}`)
        .send({ text: 'Ні' })
        .expect(403);
      expect(r.body.errorCode).toBe('FORBIDDEN');
      expect(await audit('bunker.card_created')).toHaveLength(1);
    });

    it('модератор змінює й видаляє карту учасника (в аудит), модератора — ні', async () => {
      const own = await as(app, u[0])
        .post('/api/bunker/cards')
        .send({ kind: 'hobby', text: 'Щось недоречне' });
      await as(app, mod)
        .patch(`/api/bunker/cards/${own.body.id}`)
        .send({ text: 'Шахи' })
        .expect(200);
      const logged = await audit('bunker.card_updated');
      expect(logged[0]).toMatchObject({
        actorId: mod.id,
        meta: { authorId: u[0].id },
      });
      const other = await as(app, mod2)
        .post('/api/bunker/cards')
        .send({ kind: 'hobby', text: 'Біг' });
      const r = await as(app, mod)
        .delete(`/api/bunker/cards/${other.body.id}`)
        .expect(403);
      expect(r.body.errorCode).toBe('TARGET_ROLE_FORBIDDEN');
      await as(app, admin)
        .delete(`/api/bunker/cards/${other.body.id}`)
        .expect(200);
      await as(app, mod).delete(`/api/bunker/cards/${own.body.id}`).expect(200);
      expect(await audit('bunker.card_deleted')).toHaveLength(2);
    });

    it('карту Базового пака не змінює ніхто', async () => {
      const list = await as(app, admin)
        .get('/api/bunker/cards?kind=fact&limit=1')
        .expect(200);
      expect(list.body.items[0]).toMatchObject({
        builtin: true,
        canEdit: false,
        author: null,
      });
      const r = await as(app, admin)
        .patch(`/api/bunker/cards/${list.body.items[0].id}`)
        .send({ text: 'x' })
        .expect(403);
      expect(r.body.errorCode).toBe('BUNKER_BUILTIN');
    });

    it.each([
      [{ kind: 'catastrophe', text: 'Без назви' }, 'title'],
      [{ kind: 'special', text: 'Без дії' }, 'effect'],
      [{ kind: 'special', text: 'Обмін', effect: 'swap' }, 'effectKind'],
      [{ kind: 'hobby', text: 'x'.repeat(141) }, 'text'],
    ])(
      'неправильна карта %j — BUNKER_CARD_INVALID (%s)',
      async (body, field) => {
        const r = await as(app, u[0])
          .post('/api/bunker/cards')
          .send(body)
          .expect(400);
        expect(r.body).toMatchObject({
          errorCode: 'BUNKER_CARD_INVALID',
          field,
        });
      },
    );

    it('назва й дія, яких вид карти не має, відкидаються', async () => {
      const r = await as(app, u[0])
        .post('/api/bunker/cards')
        .send({
          kind: 'profession',
          title: 'Зайве',
          text: 'Кухар',
          effect: 'swap',
        })
        .expect(201);
      expect(r.body).toMatchObject({
        title: '',
        effect: null,
        effectKind: null,
      });
    });

    it('пошук і «лише мої»', async () => {
      await as(app, u[0])
        .post('/api/bunker/cards')
        .send({ kind: 'baggage', text: 'Паяльна станція Hakko' });
      const mine = await as(app, u[0])
        .get('/api/bunker/cards?mine=true')
        .expect(200);
      expect(mine.body.total).toBe(1);
      const found = await as(app, u[1])
        .get('/api/bunker/cards?search=hakko')
        .expect(200);
      expect(found.body.items.map((c: { text: string }) => c.text)).toEqual([
        'Паяльна станція Hakko',
      ]);
    });
  });

  describe('Паки', () => {
    it('пак: створити, додати карти, нова карта одразу в пак, прибрати, видалити', async () => {
      const p = await as(app, u[0])
        .post('/api/bunker/packs')
        .send({ name: 'Лабораторні' })
        .expect(201);
      const lib = await as(app, u[0]).get(
        '/api/bunker/cards?kind=phobia&limit=2',
      );
      const ids = lib.body.items.map((c: { id: string }) => c.id);
      await as(app, u[0])
        .post(`/api/bunker/packs/${p.body.id}/cards`)
        .send({ cardIds: ids })
        .expect(201);
      const made = await as(app, u[0])
        .post('/api/bunker/cards')
        .send({
          kind: 'special',
          text: 'Ваш голос — подвійний',
          effect: 'double_vote',
          packId: p.body.id,
        })
        .expect(201);
      let pack = (
        await as(app, u[0]).get(`/api/bunker/packs/${p.body.id}`).expect(200)
      ).body as BunkerPackDetailDto;
      expect(pack.cardCount).toBe(3);
      expect(pack.counts.find((c) => c.kind === 'phobia')!.count).toBe(2);
      const notIn = await as(app, u[0]).get(
        `/api/bunker/cards?kind=phobia&notInPack=${p.body.id}&limit=100`,
      );
      expect(
        notIn.body.items.some((c: { id: string }) => ids.includes(c.id)),
      ).toBe(false);
      pack = (
        await as(app, u[0])
          .delete(`/api/bunker/packs/${p.body.id}/cards/${ids[0]}`)
          .expect(200)
      ).body;
      expect(pack.cardCount).toBe(2);
      await as(app, u[1])
        .post(`/api/bunker/packs/${p.body.id}/cards`)
        .send({ cardIds: [ids[0]] })
        .expect(403);
      await as(app, u[0]).delete(`/api/bunker/packs/${p.body.id}`).expect(200);
      await as(app, u[0])
        .patch(`/api/bunker/cards/${made.body.id}`)
        .send({ text: 'Лишилася в бібліотеці' })
        .expect(200);
    });

    it('копія Базового — свій пак з тими самими картами; Базовий не змінюється', async () => {
      const list = await as(app, u[0]).get('/api/bunker/packs').expect(200);
      const base = list.body.items[0];
      expect(base).toMatchObject({ builtin: true, canEdit: false });
      const r = await as(app, admin)
        .patch(`/api/bunker/packs/${base.id}`)
        .send({ name: 'x' })
        .expect(403);
      expect(r.body.errorCode).toBe('BUNKER_BUILTIN');
      const copy = await as(app, u[0])
        .post('/api/bunker/packs')
        .send({ name: 'Мій', copyOf: base.id })
        .expect(201);
      expect(copy.body).toMatchObject({
        canEdit: true,
        builtin: false,
        cardCount: base.cardCount,
      });
    });

    it('експорт і імпорт: картки імпорту — нові, свої', async () => {
      const p = await as(app, u[0])
        .post('/api/bunker/packs')
        .send({ name: 'Свій' });
      await as(app, u[0]).post('/api/bunker/cards').send({
        kind: 'catastrophe',
        title: 'Холод',
        text: 'Мінус сорок',
        packId: p.body.id,
      });
      const file = await as(app, u[0])
        .get(`/api/bunker/packs/${p.body.id}/export`)
        .expect(200);
      expect(file.body).toMatchObject({
        format: 'digicomp-bunker-pack',
        cards: [{ kind: 'catastrophe', title: 'Холод' }],
      });
      const imported = await as(app, u[1])
        .post('/api/bunker/packs/import')
        .send(file.body)
        .expect(201);
      expect(imported.body).toMatchObject({
        name: 'Свій',
        cardCount: 1,
        author: { id: u[1].id },
      });
      expect(imported.body.cards[0].author.id).toBe(u[1].id);
      await as(app, u[1])
        .post('/api/bunker/packs/import')
        .send({
          ...file.body,
          cards: [{ kind: 'threat', text: 'Без назви' }],
        })
        .expect(400);
    });
  });

  describe('Кімнати', () => {
    const room = (who: TestUser, over: object = {}) =>
      as(app, who)
        .post('/api/bunker/rooms')
        .send({
          name: 'Пара після обіду',
          packIds: [],
          maxPlayers: 8,
          turnSeconds: 60,
          hostPlays: true,
          ...over,
        });

    async function lobby(players: TestUser[]) {
      const r = await room(players[0]).expect(201);
      for (const p of players.slice(1))
        await as(app, p)
          .post(`/api/bunker/rooms/${r.body.id}/join`)
          .expect(201);
      return r.body.id as string;
    }

    const state = async (id: string) =>
      (
        await app
          .get(DataSource)
          .getRepository(BunkerRoom)
          .findOneByOrFail({ id })
      ).state as GameState;

    it('кімната видна всім, у ній — лише свої; одна кімната на людину', async () => {
      const id = await lobby([u[0], u[1]]);
      const list = await as(app, u[2]).get('/api/bunker/rooms').expect(200);
      expect(list.body).toMatchObject({
        myRoomId: null,
        items: [
          { id, status: 'lobby', members: [{ id: u[0].id }, { id: u[1].id }] },
        ],
      });
      const r = await as(app, u[2]).get(`/api/bunker/rooms/${id}`).expect(403);
      expect(r.body.errorCode).toBe('BUNKER_NOT_IN_ROOM');
      const again = await room(u[1]).expect(409);
      expect(again.body.errorCode).toBe('BUNKER_ALREADY_IN_ROOM');
      expect(await audit('bunker.room_created')).toHaveLength(1);
    });

    it('почати можна від 4 гравців і лише ведучому', async () => {
      const id = await lobby([u[0], u[1], u[2]]);
      expect(
        (await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(409))
          .body.errorCode,
      ).toBe('BUNKER_TOO_FEW_PLAYERS');
      await as(app, u[3]).post(`/api/bunker/rooms/${id}/join`).expect(201);
      expect(
        (await as(app, u[1]).post(`/api/bunker/rooms/${id}/start`).expect(403))
          .body.errorCode,
      ).toBe('BUNKER_NOT_HOST');
      await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201);
      expect(
        (await as(app, u[4]).post(`/api/bunker/rooms/${id}/join`).expect(409))
          .body.errorCode,
      ).toBe('BUNKER_STARTED');
    });

    it('кімната повна — більше не приєднатися; ведучий, що не грає, місця не займає', async () => {
      const id = (
        await room(u[0], { maxPlayers: 4, hostPlays: false }).expect(201)
      ).body.id;
      for (const p of u.slice(1, 5))
        await as(app, p).post(`/api/bunker/rooms/${id}/join`).expect(201);
      const r = await as(app, u[5])
        .post(`/api/bunker/rooms/${id}/join`)
        .expect(409);
      expect(r.body.errorCode).toBe('BUNKER_ROOM_FULL');
      const started = (
        await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201)
      ).body as BunkerRoomDto;
      expect(started.game!.players.map((p) => p.userId)).not.toContain(u[0].id);
      expect(started.game!.me).toBeNull();
    });

    it('кожен бачить свої карти, чужі — лише відкриті', async () => {
      const id = await lobby(u.slice(0, 4));
      await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201);
      const s = await state(id);
      for (const p of u.slice(0, 4)) {
        const v = (await as(app, p).get(`/api/bunker/rooms/${id}`).expect(200))
          .body as BunkerRoomDto;
        const real = s.players.find((x) => x.userId === p.id)!;
        expect(v.game!.me!.cards.map((c) => c.text)).toEqual(
          v.game!.me!.cards.map((c) => real.cards[c.kind].text),
        );
        for (const other of v.game!.players.filter((x) => x.userId !== p.id)) {
          const o = s.players.find((x) => x.userId === other.userId)!;
          for (const c of other.cards)
            expect(c.text).toBe(
              o.revealed.includes(c.kind) ? o.cards[c.kind].text : null,
            );
        }
        expect(JSON.stringify(v)).not.toContain('"deck"');
        expect(v.game!.threat).toBeNull();
      }
    });

    it('гра через API до кінця: ходи, голосування, фінал, ще раз', async () => {
      const players = u.slice(0, 4);
      const id = await lobby(players);
      await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201);
      const who = (userId: string) => players.find((p) => p.id === userId)!;
      let v: BunkerRoomDto = (
        await as(app, u[0]).get(`/api/bunker/rooms/${id}`)
      ).body;
      for (let guard = 0; guard < 80 && v.status === 'playing'; guard++) {
        const g = v.game!;
        if (g.phase === 'turns') {
          const speaker = who(g.turn!.userId);
          const mine = (await as(app, speaker).get(`/api/bunker/rooms/${id}`))
            .body as BunkerRoomDto;
          const closed = mine.game!.me!.cards.find((c) => !c.revealed)!;
          await as(app, speaker)
            .post(`/api/bunker/rooms/${id}/actions`)
            .send({ type: 'reveal', kind: closed.kind })
            .expect(201);
          v = (
            await as(app, speaker)
              .post(`/api/bunker/rooms/${id}/actions`)
              .send({ type: 'end_turn' })
              .expect(201)
          ).body;
        } else if (g.phase === 'discussion') {
          const type =
            g.schedule[g.round - 1] > 0 ? 'start_vote' : 'next_round';
          v = (
            await as(app, u[0])
              .post(`/api/bunker/rooms/${id}/actions`)
              .send({ type })
              .expect(201)
          ).body;
        } else if (g.phase === 'voting') {
          const target = g.vote!.candidates[g.vote!.candidates.length - 1];
          for (const p of g.players.filter((x) => x.out === null)) {
            const to = p.userId === target ? g.vote!.candidates[0] : target;
            const r = await as(app, who(p.userId))
              .post(`/api/bunker/rooms/${id}/actions`)
              .send({ type: 'vote', targetId: to });
            v = r.body;
            if (v.game?.phase !== 'voting' || v.game.round !== g.round) break;
          }
        }
      }
      expect(v.status).toBe('finished');
      expect(v.game!.players.filter((p) => p.out === null)).toHaveLength(2);
      expect(v.game!.threat).not.toBeNull();
      expect(
        (
          await as(app, u[1])
            .post(`/api/bunker/rooms/${id}/restart`)
            .expect(403)
        ).body.errorCode,
      ).toBe('BUNKER_NOT_HOST');
      const back = await as(app, u[0])
        .post(`/api/bunker/rooms/${id}/restart`)
        .expect(201);
      expect(back.body).toMatchObject({ status: 'lobby', game: null });
      expect(back.body.members).toHaveLength(4);
    });

    it('не свій хід, вибулий і ведучий — стабільні коди', async () => {
      const id = await lobby(u.slice(0, 4));
      const v = (
        await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201)
      ).body as BunkerRoomDto;
      const notSpeaker = u
        .slice(0, 4)
        .find((p) => p.id !== v.game!.turn!.userId)!;
      const r = await as(app, notSpeaker)
        .post(`/api/bunker/rooms/${id}/actions`)
        .send({ type: 'reveal', kind: 'fact' })
        .expect(409);
      expect(r.body.errorCode).toBe('BUNKER_NOT_YOUR_TURN');
      const skip = await as(app, notSpeaker.id === u[0].id ? u[1] : notSpeaker)
        .post(`/api/bunker/rooms/${id}/actions`)
        .send({ type: 'skip_turn' })
        .expect(403);
      expect(skip.body.errorCode).toBe('BUNKER_NOT_HOST');
      await as(app, u[0])
        .post(`/api/bunker/rooms/${id}/actions`)
        .send({ type: 'reveal' })
        .expect(400);
    });

    it('час ходу вийшов — наступний запит сам відкриває карту й передає хід', async () => {
      const id = await lobby(u.slice(0, 4));
      const v = (
        await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201)
      ).body as BunkerRoomDto;
      const speaker = v.game!.turn!.userId;
      const repo = app.get(DataSource).getRepository(BunkerRoom);
      const s = await state(id);
      s.turn!.deadline = new Date(Date.now() - 1000).toISOString();
      await repo.update(id, { state: s as object });
      const after = (
        await as(app, u[1]).get(`/api/bunker/rooms/${id}`).expect(200)
      ).body as BunkerRoomDto;
      expect(after.game!.turn!.userId).not.toBe(speaker);
      expect(
        after.game!.log.some(
          (e) => e.type === 'timeout' && e.userId === speaker,
        ),
      ).toBe(true);
      expect(
        after
          .game!.players.find((p) => p.userId === speaker)!
          .cards.filter((c) => c.text),
      ).toHaveLength(2);
    });

    it('гравець вийшов посеред гри — вибув; ведучий вийшов — ведучим стає інший', async () => {
      const id = await lobby(u.slice(0, 4));
      await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201);
      await as(app, u[3]).post(`/api/bunker/rooms/${id}/leave`).expect(201);
      let v = (await as(app, u[1]).get(`/api/bunker/rooms/${id}`).expect(200))
        .body as BunkerRoomDto;
      expect(v.status).toBe('playing');
      expect(v.game!.players.find((p) => p.userId === u[3].id)).toMatchObject({
        out: 1,
        left: true,
      });
      expect((await room(u[1]).expect(409)).body.errorCode).toBe(
        'BUNKER_ALREADY_IN_ROOM',
      );
      // Two of four left: as many as there are places — the end.
      await as(app, u[0]).post(`/api/bunker/rooms/${id}/leave`).expect(201);
      v = (await as(app, u[1]).get(`/api/bunker/rooms/${id}`).expect(200)).body;
      expect(v.hostId).not.toBe(u[0].id);
      expect(v.members).toHaveLength(2);
      expect(v.status).toBe('finished');
      // From a finished game one goes to a new room at once.
      await room(u[1]).expect(201);
    });

    it('ведучий прибирає гравця — це в аудиті', async () => {
      const id = await lobby(u.slice(0, 3));
      await as(app, u[1])
        .delete(`/api/bunker/rooms/${id}/members/${u[2].id}`)
        .expect(403);
      const v = await as(app, u[0])
        .delete(`/api/bunker/rooms/${id}/members/${u[2].id}`)
        .expect(200);
      expect(v.body.members.map((m: { userId: string }) => m.userId)).toEqual([
        u[0].id,
        u[1].id,
      ]);
      expect((await audit('bunker.player_removed'))[0]).toMatchObject({
        actorId: u[0].id,
        meta: { userId: u[2].id },
      });
      await as(app, u[2]).post(`/api/bunker/rooms/${id}/join`).expect(201);
    });

    it('ведучий передає роль', async () => {
      const id = await lobby(u.slice(0, 2));
      const v = await as(app, u[0])
        .post(`/api/bunker/rooms/${id}/host`)
        .send({ userId: u[1].id })
        .expect(201);
      expect(v.body.hostId).toBe(u[1].id);
      await as(app, u[0])
        .patch(`/api/bunker/rooms/${id}`)
        .send({ name: 'x' })
        .expect(403);
      await as(app, u[1])
        .patch(`/api/bunker/rooms/${id}`)
        .send({ name: 'Нова назва', maxPlayers: 4 })
        .expect(200);
    });

    it('закрити кімнату: ведучий або модератор (в аудит); інший учасник — ні', async () => {
      const id = await lobby(u.slice(0, 2));
      await as(app, u[1]).delete(`/api/bunker/rooms/${id}`).expect(403);
      await as(app, mod).delete(`/api/bunker/rooms/${id}`).expect(200);
      expect((await audit('bunker.room_closed'))[0]).toMatchObject({
        actorId: mod.id,
        meta: { hostId: u[0].id },
      });
      await as(app, u[0]).get(`/api/bunker/rooms/${id}`).expect(404);
    });

    it('свій пак, де карт бракує, — решта з Базового; свої карти в роздачі', async () => {
      const p = await as(app, u[0])
        .post('/api/bunker/packs')
        .send({ name: 'Наш' });
      const ids: string[] = [];
      for (const text of [
        'Лаборант',
        'Оператор ЧПУ',
        'Наладчик',
        'Мехатронік',
      ]) {
        ids.push(
          (
            await as(app, u[0])
              .post('/api/bunker/cards')
              .send({ kind: 'profession', text, packId: p.body.id })
          ).body.id,
        );
      }
      const id = (await room(u[0], { packIds: [p.body.id] }).expect(201)).body
        .id;
      for (const x of u.slice(1, 4))
        await as(app, x).post(`/api/bunker/rooms/${id}/join`);
      await as(app, u[0]).post(`/api/bunker/rooms/${id}/start`).expect(201);
      const s = await state(id);
      expect(s.players.map((x) => x.cards.profession.id).sort()).toEqual(
        [...ids].sort(),
      );
      expect(s.players.every((x) => x.cards.health.id)).toBe(true);
    });

    it('кімнату без дій 6 годин сервер прибирає', async () => {
      const id = await lobby([u[0]]);
      await app
        .get(DataSource)
        .getRepository(BunkerRoom)
        .update(id, { lastActionAt: new Date(Date.now() - IDLE_MS - 1000) });
      expect(await app.get(BunkerRoomsService).cleanup()).toBe(1);
      await as(app, u[0]).get(`/api/bunker/rooms/${id}`).expect(404);
      expect((await audit('bunker.room_closed'))[0].meta).toMatchObject({
        reason: 'idle',
      });
      await room(u[0]).expect(201);
    });
  });
});
