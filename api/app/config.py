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
    credentials_path: Path = field(default_factory=lambda: ROOT / ".demo-credentials.json")
    clinician_password: str | None = field(default_factory=lambda: os.getenv("DEMO_CLINICIAN_PASSWORD") or None)
    family_password: str | None = field(default_factory=lambda: os.getenv("DEMO_FAMILY_PASSWORD") or None)
    start_clock: bool = True
    frontend_dist: Path = field(default_factory=lambda: ROOT.parent / "frontend" / "dist")
