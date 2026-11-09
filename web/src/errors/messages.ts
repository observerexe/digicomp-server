/**
 * Human texts for API errorCode values (docs/API_UA.md, «Помилки»).
 * messages.test.ts checks that every code the backend can return is here.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // Загальні
  ERROR: 'Не вдалося виконати дію. Спробуйте ще раз.',
  INTERNAL_ERROR: 'На сервері сталася помилка. Ми вже бачимо її в журналі — спробуйте трохи пізніше.',
  SERVICE_UNAVAILABLE: 'Сервер тимчасово недоступний. Спробуйте за хвилину.',
  VALIDATION_ERROR: 'Перевірте поля форми: щось заповнено неправильно.',
  CONFLICT: 'Такий запис уже є.',
  CONSTRAINT_VIOLATION: 'Дані не збігаються з іншими записами. Оновіть сторінку й спробуйте ще раз.',
  NOT_FOUND: 'Не знайдено. Можливо, запис видалили.',
  RATE_LIMITED: 'Забагато спроб. Зачекайте хвилину й спробуйте знову.',
  CSRF: 'Сесія застаріла. Оновіть сторінку.',
  UNAUTHORIZED: 'Потрібно увійти знову.',
  FORBIDDEN: 'У вас немає прав на цю дію.',
  NOT_ALLOWED: 'Цю дію можна виконати лише для себе або з правами адміністратора.',

  // Вхід і акаунт
  INVALID_CREDENTIALS: 'Неправильний email або пароль.',
  INVALID_REFRESH_TOKEN: 'Сесія завершилась. Увійдіть знову.',
  INVALID_CURRENT_PASSWORD: 'Поточний пароль введено неправильно.',
  SETUP_ALREADY_COMPLETED: 'Першого адміністратора вже створено.',
  EMAIL_TAKEN: 'Цей email уже використовує інший учасник.',
  LAST_ADMIN: 'Не можна прибрати останнього активного адміністратора.',
  FIELD_NOT_ALLOWED: 'Це поле ви змінювати не можете.',
  TARGET_ROLE_FORBIDDEN: 'Модератор не може діяти над іншим модератором чи адміністратором.',
  SELF_ACTION_FORBIDDEN: 'Цю дію не можна виконати щодо себе.',
  NOT_OWNER: 'Зняти чи скасувати можна лише власний запис.',
  USER_NOT_FOUND: 'Учасника не знайдено.',
  UNKNOWN_MEMBER: 'Учасника не знайдено або його заблоковано.',

  // 2FA
  TWO_FACTOR_INVALID_CODE: 'Код не підходить. Перевірте застосунок і введіть новий код.',
  TWO_FACTOR_LOCKED: 'Забагато неправильних кодів. Спробуйте через 15 хвилин.',
  TWO_FACTOR_CHALLENGE_INVALID: 'Час на введення коду минув. Увійдіть знову.',
  TWO_FACTOR_CODE_REQUIRED: 'Введіть код із застосунку або запасний код.',
  TWO_FACTOR_ALREADY_ENABLED: 'Вхід із кодом уже ввімкнено.',
  TWO_FACTOR_NOT_ENABLED: 'Вхід із кодом не ввімкнено.',
  TWO_FACTOR_NO_SETUP: 'Спершу почніть налаштування входу з кодом.',
  TWO_FACTOR_NOT_CONFIGURED: 'Вхід із кодом ще не налаштований на сервері. Зверніться до адміністратора.',
  TWO_FACTOR_REQUIRED: 'Для цього розділу потрібен вхід із кодом (2FA).',

  // Файли
  FILE_REQUIRED: 'Додайте файл.',
  FILE_TYPE_NOT_ALLOWED: 'Такий тип файлу не підтримується.',
  FILE_CONTENT_MISMATCH: 'Файл пошкоджений або його розширення не відповідає вмісту.',
  FILE_TOO_LARGE: 'Файл завеликий.',
  FILE_NOT_FOUND: 'Файл не знайдено.',
  DOCUMENT_NOT_FOUND: 'Документ не знайдено.',
  VERSION_NOT_FOUND: 'Такої версії документа немає.',

  // ТЗ
  TASK_NOT_FOUND: 'ТЗ не знайдено. Можливо, його видалили.',
  TASK_FULL: 'Усі місця в цьому ТЗ уже зайняті.',
  TASK_ALREADY_TAKEN: 'Ви вже взяли це ТЗ.',
  TASK_ALREADY_STARTED: 'Роботу над ТЗ уже почали — приєднатися не можна.',
  TASK_ALREADY_COMPLETED: 'ТЗ уже виконано.',
  TASK_INVALID_TRANSITION: 'Статус ТЗ уже змінився. Оновіть дошку.',
  TASK_HAS_ASSIGNEES: 'Видалити можна лише вільне ТЗ без виконавців.',
  MAX_ASSIGNEES_TOO_LOW: 'Виконавців уже більше, ніж новий ліміт.',
  NOT_PARTICIPANT: 'Це може зробити лише виконавець.',

  // Бали й дисципліна
  POINTS_ENTRY_NOT_FOUND: 'Запис про бали не знайдено.',
  DISCIPLINE_RECORD_NOT_FOUND: 'Запис не знайдено.',
  ALREADY_REVOKED: 'Цей запис уже знято.',
  ENTRY_NOT_REVOCABLE: 'Бали за ТЗ не знімаються, а штраф знімається в розділі дисципліни.',
  FINE_AMOUNT_REQUIRED: 'Вкажіть, скільки балів знімає штраф.',
  AMOUNT_ONLY_FOR_FINE: 'Суму можна вказати лише для штрафу.',
  REASON_REQUIRED: 'Вкажіть причину.',

  // Обладнання, сеанси, допуски
  PLACE_NOT_FOUND: 'Обладнання не знайдено. Перевірте QR-код.',
  UNKNOWN_PLACE: 'Обладнання не знайдено.',
  PLACE_CODE_TAKEN: 'Обладнання з таким кодом уже є.',
  PLACE_IN_USE: 'Обладнання зараз зайняте.',
  PLACE_UNAVAILABLE: 'Обладнання на обслуговуванні або в архіві.',
  PLACE_BOOKED: 'Зараз іде чуже бронювання цього обладнання.',
  NOT_AUTHORIZED_FOR_PLACE: 'У вас немає чинного допуску до цього обладнання.',
  AUTHORIZATION_NOT_FOUND: 'Допуск не знайдено.',
  ACTIVE_SESSION_EXISTS: 'У вас уже є активний сеанс. Спершу завершіть його.',
  SAFETY_CONFIRMATION_REQUIRED: 'Підтвердіть, що ознайомилися з інструкцією з безпеки.',
  SESSION_ALREADY_ENDED: 'Сеанс уже завершено.',
  SESSION_NOT_FOUND: 'Сеанс не знайдено.',
  NOT_YOUR_SESSION: 'Чужий сеанс може завершити лише модератор.',
  INVALID_PERIOD: 'Кінець періоду має бути пізніше за початок.',
  EXPORT_TOO_LARGE: 'Забагато записів за раз. Виберіть коротший період.',

  // Бронювання
  BOOKING_NOT_FOUND: 'Бронювання не знайдено.',
  BOOKING_OVERLAP: 'Цей час уже заброньовано. Виберіть інший.',
  BOOKING_IN_PAST: 'Не можна бронювати час, що вже минув.',
  BOOKING_TOO_LONG: 'Бронювання — не довше 12 годин.',
  BOOKING_TOO_FAR: 'Бронювати можна не далі ніж на 60 днів уперед.',
  BOOKING_CANCELLED: 'Бронювання вже скасовано.',
  BOOKING_ENDED: 'Бронювання вже минуло.',

  // Несправності
  FAULT_REPORT_NOT_FOUND: 'Звіт про несправність не знайдено.',
  FAULT_CLOSED: 'Звіт уже закрито.',
  FAULT_PHOTO_LIMIT: 'До звіту можна додати не більше 3 фото.',

  // Склад
  ITEM_NOT_FOUND: 'Позицію складу не знайдено.',
  ITEM_CODE_TAKEN: 'Позиція з таким кодом уже є.',
  INSUFFICIENT_STOCK: 'На складі недостатньо.',
  INTEGER_REQUIRED: 'Для цієї одиниці кількість має бути цілою.',
  DELTA_ZERO: 'Кількість не може бути нулем.',
  NOTE_REQUIRED: 'Додайте коментар.',
  STOCK_RECEIVE_FORBIDDEN: 'У вас немає прав поповнювати склад.',

  // Проєкти
  PROJECT_NOT_FOUND: 'Проєкт не знайдено.',
  PROJECT_EDIT_FORBIDDEN: 'Редагувати проєкт можуть лише його учасники й модератори.',
  PROJECT_MEMBERS_FORBIDDEN: 'Склад учасників змінюють лише модератори.',
  PROJECT_DATES_INVALID: 'Дедлайн не може бути раніше дати початку.',

  // Розумна лабораторія
  SMART_NOT_CONFIGURED: 'Розумна лабораторія ще не налаштована.',
  SMART_UNAVAILABLE: 'Home Assistant не відповідає. Спробуйте за хвилину.',
  SMART_AUTH_FAILED: 'Home Assistant відхилив доступ. Зверніться до адміністратора.',
  SMART_DEVICE_NOT_FOUND: 'Пристрій не знайдено.',
  UNKNOWN_HA_ENTITY: 'Такого пристрою немає в Home Assistant.',
  ENTITY_KIND_MISMATCH: 'Тип пристрою не збігається.',
  SMART_ENTITY_EXISTS: 'Цей пристрій уже додано.',
  DEVICE_UNAVAILABLE: 'Пристрій зараз недоступний (вимкнений чи без зв’язку).',
  BRIGHTNESS_REQUIRES_ON: 'Щоб змінити яскравість, увімкніть світло.',

  // Розширена панель
  AGENT_UNAVAILABLE: 'Агент на сервері не відповідає. Решта застосунку працює.',
  AGENT_BUSY: 'На сервері вже виконується інша дія. Дочекайтеся її завершення.',
};

const NETWORK = 'Немає з’єднання з сервером. Перевірте інтернет і спробуйте ще раз.';

/** Text for a code; never a bare "something went wrong". */
export function errorText(code: string | undefined | null): string {
  if (!code) return ERROR_MESSAGES.ERROR!;
  if (code === 'NETWORK') return NETWORK;
  return (
    ERROR_MESSAGES[code] ??
    (code.endsWith('_NOT_FOUND') ? ERROR_MESSAGES.NOT_FOUND! : ERROR_MESSAGES.ERROR!)
  );
}
