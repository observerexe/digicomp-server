# Розумний будинок: Home Assistant

Бекенд працює з Home Assistant (HA) лише через REST API і тільки з пристроями, які адмін явно додав у список дозволених.
Додаток і шлюз HUB ніколи не звертаються до HA напряму. Токен HA лежить тільки в `.env` на сервері.
HA не відкривається в інтернет (Funnel веде лише на шлюз HUB, порт 8765).

## Що вміє API

- `GET /smart/entities` (admin, coordinator, member): стан дозволених пристроїв (світло, датчики, сцени).
- `POST /smart/lights/:id/state` (admin, coordinator): `{ "on": true, "brightness": 1-100 }`.
- `POST /smart/scenes/:id/activate` (admin, coordinator).
- `GET /smart/status`, `GET /smart/discover`, `GET/POST/PATCH/DELETE /smart/allowlist` (admin): керування списком дозволених пристроїв.

Дозволені лише три типи: `light`, `sensor`, `scene`. Розетки, вимикачі й будь-що інше (`switch.*`) додати неможливо,
щоб застосунок не міг дистанційно вмикати паяльники, нагрівачі чи 3D-принтери.
Кожна дія (світло, сцена, зміна списку) пишеться в журнал аудиту. Запит до HA має ліміт часу 5 секунд,
для дій діє ліміт 30 на хвилину на користувача.

## Налаштування на сервері

1. У HA: профіль користувача (внизу ліворуч) → вкладка Security → Long-lived access tokens → Create token. Скопіюйте токен.
2. Додайте його в `.env` на сервері (без показу на екрані):

       read -s -p "Токен HA: " HAT; echo
       printf 'HA_TOKEN=%s\n' "$HAT" >> ~/server/.env
       unset HAT

3. Перезапустіть API: `cd ~/server && docker compose up -d --build api`
4. Перевірте зв'язок (адмін-токен у змінній `TOKEN`): `curl -s http://127.0.0.1:3000/smart/status -H "Authorization: Bearer $TOKEN"`

HA стоїть на тому ж сервері в режимі `network_mode: host`, а API працює в контейнері, тому до HA він звертається за адресою
`http://host.docker.internal:8123` (змінна `HA_URL`, значення за замовчуванням уже таке).

## Тестування без обладнання

У файл `~/homeassistant/config/configuration.yaml` додайте рядок `demo:` і перезапустіть HA. З'являться вигадані лампи й датчики
(`light.bed_light`, `light.ceiling_lights` та інші). Після тестів рядок `demo:` видаліть.

## Додавання пристрою в дозволений список

1. `GET /smart/discover` покаже пристрої HA, яких ще немає в списку.
2. `POST /smart/allowlist` з `{ "entityId": "light.bed_light", "kind": "light", "label": "Лампа", "room": "Майстерня" }`.
3. Після цього пристрій з'явиться в `GET /smart/entities` і ним можна керувати.

## Коди помилок

`SMART_NOT_CONFIGURED` (немає токена), `SMART_UNAVAILABLE` (HA не відповідає за 5 с), `SMART_AUTH_FAILED` (HA відхилив токен),
`UNKNOWN_HA_ENTITY`, `ENTITY_KIND_MISMATCH`, `SMART_ENTITY_EXISTS`, `DEVICE_UNAVAILABLE`, `BRIGHTNESS_REQUIRES_ON`.
