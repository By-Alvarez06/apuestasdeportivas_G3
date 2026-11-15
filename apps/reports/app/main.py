"""Servicio de informes operativos de solo lectura."""

import os
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO, StringIO
from pathlib import Path
from typing import Annotated
from uuid import UUID

import asyncpg
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

APP_VERSION = "0.1.0"
MAX_ROWS = 1000
ALLOWED_STATUSES = {"scheduled", "live", "finished", "suspended", "postponed", "cancelled"}
CSV_HEADERS = (
    "tipo",
    "fecha",
    "competicion",
    "partido",
    "estado",
    "detalle",
    "fuente",
    "cuota_anterior",
    "cuota_nueva",
    "actor",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_url = os.getenv("REPORTS_DATABASE_URL")
    app.state.db_pool = (
        await asyncpg.create_pool(
            database_url,
            min_size=1,
            max_size=5,
            command_timeout=10,
            server_settings={"default_transaction_read_only": "on"},
        )
        if database_url
        else None
    )
    try:
        yield
    finally:
        if app.state.db_pool is not None:
            await app.state.db_pool.close()


app = FastAPI(
    title="Apuestas Deportivas — Informes",
    version=APP_VERSION,
    description="Dashboard operativo de solo lectura.",
    lifespan=lifespan,
)


async def require_service_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = os.getenv("REPORTS_SERVICE_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="El acceso al servicio no está configurado.")
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if (
        not authorization
        or not authorization.startswith("Bearer ")
        or not secrets.compare_digest(supplied, expected)
    ):
        raise HTTPException(status_code=401, detail="Credenciales de servicio no válidas.")


async def read_only_connection(request: Request):
    pool: asyncpg.Pool | None = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=503, detail="La base de datos de informes no está disponible."
        )
    async with pool.acquire() as connection, connection.transaction(readonly=True):
        yield connection


def report_filters(
    start: datetime,
    end: datetime,
    competition_id: UUID | None,
    status: str | None,
) -> dict:
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(status_code=422, detail="Las fechas deben incluir zona horaria.")
    start = start.astimezone(UTC)
    end = end.astimezone(UTC)
    if end <= start:
        raise HTTPException(
            status_code=422, detail="La fecha final debe ser posterior a la inicial."
        )
    if end - start > timedelta(days=90):
        raise HTTPException(status_code=422, detail="El periodo máximo de consulta es de 90 días.")
    if status is not None and status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=422, detail="El estado de partido no es válido.")
    return {
        "from": start,
        "to": end,
        "competitionId": str(competition_id) if competition_id else None,
        "status": status,
    }


def where_clause(date_column: str, filters: dict, alias: str = "m") -> tuple[str, list]:
    clauses = [f"{date_column} >= $1", f"{date_column} <= $2"]
    params: list = [
        filters["from"].astimezone(UTC).replace(tzinfo=None),
        filters["to"].astimezone(UTC).replace(tzinfo=None),
    ]
    if filters["competitionId"]:
        params.append(filters["competitionId"])
        clauses.append(f'{alias}."competitionId" = ${len(params)}::uuid')
    if filters["status"]:
        params.append(filters["status"])
        clauses.append(f'{alias}."status"::text = ${len(params)}')
    return " AND ".join(clauses), params


def ensure_bounded(rows: list) -> list:
    if len(rows) > MAX_ROWS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"El informe supera el máximo de {MAX_ROWS} filas; "
                "reduce el periodo o añade filtros."
            ),
        )
    return rows


