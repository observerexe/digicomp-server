import { MigrationInterface, QueryRunner } from 'typeorm';

type BaseCard =
  | { kind: string; text: string }
  | { kind: 'catastrophe' | 'threat'; title: string; text: string }
  | { kind: 'special'; text: string; effect: string; effectKind?: string };

const list = (kind: string, texts: string[]): BaseCard[] =>
  texts.map((text) => ({ kind, text }));

const titled = (
  kind: 'catastrophe' | 'threat',
  items: [string, string][],
): BaseCard[] => items.map(([title, text]) => ({ kind, title, text }));

const special = (
  effect: string,
  effectKind: string | undefined,
  text: string,
): BaseCard => ({
  kind: 'special',
  effect,
  effectKind,
  text,
});

const KIND_NAMES: Record<string, string> = {
  health: '«Здоров’я»',
  profession: '«Професія»',
  baggage: '«Багаж»',
  phobia: '«Фобія»',
  hobby: '«Хобі»',
  character: '«Характер»',
  fact: '«Факт»',
};

/**
 * «Базовий» — the pack that comes with the app: enough of every kind for 16
 * players and spare cards for «Нова карта». Read only; people copy it to
 * change. Written for a college group: nothing about sex, orientation or
 * cruelty. Checked by bunker/base-pack.spec.ts.
 */
