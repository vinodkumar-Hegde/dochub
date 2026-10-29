FROM postgres:16-bookworm
COPY --chmod=0644 init-db.sh /docker-entrypoint-initdb.d/10-app-role.sh
