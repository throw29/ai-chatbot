"""Application configuration loaded from the project-level .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Runtime settings for the chat back end.

    Environment variable names are case-insensitive and map directly to the
    field names, so `ANTHROPIC_API_KEY` populates `anthropic_api_key`.
    """

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    anthropic_api_key: str | None = None
    anthropic_auth_token: str | None = None
    anthropic_base_url: str = "https://api.anthropic.com"
    anthropic_model: str = "claude-opus-5-5"
    anthropic_max_tokens: int = Field(default=4096, ge=256, le=16000)
    request_timeout_seconds: float = Field(default=180.0, ge=10, le=600)

    @property
    def configured(self) -> bool:
        """Whether at least one credential source is available."""
        return bool(
            (self.anthropic_api_key and self.anthropic_api_key.strip())
            or (self.anthropic_auth_token and self.anthropic_auth_token.strip())
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