export const BASE_PACK = {
  name: 'Базовий',
  description:
    'Пак, що йде із застосунком: усього вистачає на 16 гравців. Щоб змінити, зробіть копію.',
  cards: [
    ...titled('catastrophe', [
      [
        'Супервулкан',
        'Виверження вкрило континент попелом. Сонця не видно, урожаю не буде кілька років. Зв’язку з іншими сховищами немає.',
      ],
      [
        'Ядерна зима',
        'Після обміну ударами температура впала на двадцять градусів. Радіація на поверхні спадатиме роками.',
      ],
      [
        'Пандемія',
        'Новий вірус обійшов світ за тиждень. Хворіють тяжко, ліків поки немає. Вийти назовні — значить заразитися.',
      ],
      [
        'Падіння астероїда',
        'Уламок астероїда впав в океан. Цунамі, землетруси й пил в атмосфері. Міста на узбережжі зникли.',
      ],
      [
        'Повстання машин',
        'Штучний інтелект захопив енергосистеми й техніку. Будь-яка електроніка на поверхні може вистежити людей.',
      ],
      [
        'Глобальний потоп',
        'Льодовики розтанули за рік. Більшість суходолу під водою, вода прибуває далі.',
      ],
      [
        'Сонячний спалах',
        'Магнітна буря спалила електроніку по всій планеті. Немає світла, зв’язку, транспорту й водогону.',
      ],
      [
        'Невідомі кораблі',
        'Над містами зависли кораблі невідомого походження. Тих, хто лишається на поверхні, кудись забирають.',
      ],
      [
        'Отруйні спори',
        'З лабораторії вирвалися змінені рослини. Їхні спори отруйні, і вони розростаються всюди.',
      ],
      [
        'Великий холод',
        'Сонце раптом стало слабшим. Зима на поверхні триватиме роками, температура вночі — мінус сорок.',
      ],
    ]),
    ...list('bunker', [
      'Площа 120 м², три кімнати',
      'Запас консервів на рік',
      'Майстерня з інструментами',
      'Медпункт без ліків',
      'Медпункт із запасом ліків на пів року',
      'Радіостанція',
      'Генератор, пального на пів року',
      'Сонячні панелі на поверхні',
      'Свердловина з чистою водою',
      'Теплиця з лампами',
      'Бібліотека на п’ятсот книжок',
      'Невеликий спортзал',
      'Кухня з плитою й духовкою',
      'Душ і пральна машина',
      'Запас насіння овочів',
      'Курник на десять курей',
      'Комп’ютер з архівом знань',
      'Лише одна кімната на всіх',
      'Стеля протікає в дощ',
      'Майстерня з 3D-принтером',
      'Склад теплого одягу',
    ]),
    ...titled('threat', [
      [
        'Пошкоджений фільтр повітря',
        'За пів року повітря стане непридатним, якщо фільтр не полагодити.',
      ],
      [
        'Щури в коморі',
        'Щури дісталися до запасів їжі. Половину вже зіпсовано.',
      ],
      [
        'Тріщина в стіні',
        'Через тріщину просочується вода. Без ремонту нижню кімнату затопить.',
      ],
      [
        'Люди біля дверей',
        'Група людей ззовні щодня намагається потрапити всередину.',
      ],
      [
        'Пожежа в генераторній',
        'Генератор загорівся. Без нього не буде світла й тепла.',
      ],
      [
        'Інфекція',
        'Хтось приніс із собою інфекцію. За тиждень захворіють усі.',
      ],
      ['Зламаний замок', 'Двері бункера більше не зачиняються щільно.'],
      [
        'Дивна вода',
        'Вода у свердловині має дивний присмак, і від неї болить живіт.',
      ],
      [
        'Порожня аптечка',
        'Ліків виявилося вдвічі менше, ніж записано в описі бункера.',
      ],
      ['Обвал тунелю', 'Запасний вихід завалено. Розчищати доведеться вручну.'],
    ]),
    ...list('profession', [
      'Лікар-терапевт',
      'Хірург',
      'Медсестра',
      'Інженер-електрик',
      'Сантехнік',
      'Агроном',
      'Кухар',
      'Вчитель фізики',
      'Програміст',
      'Автомеханік',
      'Будівельник',
      'Ветеринар',
      'Хімік-технолог',
      'Фармацевт',
      'Психолог',
      'Зв’язківець',
      'Пекар',
      'Столяр',
      'Біолог',
      'Рятувальник ДСНС',
      'Пілот вертольота',
      'Бухгалтер',
      'Музикант',
      'Фермер',
      'Електрозварник',
    ]),
    ...list('biology', [
      '18 років',
      '19 років, зріст 190 см',
      '20 років, лівша',
      '21 рік, кульгає після травми',
      '23 роки',
      '25 років, спортивна статура',
      '27 років',
      '29 років, носить окуляри',
      '31 рік',
      '33 роки, погано спить',
      '34 роки, дуже сильний',
      '36 років',
      '38 років, невисокий',
      '41 рік',
      '44 роки, витривалий',
      '45 років, зайва вага',
      '47 років',
      '50 років',
      '53 роки, сивий, гострий зір',
      '56 років',
      '60 років, бадьорий',
      '63 роки',
      '67 років, повільно ходить',
      '70 років, ясна пам’ять',
    ]),
    ...list('health', [
      'Повністю здоровий',
      'Астма, легка форма',
      'Діабет 2 типу',
      'Алергія на пил',
      'Алергія на горіхи',
      'Високий тиск',
      'Короткозорість, без окулярів бачить погано',
      'Мігрені раз на тиждень',
      'Плоскостопість',
      'Слабкий імунітет, часто застуджується',
      'Залізне здоров’я, ніколи не хворів',
      'Хронічний гастрит',
      'Зламана рука, зростеться за місяць',
      'Погано чує на одне вухо',
      'Анемія, швидко втомлюється',
      'Безсоння',
      'Непритомніє від вигляду крові',
      'Сколіоз',
      'Хворе серце, потрібні ліки',
      'Дальтонізм',
      'Нещодавно оперували коліно',
      'Хропе на весь бункер',
      'Гострий зір і швидка реакція',
      'Хронічний кашель',
    ]),
    ...list('hobby', [
      'Гітара',
      'Рибалка',
      'Шахи',
      'Кулінарія',
      'Садівництво',
      'Радіоаматор',
      'Паяє електроніку',
      'Скелелазіння',
      'Малювання',
      'Читає фантастику',
      'Біг на довгі дистанції',
      'В’язання',
      'Робить меблі',
      'Фотографія',
      'Збирає гриби',
      'Вивчає мови, знає чотири',
      'Йога',
      'Настільні ігри',
      '3D-друк',
      'Стрільба з лука',
      'Астрономія',
      'Танці',
      'Ремонтує велосипеди',
      'Бджільництво',
    ]),
    ...list('phobia', [
      'Боїться темряви',
      'Боїться тісних приміщень',
      'Боїться висоти',
      'Боїться павуків',
      'Боїться крові',
      'Боїться води',
      'Боїться собак',
      'Боїться тиші',
      'Боїться натовпу',
      'Боїться змій',
      'Боїться грози',
      'Боїться вогню',
      'Боїться лікарів',
      'Боїться мікробів, постійно миє руки',
      'Боїться залишитися на самоті',
      'Боїться комах',
      'Боїться відкритого простору',
      'Боїться залишитися без зв’язку',
      'Боїться птахів',
      'Боїться дзеркал',
      'Боїться клоунів',
      'Боїться ухвалювати рішення',
      'Фобій немає',
      'Боїться голосних звуків',
    ]),
    ...list('character', [
      'Спокійний',
      'Запальний',
      'Лідер',
      'Боягуз',
      'Оптиміст',
      'Песиміст',
      'Любить прибрехати',
      'Чесний до грубості',
      'Ледачий',
      'Працелюб',
      'Жартівник',
      'Мовчун',
      'Педант',
      'Неуважний',
      'Добряк',
      'Егоїст',
      'Впертий',
      'Дипломат',
      'Панікер',
      'Холоднокровний',
      'Конфліктний',
      'Турботливий',
      'Хитрий',
      'Наївний',
    ]),
    ...list('baggage', [
      'Аптечка',
      'Насіння овочів',
      'Ящик консервів',
      'Паяльна станція',
      'Сокира',
      'Гітара',
      'Мішок рису на 50 кг',
      'Ліхтар і сонячна панель',
      'Рація з запасом батарей',
      'Набір інструментів',
      'Енциклопедія виживання',
      'Ноутбук без інтернету',
      'Фільтр для води',
      'Брезент і мотузки',
      'Пачка зошитів і ручок',
      'Кіт',
      'Курка-несучка',
      'Шахи',
      'Вогнегасник',
      'Теплий одяг на всіх',
      'Ящик книжок',
      'Протигаз',
      'Велосипед з генератором',
      'Колода карт',
    ]),
    ...list('fact', [
      'Пройшов курси першої допомоги',
      'Знає азбуку Морзе',
      'Виріс у селі без світла',
      'Вміє доїти корову',
      'Був чемпіоном області з плавання',
      'Може не спати дві доби',
      'Бачив план цього бункера',
      'Знає, де склад із пальним',
      'Розмовляє уві сні',
      'Вміє заспокоїти будь-кого',
      'Читав інструкцію до фільтра повітря',
      'Готує з будь-чого',
      'Знає їстівні рослини',
      'Був волонтером у шпиталі',
      'Прожив місяць у наметі',
      'Знає, як зварити мило',
      'Вміє шити',
      'Має права на вантажівку',
      'Виріс у родині лікарів',
      'Тиждень виживав у лісі',
      'Не вміє плавати',
      'Терпіти не може консерви',
      'Ніколи не тримав молотка',
      'Знає напам’ять сотню пісень',
    ]),
    ...(['health', 'profession', 'baggage', 'phobia', 'hobby'] as const).map(
      (k) =>
        special(
          'swap',
          k,
          `Поміняйтеся картою ${KIND_NAMES[k]} з будь-яким гравцем`,
        ),
    ),
    ...(
      ['health', 'profession', 'phobia', 'character', 'baggage'] as const
    ).map((k) =>
      special(
        'replace',
        k,
        `Замініть свою карту ${KIND_NAMES[k]} новою з колоди`,
      ),
    ),
    ...(['health', 'fact', 'phobia', 'baggage', 'character'] as const).map(
      (k) =>
        special(
          'reveal_other',
          k,
          `Відкрийте карту ${KIND_NAMES[k]} будь-якого гравця`,
        ),
    ),
    special(
      'double_vote',
      undefined,
      'Ваш голос у цьому голосуванні рахується двічі',
    ),
    special(
      'double_vote',
      undefined,
      'Ваш голос у цьому голосуванні важить за двох',
    ),
    special(
      'immunity',
      undefined,
      'Цього раунду проти вас не можна голосувати',
    ),
    special('immunity', undefined, 'Цього раунду вас ніхто не вижене'),
    special(
      'cancel_vote',
      undefined,
      'Скасуйте голосування: вигнання переноситься на наступний раунд',
    ),
    special(
      'cancel_vote',
      undefined,
      'Зупиніть голосування й перенесіть його на наступний раунд',
    ),
    special(
      'none',
      undefined,
      'Ви знаєте, де в бункері схованка з їжею. Розкажіть про це, коли захочете',
    ),
    special(
      'none',
      undefined,
      'Поставте одному гравцеві питання: він має відповісти чесно',
    ),
  ] as BaseCard[],
};

