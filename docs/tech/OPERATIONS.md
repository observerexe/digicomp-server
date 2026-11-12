# Сервер DigiComp HUB

Як влаштовано сервер, як розгортати, робити бекапи й лагодити. Команди виконуються на сервері (`ssh digicomp@digicomp`) з теки `~/server`,
якщо не сказано інакше. Команди з `sudo` виконує власник сервера.

## Що де лежить

| Що | Де |
| --- | --- |
| Код (клон репо) і `.env` | `~/server` |
| Бекапи | `~/backups/digicomp` (`BACKUP_DIR`), 14 останніх (`BACKUP_KEEP`) |
| Home Assistant | контейнер `homeassistant`, конфігурація в `~/homeassistant/config` |
| Агент панелі | `/opt/digicomp-agent/`, токен у `/etc/digicomp-agent.env`, служба `digicomp-agent@digicomp` |
| Таймер бекапу | `~/.config/systemd/user/digicomp-backup.{service,timer}` (користувацький, не системний) |
| База й файли | томи Docker `server_db_data`, `server_files_data` |

**Мережа (Tailscale).**

| Адреса | Куди | Хто бачить |
| --- | --- | --- |
| `https://<сервер>.ts.net` (Funnel) | `127.0.0.1:3000` — застосунок і API | інтернет |
| `https://<сервер>.ts.net:9443` (serve) | `127.0.0.1:3001` — розширена панель | лише tailnet |

`<сервер>.ts.net` — повна адреса з `PUBLIC_ORIGIN` у `.env` (у публічному репо її не пишемо).
Перевірка: `tailscale serve status`. Home Assistant (`:8123`) назовні не відкривається.

## Змінні `.env`

| Змінна | Для чого |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | База |
| `JWT_SECRET` | Підпис токенів. Зміна виводить усіх із застосунку |
| `COOKIE_SECURE` | `true` на сервері (https), `false` локально |
| `PUBLIC_ORIGIN` | Адреса застосунку, що потрапляє в QR-наліпки (`https://<сервер>.ts.net`) |
| `TOTP_KEY` | Шифрує секрети 2FA. **Не змінювати і не губити:** без нього 2FA перестане працювати в усіх |
| `AGENT_TOKEN` | Токен агента; той самий у `/etc/digicomp-agent.env` |
| `HA_TOKEN`, `HA_URL` | Home Assistant (URL за замовчуванням `http://host.docker.internal:8123`) |
| `SESSION_AUTO_CLOSE_HOURS` | Через скільки годин закривати забутий сеанс (12) |
| `TRUST_PROXY`, `CORS_ORIGINS` | Лише якщо перед API з'явиться свій reverse proxy чи інший домен |
| `COMPOSE_PROJECT_NAME` | Лише локально |

`DATABASE_URL`, `STORAGE_DIR`, `PANEL_PORT`, `AGENT_SOCKET`, `WEB_DIST` задає `docker-compose.yml` чи образ — у `.env` їх не потрібно.

**Копія `.env` має лежати поза сервером** (менеджер паролів): у бекапах його немає, а без `TOTP_KEY` і `JWT_SECRET` відновлена база неповна.

## Розгортання

Лише з `main`, завжди в такому порядку:

    ./scripts/backup.sh && ./scripts/restore-check.sh   # 1. бекап і перевірка, що він відновлюється
    git pull --ff-only                                   # 2. код
    docker compose up -d --build                         # 3. збірка й перезапуск (~1 хв простою), міграції — самі
    curl -s http://127.0.0.1:3000/health                 # 4. перевірка

Після розгортання перевірте:

    docker compose ps                                              # api і db — healthy
    docker compose logs api --since 5m | grep -iE "error|migration"
    curl -s https://<сервер>.ts.net/health              # ззовні
    curl -s -o /dev/null -w '%{http_code}\n' https://<сервер>.ts.net/api/admin-panel/overview   # має бути 404

Якщо змінився агент (`ops/agent/`), оновіть і його — див. «Розширена панель».

**Відкат:** `git checkout <попередній коміт> && docker compose up -d --build`. Якщо нова версія вже застосувала міграції,
відновіть базу з бекапу кроку 1 (див. «Повне відновлення»): старий код може не працювати з новою схемою.

## Бекапи

`scripts/backup.sh` зберігає дамп бази (`db-ДАТА.dump`), архів файлів (`files-ДАТА.tgz`) і, якщо HA запущений,
його конфігурацію (`ha-ДАТА.tgz`, права 600 — там ключі доступу). Старші за 14 останніх видаляються.

**Щодня о 03:30** — користувацький таймер systemd (пропущений запуск наздоганяється після ввімкнення сервера):

    mkdir -p ~/.config/systemd/user
    cp scripts/systemd/digicomp-backup.* ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now digicomp-backup.timer
    loginctl enable-linger "$USER"        # щоб таймер працював без входу на сервер

Перевірка: `systemctl --user list-timers` (має бути `digicomp-backup.timer` з наступним запуском) і
`journalctl --user -u digicomp-backup.service -n 20`. Шукайте таймер саме з `--user`: серед системних його немає.
Якщо таймер вимикали на час робіт — не забудьте ввімкнути знову.

**Перевірка відновлення** — раз на тиждень і після кожного розгортання:

    ./scripts/restore-check.sh      # відновлює останній дамп у тимчасову базу, рахує користувачів, видаляє її

**Копія поза сервером.** Бекапи на тому ж диску не рятують від його поломки. Зі свого комп'ютера:

    rsync -a digicomp@digicomp:backups/digicomp/ ~/digicomp-backups/

### Повне відновлення

1. `docker compose stop api`
2. База (підставте файл):

       docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
       docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < ~/backups/digicomp/db-ДАТА.dump

