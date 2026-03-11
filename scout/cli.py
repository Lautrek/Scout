"""Scout CLI entry point."""

import logging

import typer
import uvicorn

from scout.config import settings

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

app = typer.Typer(name="scout", help="Scout — job intelligence service")


@app.command()
def serve(
    host: str = typer.Option(settings.host, help="Bind host"),
    port: int = typer.Option(settings.port, help="Bind port"),
    reload: bool = typer.Option(False, help="Enable auto-reload (dev only)"),
) -> None:
    """Start the Scout HTTP server."""
    uvicorn.run(
        "scout.server:app",
        host=host,
        port=port,
        reload=reload,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    app()
