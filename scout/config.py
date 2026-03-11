"""Scout configuration via pydantic-settings."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SCOUT_", env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "sqlite+aiosqlite:///data/scout.db"
    host: str = "0.0.0.0"
    port: int = 9002
    log_level: str = "info"

    # Job search API keys (optional — scrapers degrade gracefully without them)
    adzuna_app_id: str = ""
    adzuna_api_key: str = ""
    jsearch_api_key: str = ""
    serpapi_key: str = ""

    # LLM (optional — agents use heuristics without it)
    anthropic_api_key: str = ""

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"

    @property
    def is_prod(self) -> bool:
        return self.environment == "production"


settings = Settings()
