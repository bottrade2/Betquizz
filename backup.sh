#!/bin/bash
# Cron diário: 0 3 * * * /path/to/betquizz/backup.sh >> /var/log/betquizz-backup.log 2>&1

set -e

DATE=$(date +%Y-%m-%d_%H-%M)
BACKUP_DIR="/var/backups/betquizz"
DB_NAME="${DB_NAME:-betquizz}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASSWORD:-}"

mkdir -p "$BACKUP_DIR"

if [ -n "$DB_PASS" ]; then
  mysqldump -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" > "$BACKUP_DIR/betquizz_$DATE.sql"
else
  mysqldump -u "$DB_USER" "$DB_NAME" > "$BACKUP_DIR/betquizz_$DATE.sql"
fi

gzip "$BACKUP_DIR/betquizz_$DATE.sql"

# Apagar backups com mais de 7 dias
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

echo "[Backup] $(date) — betquizz_$DATE.sql.gz guardado"