async def load_report(connection: asyncpg.Connection, filters: dict) -> dict:
    matches_where, match_params = where_clause('m."kickoffAt"', filters)
    match_rows = ensure_bounded(
        await connection.fetch(
            f"""
            SELECT m.id::text AS id, m."kickoffAt" AS kickoff_at, m.status::text AS status,
                   m."homeScore" AS home_score, m."awayScore" AS away_score,
                   home.name AS home_team, away.name AS away_team,
                   c.name AS competition,
                   COUNT(mk.id) FILTER (WHERE mk.status::text = 'open')::int AS open_markets,
                   COUNT(mk.id) FILTER (WHERE mk.status::text = 'suspended')::int
                       AS suspended_markets,
                   COUNT(mk.id) FILTER (WHERE mk.status::text = 'closed')::int AS closed_markets
            FROM "Match" m
            JOIN "Team" home ON home.id = m."homeTeamId"
            JOIN "Team" away ON away.id = m."awayTeamId"
            LEFT JOIN "Competition" c ON c.id = m."competitionId"
            LEFT JOIN "Market" mk ON mk."matchId" = m.id
            WHERE {matches_where}
            GROUP BY m.id, home.name, away.name, c.name
            ORDER BY m."kickoffAt" ASC, m.id
            LIMIT {MAX_ROWS + 1}
            """,
            *match_params,
        )
    )

    odds_where, odds_params = where_clause('oh."createdAt"', filters)
    odds_rows = ensure_bounded(
        await connection.fetch(
            f"""
            SELECT oh."createdAt" AS changed_at, c.name AS competition,
                   home.name || ' - ' || away.name AS match,
                   mk.type::text AS market_type, mk.line::text AS line,
                   s.key AS selection, oh.source::text AS source,
                   oh."previousOdds"::text AS previous_odds,
                   oh."newOdds"::text AS new_odds, oh."changedById"::text AS actor
            FROM "OddsHistory" oh
            JOIN "Selection" s ON s.id = oh."selectionId"
            JOIN "Market" mk ON mk.id = s."marketId"
            JOIN "Match" m ON m.id = mk."matchId"
            JOIN "Team" home ON home.id = m."homeTeamId"
            JOIN "Team" away ON away.id = m."awayTeamId"
            LEFT JOIN "Competition" c ON c.id = m."competitionId"
            WHERE {odds_where}
            ORDER BY oh."createdAt" DESC, oh.id
            LIMIT {MAX_ROWS + 1}
            """,
            *odds_params,
        )
    )

    activity_where, activity_params = where_clause('a."createdAt"', filters)
    activity_params.append("match")
    match_target = len(activity_params)
    activity_params.append("market")
    market_target = len(activity_params)
    activity_params.append("match.%")
    action_filter = len(activity_params)
    activity_where += (
        f' AND a."targetType" IN (${match_target}, ${market_target})'
        f' AND a.action LIKE ${action_filter} AND a."actorId" IS NOT NULL'
    )
    activity_rows = ensure_bounded(
        await connection.fetch(
            f"""
            SELECT a."createdAt" AS created_at, a.action, a."actorId"::text AS actor,
                   a."targetId" AS target_id, a.metadata::text AS metadata,
                   home.name || ' - ' || away.name AS match,
                   c.name AS competition, m.status::text AS status
            FROM "AuditLog" a
            LEFT JOIN "Market" target_market
                ON target_market.id::text = a."targetId" AND a."targetType" = 'market'
            JOIN "Match" m ON
                (a."targetType" = 'match' AND m.id::text = a."targetId")
                OR (target_market.id IS NOT NULL AND m.id = target_market."matchId")
            JOIN "Team" home ON home.id = m."homeTeamId"
            JOIN "Team" away ON away.id = m."awayTeamId"
            LEFT JOIN "Competition" c ON c.id = m."competitionId"
            WHERE {activity_where}
            ORDER BY a."createdAt" DESC, a.id
            LIMIT {MAX_ROWS + 1}
            """,
            *activity_params,
        )
    )

    status_counts: dict[str, int] = {}
    market_counts: dict[str, int] = {}
    for row in match_rows:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
        for field, key in (
            ("open_markets", "open"),
            ("suspended_markets", "suspended"),
            ("closed_markets", "closed"),
        ):
            market_counts[key] = market_counts.get(key, 0) + row[field]

    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "timezone": "UTC",
        "filters": {
            "from": filters["from"].isoformat(),
            "to": filters["to"].isoformat(),
            "competitionId": filters["competitionId"],
            "status": filters["status"],
        },
        "summary": {
            "matches": len(match_rows),
            "matchesByStatus": status_counts,
            "marketsByStatus": market_counts,
            "oddsChanges": len(odds_rows),
            "operatorActions": len(activity_rows),
        },
        "matches": [dict(row) for row in match_rows],
        "oddsChanges": [dict(row) for row in odds_rows],
        "operatorActivity": [dict(row) for row in activity_rows],
    }


def csv_export(report: dict) -> str:
    from csv import DictWriter

    output = StringIO(newline="")
    writer = DictWriter(
        output, fieldnames=CSV_HEADERS, extrasaction="ignore", lineterminator="\r\n"
    )

    def write_row(row: dict) -> None:
        writer.writerow(
            {
                key: f"'{value}"
                if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r"))
                else value
                for key, value in row.items()
            }
        )

    writer.writeheader()
    for match in report["matches"]:
        write_row(
            {
                "tipo": "partido",
                "fecha": match["kickoff_at"].isoformat(),
                "competicion": match["competition"],
                "partido": f"{match['home_team']} - {match['away_team']}",
                "estado": match["status"],
                "detalle": f"{match['home_score'] or 0}-{match['away_score'] or 0}",
            }
        )
    for odds in report["oddsChanges"]:
        write_row(
            {
                "tipo": "cambio_cuota",
                "fecha": odds["changed_at"].isoformat(),
                "competicion": odds["competition"],
                "partido": odds["match"],
                "detalle": f"{odds['market_type']} {odds['line'] or ''} {odds['selection']}",
                "fuente": odds["source"],
                "cuota_anterior": odds["previous_odds"],
                "cuota_nueva": odds["new_odds"],
                "actor": odds["actor"],
            }
        )
    for action in report["operatorActivity"]:
        write_row(
            {
                "tipo": "actividad_operador",
                "fecha": action["created_at"].isoformat(),
                "competicion": action["competition"],
                "partido": action["match"],
                "estado": action["status"],
                "detalle": action["action"],
                "actor": action["actor"],
            }
        )
    return "\ufeff" + output.getvalue()