3. Файли:

       docker compose run --rm --no-deps -T -v ~/backups/digicomp:/backup --entrypoint sh api \
         -c 'rm -rf /data/files/* && tar xzf /backup/files-ДАТА.tgz -C /data/files'

4. `docker compose up -d api` і перевірка `/health`.
5. Конфігурація HA (якщо потрібно): зупиніть контейнер, очистьте `~/homeassistant/config`,
   `sudo tar xzf ~/backups/digicomp/ha-ДАТА.tgz -C ~/homeassistant/config`, запустіть.

## Розширена панель і агент

API звертається до агента через unix-сокет `/run/digicomp-agent/agent.sock` (права 660) з токеном `AGENT_TOKEN`.
Агент виконує лише: метрики (`/proc`, `df`), `docker compose ps` і `logs`, список бекапів, `scripts/backup.sh`,
`scripts/restore-check.sh`, `docker compose restart api`, `docker restart homeassistant`.

**Встановлення (один раз):**

    echo "AGENT_TOKEN=$(openssl rand -hex 32)" >> .env
    echo "TOTP_KEY=$(openssl rand -base64 32)" >> .env          # якщо ще немає
    sudo install -d -m 755 /opt/digicomp-agent
    sudo install -m 644 ops/agent/digicomp_agent.py /opt/digicomp-agent/
    grep ^AGENT_TOKEN= .env | sudo tee /etc/digicomp-agent.env > /dev/null
    sudo chmod 600 /etc/digicomp-agent.env
    sudo cp ops/agent/digicomp-agent@.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now digicomp-agent@$USER
    docker compose up -d --build                                 # API підхопить сокет і порт 3001
    sudo tailscale serve --bg --https=9443 http://127.0.0.1:3001

Потім адмін вмикає 2FA у профілі, входить знову з кодом і відкриває `https://<сервер>.ts.net:9443/admin`.

**Оновлення агента:**

    sudo install -m 644 ops/agent/digicomp_agent.py /opt/digicomp-agent/
    sudo systemctl restart digicomp-agent@$USER

**Перевірка агента:**

    systemctl status digicomp-agent@$USER
    curl -s --unix-socket /run/digicomp-agent/agent.sock \
      -H "Authorization: Bearer $(grep ^AGENT_TOKEN= .env | cut -d= -f2)" http://agent/v1/health   # {"ok": true, ...}

## Home Assistant

1. У HA: профіль → Security → Long-lived access tokens → Create token.
2. Додайте токен у `.env`, не показуючи на екрані:

       read -s -p "Токен HA: " HAT; echo; printf 'HA_TOKEN=%s\n' "$HAT" >> .env; unset HAT

3. `docker compose up -d api`. У застосунку адміном: «Розумна лабораторія → Пристрої» має показати «Зв'язок є» і версію HA.
4. Пристрої додаються там же, з розділу «Знайдено в Home Assistant».

**Демо-пристрої.** Рядок `demo:` у `~/homeassistant/config/configuration.yaml` додає вигадані лампи й датчики для перевірки.
Після перевірки приберіть їх зі списку в застосунку, видаліть рядок і перезапустіть HA (кнопкою в розширеній панелі).

## Перевірка справності

Нічого не змінюють:

    docker compose ps; docker ps --filter name=homeassistant
    curl -s http://127.0.0.1:3000/health
    systemctl is-active digicomp-agent@$USER
    systemctl --user list-timers digicomp-backup.timer
    ls -t ~/backups/digicomp | head -3
    tailscale serve status
    docker compose logs api --since 24h | grep -ciE "error|exception"
    df -h /; free -h

Змінює лише тимчасову базу: `./scripts/restore-check.sh`.
Схема збігається з кодом: `./scripts/schema-check.sh` (перезбирає образ API).

## Якщо щось не так

| Що бачите | Що робити |
| --- | --- |
| `/health` не відповідає | `docker compose ps`, `docker compose logs api --tail 100`; часто — помилка міграції чи змінної в `.env` |
| Панель: `AGENT_UNAVAILABLE` | `systemctl status digicomp-agent@$USER`, `journalctl -u digicomp-agent@$USER -n 50`; токен однаковий у `.env` і `/etc/digicomp-agent.env`; сокет є (`ls -l /run/digicomp-agent/`) |
| Панель: «відкривається лише з tailnet» на `:9443` | `tailscale serve status`: 9443 має вести на `http://127.0.0.1:3001` |
| Панель: `TWO_FACTOR_REQUIRED` | Вхід був без коду: вийти й увійти з кодом 2FA |
| Хтось загубив телефон з 2FA | Увійти запасним кодом, або адмін скидає 2FA на сторінці учасника |
| Розумна лабораторія: «не відповідає» / «не налаштована» | `docker ps --filter name=homeassistant`; є `HA_TOKEN` у `.env`; токен не відкликано в HA |
| Свіжих бекапів немає | `systemctl --user status digicomp-backup.timer` — увімкнути (див. «Бекапи») |
| Хтось забув пароль | Адмін: «Панель керування → Учасники → людина → Скинути пароль» |
| Вимкнути панель повністю | `sudo systemctl disable --now digicomp-agent@$USER` і `sudo tailscale serve --https=9443 off` |

## Перед запуском лишилось

- [ ] Приватний тест з 2–3 учасниками з телефонів (вхід, головна, QR, ТЗ, бронювання, розумна лабораторія).
- [x] Старий фронт (Python-шлюз `digicomp-hub`, порт 8765) прибрано; архів — `~/backups/digicomp-front-2026-11-09.tar.gz`.
- [ ] Роздрукувати QR-наліпки на обладнання й склад («Лабораторія → Наліпки QR»).
- [ ] Прибрати демо-пристрої HA після перевірки розумної лабораторії.
