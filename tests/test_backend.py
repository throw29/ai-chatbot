import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from app.config import Settings
from app.schemas import ChatMessage, ChatRequest, PersonaProfile
from app.service import ChatService, ChatServiceError
from fastapi.testclient import TestClient
from app.main import app


class SchemaTests(unittest.TestCase):
    def test_names_normalize_before_length_validation(self):
        profile = PersonaProfile(name='  ' + '晚' * 16 + '  ', personality='gentle')
        self.assertEqual(profile.name, '晚' * 16)

    def test_invalid_personas_rejected(self):
        for name, personality in [('', 'gentle'), ('晚' * 17, 'gentle'), (23, 'gentle'), ('晚晚', 'unknown')]:
            with self.subTest(name=name), self.assertRaises(ValidationError):
                PersonaProfile(name=name, personality=personality)

    def test_context_validation(self):
        persona = {'name': '晚晚', 'personality': 'gentle'}
        for messages in [[], [{'role': 'assistant', 'content': 'hi'}], [{'role': 'user', 'content': ' '}], [{'role': 'user', 'content': 'x' * 20001}]]:
            with self.subTest(messages=messages[:1]), self.assertRaises(ValidationError):
                ChatRequest(messages=messages, persona=persona)


class ApiTests(unittest.TestCase):
    def test_static_health_and_error_contracts(self):
        settings = Settings(_env_file=None, anthropic_api_key=None, anthropic_auth_token=None)
        with patch('app.main.get_settings', return_value=settings), TestClient(app) as client:
            self.assertEqual(client.get('/').status_code, 200)
            self.assertIn('setupScreen', client.get('/').text)
            self.assertEqual(client.get('/static/css/romantic.css').status_code, 200)
            self.assertEqual(client.get('/openapi.json').json()['info']['version'], '0.2.1')
            health = client.get('/api/health')
            self.assertFalse(health.json()['configured'])
            self.assertEqual(health.headers['x-content-type-options'], 'nosniff')
            messages = [{'role': 'user', 'content': 'hello'}]
            self.assertEqual(client.post('/api/chat', json={'messages': messages}).status_code, 422)
            result = client.post('/api/chat', json={'messages': messages, 'persona': {'name': '晚晚', 'personality': 'gentle'}})
            self.assertEqual(result.status_code, 503)


class FakeStream:
    def __init__(self, delay=0, text='你好', reason='end_turn'):
        self.delay, self.text, self.reason, self.closed = delay, text, reason, False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True

    async def get_final_message(self):
        await asyncio.sleep(self.delay)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=self.text)], stop_reason=self.reason, usage=None)


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    def make_service(self, stream):
        settings = Settings(_env_file=None, anthropic_api_key=None, anthropic_auth_token=None)
        service = ChatService(settings)
        service.settings = settings.model_copy(update={'request_timeout_seconds': 0.02})
        service._client = SimpleNamespace(messages=SimpleNamespace(stream=lambda **kw: stream))
        return service

    async def reply(self, service):
        return await service.reply([ChatMessage(role='user', content='你好')], PersonaProfile(name='晚晚', personality='gentle'))

    async def test_total_deadline_closes_stream_and_returns_504(self):
        stream = FakeStream(delay=10)
        with self.assertRaises(ChatServiceError) as caught:
            await asyncio.wait_for(self.reply(self.make_service(stream)), timeout=1)
        self.assertEqual(caught.exception.status_code, 504)
        self.assertTrue(stream.closed)

    async def test_success_and_empty_reply(self):
        self.assertEqual((await self.reply(self.make_service(FakeStream()))).reply, '你好')
        with self.assertRaises(ChatServiceError):
            await self.reply(self.make_service(FakeStream(text=' ')))

    async def test_external_cancellation_is_not_swallowed(self):
        stream = FakeStream(delay=10)
        task = asyncio.create_task(self.reply(self.make_service(stream)))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(stream.closed)

    def test_sdk_retries_disabled(self):
        with patch('app.service.anthropic.AsyncAnthropic') as client:
            ChatService(Settings(_env_file=None, anthropic_api_key='test-placeholder'))
        self.assertEqual(client.call_args.kwargs['max_retries'], 0)


if __name__ == '__main__':
    unittest.main()