def pdf_export(report: dict) -> bytes:
    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=landscape(A4),
        rightMargin=12 * mm,
        leftMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )
    styles = getSampleStyleSheet()
    styles["BodyText"].alignment = TA_LEFT
    story = [
        Paragraph("Dashboard operativo de partidos", styles["Title"]),
        Paragraph(
            f"Periodo UTC: {report['filters']['from']} — {report['filters']['to']}<br/>"
            f"Competición: {report['filters']['competitionId'] or 'Todas'} | "
            f"Estado: {report['filters']['status'] or 'Todos'}<br/>"
            f"Generado: {report['generatedAt']}",
            styles["BodyText"],
        ),
        Spacer(1, 5 * mm),
        Paragraph(
            f"Resumen: {report['summary']['matches']} partidos; "
            f"{report['summary']['oddsChanges']} cambios de cuota; "
            f"{report['summary']['operatorActions']} acciones de operador.",
            styles["Heading2"],
        ),
    ]

    def add_table(title: str, headers: list[str], rows: list[list[str]]) -> None:
        story.append(Paragraph(title, styles["Heading2"]))
        table = Table([headers, *rows], repeatRows=1, hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1b332f")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#b8c5c1")),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#f2f5f4")],
                    ),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(table)

    add_table(
        "Partidos y mercados",
        ["Inicio UTC", "Competición", "Partido", "Estado", "Marcador", "Mercados A/S/C"],
        [
            [
                row["kickoff_at"].isoformat(),
                row["competition"] or "—",
                f"{row['home_team']} - {row['away_team']}",
                row["status"],
                f"{row['home_score'] if row['home_score'] is not None else '—'}-"
                f"{row['away_score'] if row['away_score'] is not None else '—'}",
                f"{row['open_markets']}/{row['suspended_markets']}/{row['closed_markets']}",
            ]
            for row in report["matches"]
        ],
    )
    add_table(
        "Cambios recientes de cuotas",
        [
            "Fecha UTC",
            "Competición",
            "Partido",
            "Mercado",
            "Selección",
            "Fuente",
            "Anterior",
            "Nueva",
        ],
        [
            [
                row["changed_at"].isoformat(),
                row["competition"] or "—",
                row["match"],
                f"{row['market_type']} {row['line'] or ''}",
                row["selection"],
                row["source"],
                row["previous_odds"] or "—",
                row["new_odds"],
            ]
            for row in report["oddsChanges"]
        ],
    )
    add_table(
        "Actividad de operadores",
        ["Fecha UTC", "Competición", "Partido", "Acción", "Usuario"],
        [
            [
                row["created_at"].isoformat(),
                row["competition"] or "—",
                row["match"],
                row["action"],
                row["actor"],
            ]
            for row in report["operatorActivity"]
        ],
    )
    document.build(story)
    return output.getvalue()


@app.get("/health")
async def health_check() -> dict:
    return {
        "status": "ok",
        "service": "reports",
        "timestamp": datetime.now(UTC).isoformat(),
        "version": APP_VERSION,
    }


@app.get("/dashboard")
async def dashboard(
    _: Annotated[None, Depends(require_service_token)],
    connection: Annotated[asyncpg.Connection, Depends(read_only_connection)],
    from_: Annotated[datetime, Query(alias="from")],
    to: Annotated[datetime, Query()],
    competition_id: Annotated[UUID | None, Query(alias="competitionId")] = None,
    status: Annotated[str | None, Query()] = None,
) -> dict:
    filters = report_filters(from_, to, competition_id, status)
    return await load_report(connection, filters)


@app.get("/export")
async def export_report(
    _: Annotated[None, Depends(require_service_token)],
    connection: Annotated[asyncpg.Connection, Depends(read_only_connection)],
    from_: Annotated[datetime, Query(alias="from")],
    to: Annotated[datetime, Query()],
    format_: Annotated[str, Query(alias="format", pattern="^(csv|pdf)$")],
    competition_id: Annotated[UUID | None, Query(alias="competitionId")] = None,
    status: Annotated[str | None, Query()] = None,
) -> Response:
    filters = report_filters(from_, to, competition_id, status)
    report = await load_report(connection, filters)
    total_rows = sum(len(report[key]) for key in ("matches", "oddsChanges", "operatorActivity"))
    if total_rows > MAX_ROWS:
        raise HTTPException(
            status_code=422,
            detail=f"La exportación supera el máximo de {MAX_ROWS} filas; añade filtros.",
        )
    if format_ == "csv":
        return Response(
            content=csv_export(report),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="informe-partidos.csv"'},
        )
    return Response(
        content=pdf_export(report),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="informe-partidos.pdf"'},
    )