/** Inserts the built-in pack (the migration, and e2e after emptying the base). */
async function insertBasePack(q: QueryRunner) {
  const [pack] = (await q.query(
    `INSERT INTO "bunker_packs" ("name", "description", "builtin") VALUES ($1, $2, true) RETURNING "id"`,
    [BASE_PACK.name, BASE_PACK.description],
  )) as { id: string }[];
  const cards = BASE_PACK.cards;
  await q.query(
    `INSERT INTO "bunker_cards" ("kind", "title", "text", "effect", "effect_kind", "builtin")
     SELECT k, t, x, e, ek, true FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[], $5::varchar[]) AS u(k, t, x, e, ek)`,
    [
      cards.map((c) => c.kind),
      cards.map((c) => ('title' in c ? c.title : '')),
      cards.map((c) => c.text),
      cards.map((c) => ('effect' in c ? c.effect : null)),
      cards.map((c) => ('effect' in c ? (c.effectKind ?? null) : null)),
    ],
  );
  await q.query(
    `INSERT INTO "bunker_pack_cards" ("pack_id", "card_id") SELECT $1, "id" FROM "bunker_cards" WHERE "builtin"`,
    [pack.id],
  );
}

/**
 * «Розваги» → «Бункер»: cards and packs, rooms and who is in them (one room
 * per person); the built-in pack.
 */
