\set ON_ERROR_STOP on
\getenv reports_password REPORTS_READONLY_PASSWORD

SELECT format(
    'CREATE ROLE apuestas_reports LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
    :'reports_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'apuestas_reports'
)
\gexec

SELECT format('ALTER ROLE apuestas_reports PASSWORD %L', :'reports_password')
\gexec

SELECT format(
    'GRANT CONNECT ON DATABASE %I TO apuestas_reports',
    current_database()
)
\gexec

GRANT USAGE ON SCHEMA public TO apuestas_reports;
GRANT SELECT ON TABLE
    public."Competition",
    public."Team",
    public."Match",
    public."Market",
    public."Selection",
    public."OddsHistory",
    public."AuditLog"
TO apuestas_reports;

ALTER ROLE apuestas_reports SET default_transaction_read_only = on;
