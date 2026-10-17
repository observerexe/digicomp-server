# Резервні копії DigiComp HUB

Копіюються дві речі: база PostgreSQL і том з файлами (документи, аватари, матеріали проєктів).
Копії лежать у `~/backups/digicomp` (змінюється змінною `BACKUP_DIR`), зберігаються останні 14 (змінна `BACKUP_KEEP`).

## Ручна копія

    cd ~/server
    ./scripts/backup.sh

## Щоденна копія о 03:30

    mkdir -p ~/.config/systemd/user
    cp ~/server/scripts/systemd/digicomp-backup.* ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now digicomp-backup.timer
    loginctl enable-linger "$USER"

Перевірка: `systemctl --user list-timers` та `journalctl --user -u digicomp-backup.service`.

## Перевірка, що копію можна відновити

    cd ~/server
    ./scripts/restore-check.sh

Скрипт відновлює останній дамп у тимчасову базу `restore_check`, рахує користувачів і видаляє її.
Робіть це раз на тиждень: копія, яку жодного разу не відновлювали, не є гарантією.

## Повне відновлення (аварія)

1. Зупинити API: `docker compose stop api`
2. Перестворити базу і відновити дамп (підставити ім'я файлу):

       docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
       docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < ~/backups/digicomp/db-ДАТА.dump

3. Відновити файли (підставити ім'я архіву):

       docker compose run --rm --no-deps -T -v ~/backups/digicomp:/backup --entrypoint sh api -c 'rm -rf /data/files/* && tar xzf /backup/files-ДАТА.tgz -C /data/files'

4. Запустити API: `docker compose up -d api`

## Важливо

Копії на тому ж диску, що й сервер, не рятують від виходу диска з ладу.
Періодично копіюйте папку `~/backups/digicomp` на інший носій або в інше місце.
