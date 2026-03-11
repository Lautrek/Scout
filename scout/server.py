"""Scout FastAPI application."""

import logging
from datetime import datetime

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from scout.config import settings

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Scout",
    description="Job intelligence service",
    version="0.1.0",
)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "timestamp": datetime.utcnow().isoformat()})


@app.get("/api/v1/status")
async def status() -> JSONResponse:
    return JSONResponse(
        {
            "service": "scout",
            "environment": settings.environment,
            "scrapers": {
                "adzuna": bool(settings.adzuna_app_id and settings.adzuna_api_key),
                "jsearch": bool(settings.jsearch_api_key),
                "serpapi": bool(settings.serpapi_key),
            },
            "llm": bool(settings.anthropic_api_key),
        }
    )
