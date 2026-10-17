from dataclasses import dataclass, field
from pathlib import Path
import os

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///api/runtime/vitalwatch.db"))
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: tuple(os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8000,http://localhost:8000").split(",")))
    cookie_secure: bool = field(default_factory=lambda: os.getenv("COOKIE_SECURE", "false").lower() == "true")
    session_hours: int = field(default_factory=lambda: int(os.getenv("SESSION_HOURS", "8")))
    seed_demo: bool = field(default_factory=lambda: os.getenv("DEMO_SEED", "true").lower() == "true")
    seed_held_out: bool = field(default_factory=lambda: os.getenv("DEMO_HELD_OUT", "true").lower() == "true")
    credentials_path: Path = field(default_factory=lambda: ROOT / ".demo-credentials.json")
    clinician_password: str | None = field(default_factory=lambda: os.getenv("DEMO_CLINICIAN_PASSWORD") or None)
    family_password: str | None = field(default_factory=lambda: os.getenv("DEMO_FAMILY_PASSWORD") or None)
    prediction_provider: str = field(default_factory=lambda: os.getenv("PREDICTION_PROVIDER", "lightgbm"))
    model_path: Path = field(default_factory=lambda: Path(os.getenv("SEPSIS_MODEL_PATH", str(ROOT.parent / "models/model_v1.txt"))))
    thresholds_path: Path = field(default_factory=lambda: Path(os.getenv("SEPSIS_THRESHOLDS_PATH", str(ROOT.parent / "models/thresholds_v1.json"))))
    alert_policy: str = field(default_factory=lambda: os.getenv("SEPSIS_ALERT_POLICY", "5pct_false_alert_patients"))
    language_provider: str = field(default_factory=lambda: os.getenv("LANGUAGE_PROVIDER", "disconnected"))
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL") or "gemini-3.5-flash-lite")
    gemini_fallback_models: tuple[str, ...] = field(default_factory=lambda: tuple(m.strip() for m in os.getenv("GEMINI_FALLBACK_MODELS", "").split(",") if m.strip()))
    ai_timeout: float = field(default_factory=lambda: float(os.getenv("AI_TIMEOUT_SECONDS", "20")))
    ai_interval: float = field(default_factory=lambda: float(os.getenv("AI_MIN_INTERVAL_SECONDS", "10")))
    ai_max_output: int = field(default_factory=lambda: int(os.getenv("AI_MAX_OUTPUT_TOKENS", "2048")))
    ai_context_chars: int = 48000
    start_clock: bool = True
    frontend_dist: Path = field(default_factory=lambda: ROOT.parent / "frontend" / "dist")
