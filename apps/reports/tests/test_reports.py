"""Pruebas de validación y exportación del servicio de informes."""

import os
from datetime import UTC, datetime, timedelta, timezone

import asyncpg
import pytest
from app.main import app, csv_export, pdf_export, report_filters, where_clause
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

READONLY_TEST_URL = os.getenv("REPORTS_READONLY_TEST_URL")


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("REPORTS_SERVICE_TOKEN", "test-token")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_report_endpoints_require_service_token(client: AsyncClient):
    response = await client.get(
        "/dashboard",
        params={"from": "2026-11-14T00:00:00Z", "to": "2026-11-15T00:00:00Z"},
    )
    assert response.status_code == 401

    response = await client.get(
        "/dashboard",
        params={"from": "2026-11-14T00:00:00Z", "to": "2026-11-15T00:00:00Z"},
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 503


def test_report_filters_normalize_dates_and_bound_period():
    filters = report_filters(
        datetime(2026, 11, 14, tzinfo=UTC),
        datetime(2026, 11, 15, tzinfo=UTC),
        None,
        None,
    )
    assert filters["from"] == datetime(2026, 11, 14, tzinfo=UTC)
    assert filters["to"] == datetime(2026, 11, 15, tzinfo=UTC)

    with pytest.raises(HTTPException, match="posterior"):
        report_filters(
            datetime(2026, 11, 15, tzinfo=UTC),
            datetime(2026, 11, 14, tzinfo=UTC),
            None,
            None,
        )
    with pytest.raises(HTTPException, match="90 días"):
        report_filters(
            datetime(2026, 1, 1, tzinfo=UTC),
            datetime(2026, 4, 2, tzinfo=UTC),
            None,
            None,
        )


def test_report_query_uses_naive_utc_for_postgres_timestamp_columns():
    filters = report_filters(
        datetime(2026, 11, 13, 19, tzinfo=timezone(timedelta(hours=-5))),
        datetime(2026, 11, 14, 19, tzinfo=timezone(timedelta(hours=-5))),
        None,
        None,
    )
    _, params = where_clause('m."kickoffAt"', filters)
    assert params == [datetime(2026, 11, 14), datetime(2026, 11, 15)]


def test_csv_exports_stable_utf8_headers_and_escaped_values():
    report = {
        "matches": [
            {
                "kickoff_at": datetime(2026, 11, 14, tzinfo=UTC),
                "competition": 'Liga "A", Sur',
                "home_team": '=HYPERLINK("https://example.test")',
                "away_team": "Visitante",
                "status": "scheduled",
                "home_score": None,
                "away_score": None,
            }
        ],
        "oddsChanges": [],
        "operatorActivity": [],
    }

    exported = csv_export(report)
    assert exported.startswith("\ufefftipo,fecha,competicion,partido,estado,detalle,")
    assert '"Liga ""A"", Sur"' in exported
    assert '"\'=HYPERLINK(""https://example.test"") - Visitante"' in exported


def test_pdf_export_returns_a_readable_pdf_document():
    report = {
        "generatedAt": "2026-11-14T12:00:00+00:00",
        "filters": {
            "from": "2026-11-14T00:00:00+00:00",
            "to": "2026-11-15T00:00:00+00:00",
            "competitionId": None,
            "status": None,
        },
        "summary": {"matches": 0, "oddsChanges": 0, "operatorActions": 0},
        "matches": [],
        "oddsChanges": [],
        "operatorActivity": [],
    }
    assert pdf_export(report).startswith(b"%PDF-")


@pytest.mark.asyncio
@pytest.mark.skipif(
    not READONLY_TEST_URL,
    reason=(
        "Configura REPORTS_READONLY_TEST_URL con la cuenta apuestas_reports "
        "para verificar permisos."
    ),
)
async def test_reports_database_account_cannot_write_business_tables():
    assert READONLY_TEST_URL is not None
    connection = await asyncpg.connect(READONLY_TEST_URL)
    try:
        with pytest.raises(asyncpg.PostgresError):
            await connection.execute('UPDATE "Match" SET status = status WHERE false')
    finally:
        await connection.close()
