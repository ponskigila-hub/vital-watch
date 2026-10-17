"""Tests must never inherit live API credentials from the developer's ignored .env."""
import pytest


@pytest.fixture(autouse=True)
def isolate_language_credentials(monkeypatch):
    monkeypatch.setenv('LANGUAGE_PROVIDER', 'disconnected')
    monkeypatch.setenv('GEMINI_API_KEY', '')
    monkeypatch.setenv('GEMINI_FALLBACK_MODELS', '')
