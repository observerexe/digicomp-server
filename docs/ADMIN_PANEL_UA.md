# Розширена панель: встановлення на сервері

Панель показує стан сервера (CPU, пам'ять, диск, аптайм, контейнери, логи API, останній бекап) і запускає дії: бекап, перевірку відновлення, перезапуск API або Home Assistant.

## Як це влаштовано

```
Адмін (tailnet) ──https──▶ tailscale serve :9443 ──▶ API 127.0.0.1:3001 (панель)
Інтернет (Funnel) ───────▶ API 127.0.0.1:3000 (застосунок, панелі тут немає: 404)
API ──unix-сокет + токен──▶ агент (systemd) ──▶ docker / scripts/backup.sh
```

- **API не має shell і доступу до docker.** Усе, що панель уміє робити із сервером, робить агент `ops/agent/digicomp_agent.py`. Це один файл на Python без залежностей, і він виконує лише фіксований список команд:

  | Що | Команда |
  | --- | --- |
  | метрики | читання `/proc` і `df` |
  | стан контейнерів | `docker compose ps`, `docker inspect homeassistant` |
  | логи API | `docker compose logs --tail N api` (N до 500) |
  | останній бекап | список файлів у `~/backups/digicomp` |
  | бекап | `scripts/backup.sh` |
  | перевірка відновлення | `scripts/restore-check.sh` |
  | перезапуск API | `docker compose restart api` |
  | перезапуск HA | `docker restart homeassistant` |

  Бази даних, видалення і довільних команд у списку немає.
- **Агент не відкриває мережевий порт.** Він слухає лише unix-сокет `/run/digicomp-agent/agent.sock` (права 660), який змонтовано в контейнер API. Кожен запит перевіряється за токеном `AGENT_TOKEN`.
- **Хто бачить панель.** Лише `admin`, і лише в сесії, де вхід був з кодом 2FA. Маршрути `/admin-panel/*` працюють тільки на порту 3001. Цей порт відкривається через `tailscale serve`, тобто видно його лише з вашого tailnet. Funnel веде на порт 3000, де панелі немає.
- **Аудит.** Кожна дія з панелі записується в аудит (`panel.action`).

## Встановлення (один раз)

Виконуйте на сервері. Спершу як завжди зробіть бекап: `cd ~/server && ./scripts/backup.sh`.

1. **Оновіть код і згенеруйте ключі:**

       cd ~/server && git pull
       echo "AGENT_TOKEN=$(openssl rand -hex 32)" >> .env
       echo "TOTP_KEY=$(openssl rand -base64 32)" >> .env

   `TOTP_KEY` шифрує секрети 2FA в базі. Не змінюйте його потім: увімкнена 2FA перестане працювати, і її доведеться скидати.
   Бекап бази без `.env` не розкриває секрети 2FA, тому сам `.env` зберігайте окремо від бекапів.

2. **Встановіть агента:**

       sudo install -d -m 755 /opt/digicomp-agent
       sudo install -m 644 ops/agent/digicomp_agent.py /opt/digicomp-agent/
       grep ^AGENT_TOKEN= .env | sudo tee /etc/digicomp-agent.env > /dev/null
       sudo chmod 600 /etc/digicomp-agent.env
       sudo cp ops/agent/digicomp-agent@.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now digicomp-agent@$USER

   Агент працює від вашого користувача (як і щоденний бекап) у групі `docker`. Код агента лежить у `/opt`, і змінити його може лише root.

3. **Перевірте агента:**

       systemctl status digicomp-agent@$USER
       curl -s --unix-socket /run/digicomp-agent/agent.sock \
         -H "Authorization: Bearer $(grep ^AGENT_TOKEN= .env | cut -d= -f2)" \
         http://agent/v1/health

   Очікується `{"ok": true, "version": "1"}`.

4. **Перезапустіть API** (з'являться порт 3001 і змонтований сокет):

       docker compose up -d --build
       curl -s http://127.0.0.1:3000/health

5. **Відкрийте панель лише в tailnet:**

       sudo tailscale serve --bg --https=9443 http://127.0.0.1:3001
       tailscale serve status

   Funnel не чіпайте: він веде на 3000. Перевірте, що панель через Funnel недоступна (має бути 404):

       curl -s -o /dev/null -w '%{http_code}\n' https://<ваш-сервер>.ts.net/admin-panel/overview

6. **Увімкніть 2FA для адміна.** Після етапу 8 це робиться в профілі. До того — через API:
   1. `POST /auth/2fa/setup` повертає `secret` і `otpauthUri`. Додайте секрет в Aegis, Google Authenticator чи 1Password.
   2. `POST /auth/2fa/enable { "code": "123456" }` повертає 8 кодів відновлення. Збережіть їх: вони показуються лише раз.
   3. Усі сесії закриються. Увійдіть знову, тепер із кодом.

## Оновлення агента

    cd ~/server && git pull
    sudo install -m 644 ops/agent/digicomp_agent.py /opt/digicomp-agent/
    sudo systemctl restart digicomp-agent@$USER

## Якщо щось пішло не так

- **Панель відповідає `AGENT_UNAVAILABLE`:**
  - перевірте `systemctl status digicomp-agent@$USER` і `journalctl -u digicomp-agent@$USER -n 50`;
  - перевірте, що `AGENT_TOKEN` однаковий у `.env` і в `/etc/digicomp-agent.env`;
  - перевірте, що сокет існує: `ls -l /run/digicomp-agent/`.

  Решта застосунку при цьому працює.
- **`TWO_FACTOR_REQUIRED`** — вхід був без коду 2FA. Вийдіть і увійдіть знову з кодом.
- **Загубили телефон** — увійдіть з кодом відновлення. Або інший адмін скине вам 2FA: `POST /users/:id/2fa/reset`.
- **Вимкнути панель повністю** — `sudo systemctl disable --now digicomp-agent@$USER` і `sudo tailscale serve --https=9443 off`.

## Тести агента

    python3 -m unittest discover -s ops/agent
