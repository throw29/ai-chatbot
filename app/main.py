"""FastAPI entry point and static front-end host for Aurora."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .config import get_settings
from .schemas import ChatRequest, ChatResponse, HealthResponse
from .service import ChatService, ChatServiceError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.chat_service = ChatService(settings)
    logger.info(
        "Aurora is ready — model=%s, configured=%s",
        settings.anthropic_model,
        settings.configured,
    )
    try:
        yield
    finally:
        await app.state.chat_service.aclose()


app = FastAPI(
    title="Aurora AI",
    description="A polished AI chat interface with a FastAPI + Anthropic backend.",
    version="0.1.1",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# The front end uses only same-origin assets, so a strict CSP is safe and adds
# defence in depth on top of DOMPurify's output sanitisation.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


app.add_middleware(SecurityHeadersMiddleware)


@app.get("/api/health", response_model=HealthResponse, tags=["chat"])
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    configured = request.app.state.chat_service.configured
    return HealthResponse(
        status="online" if configured else "unconfigured",
        configured=configured,
        model=settings.anthropic_model,
    )


@app.post("/api/chat", response_model=ChatResponse, tags=["chat"])
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    service: ChatService = request.app.state.chat_service
    try:
        result = await service.reply(payload.messages)
    except ChatServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return ChatResponse(
        reply=result.reply,
        model=request.app.state.settings.anthropic_model,
        usage=result.usage,
    )


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
