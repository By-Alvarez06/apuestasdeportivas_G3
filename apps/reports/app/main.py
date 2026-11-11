"""Reports service — FastAPI application for the sports betting dashboard."""

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

APP_VERSION = "0.1.0"

app = FastAPI(
    title="Apuestas Deportivas — Reports",
    version=APP_VERSION,
    description="Servicio de reportes (solo lectura) para el dashboard de administración.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "reports",
        "timestamp": datetime.now(UTC).isoformat(),
        "version": APP_VERSION,
    }