export class Bunker1834000000000 implements MigrationInterface {
  name = 'Bunker1834000000000';

  /** For e2e: the built-in pack again after the tables were emptied. */
  static insertBasePack = insertBasePack;

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "bunker_cards" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "kind" character varying(16) NOT NULL, "title" character varying(60) NOT NULL DEFAULT '', "text" character varying(400) NOT NULL, "effect" character varying(16), "effect_kind" character varying(16), "author_id" uuid, "builtin" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_bunker_cards_effect" CHECK (("kind" = 'special') = ("effect" IS NOT NULL)), CONSTRAINT "CHK_bunker_cards_kind" CHECK ("kind" IN ('catastrophe','bunker','threat','profession','biology','health','hobby','phobia','character','baggage','fact','special')), CONSTRAINT "PK_041ee110a5c9ad3d245e1a48a86" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_bunker_cards_kind" ON "bunker_cards" ("kind") `,
    );
    await q.query(
      `CREATE TABLE "bunker_packs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(60) NOT NULL, "description" character varying(300) NOT NULL DEFAULT '', "author_id" uuid, "builtin" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a1dddbac142cf29e0504245580" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE TABLE "bunker_pack_cards" ("pack_id" uuid NOT NULL, "card_id" uuid NOT NULL, "added_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2de60f632dd3c543a7a2c1357e7" PRIMARY KEY ("pack_id", "card_id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_bunker_pack_cards_card" ON "bunker_pack_cards" ("card_id") `,
    );
    await q.query(
      `CREATE TABLE "bunker_rooms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(60) NOT NULL, "host_id" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'lobby', "settings" jsonb NOT NULL, "state" jsonb, "last_action_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_bunker_rooms_status" CHECK ("status" IN ('lobby','playing','finished')), CONSTRAINT "PK_dea25092d0357d1fc57380e951d" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE TABLE "bunker_room_members" ("room_id" uuid NOT NULL, "user_id" uuid NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_fa2b360f191b3960e2f4de3bf8e" PRIMARY KEY ("room_id", "user_id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_bunker_room_members_user" ON "bunker_room_members" ("user_id") `,
    );
    await q.query(
      `ALTER TABLE "bunker_cards" ADD CONSTRAINT "FK_3405c107ee926b2fd3d17938324" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "bunker_packs" ADD CONSTRAINT "FK_74b5d8bb8f688303d9be2bfb296" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "bunker_pack_cards" ADD CONSTRAINT "FK_719da8221bfa1b08cc29b9639b1" FOREIGN KEY ("pack_id") REFERENCES "bunker_packs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "bunker_pack_cards" ADD CONSTRAINT "FK_20c68301e72effb55381e426c09" FOREIGN KEY ("card_id") REFERENCES "bunker_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "bunker_rooms" ADD CONSTRAINT "FK_e34107c85d1a7ddcf536d42c7a2" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "bunker_room_members" ADD CONSTRAINT "FK_5872cfde74f8e8f0f0c0caf2434" FOREIGN KEY ("room_id") REFERENCES "bunker_rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "bunker_room_members" ADD CONSTRAINT "FK_866306fcae0f5eca263e0903acb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await insertBasePack(q);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "bunker_room_members"`);
    await q.query(`DROP TABLE "bunker_rooms"`);
    await q.query(`DROP TABLE "bunker_pack_cards"`);
    await q.query(`DROP TABLE "bunker_packs"`);
    await q.query(`DROP TABLE "bunker_cards"`);
  }
}
