"""Pydantic schemas shared by the API and the model service."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_MESSAGES = 60
MAX_TOTAL_CHARACTERS = 120_000

PersonalityId = Literal["gentle", "tsundere", "sharp", "grumpy", "sunny", "cool"]


class PersonaProfile(BaseModel):
    """The girlfriend character selected by the visitor."""

    name: str = Field(min_length=1, max_length=16)
    personality: PersonalityId

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("女友名字必须是文字")
        cleaned = " ".join(value.strip().split())
        if not cleaned:
            raise ValueError("女友名字不能为空")
        if len(cleaned) > 16:
            raise ValueError("女友名字不能超过 16 个字符")
        if any(ord(character) < 32 for character in cleaned):
            raise ValueError("女友名字包含不支持的控制字符")
        return cleaned


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("消息内容不能为空")
        return value


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    persona: PersonaProfile

    @model_validator(mode="after")
    def validate_conversation(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("最后一条消息必须来自用户")

        total_characters = sum(len(message.content) for message in self.messages)
        if total_characters > MAX_TOTAL_CHARACTERS:
            raise ValueError("对话内容过长，请开启新对话后重试")

        # Anthropic expects the conversation to begin with a user turn.
        if self.messages[0].role != "user":
            raise ValueError("对话必须以用户消息开始")

        return self


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class ChatResponse(BaseModel):
    reply: str
    model: str
    usage: TokenUsage | None = None


class HealthResponse(BaseModel):
    status: Literal["online", "unconfigured"]
    configured: bool
    model: str
