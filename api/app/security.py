import hashlib
import secrets
import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select

from .models import AuthSession, User

COOKIE = "vitalwatch_session"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def get_db(request: Request):
    with request.app.state.sessions() as db:
        yield db


def current_user(request: Request, db=Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE, "")
    session = db.get(AuthSession, digest(token)) if token else None
    if not session or session.expires <= time.time():
        raise HTTPException(401, "Please sign in")
    user = db.get(User, session.user_id)
    if not user:
        raise HTTPException(401, "Please sign in")
    request.state.auth = session
    return user


def clinician(user=Depends(current_user)):
    if user.role != "clinician":
        raise HTTPException(403, "Clinical access required")
    return user


def writing_user(request: Request, user=Depends(current_user)):
    if not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), request.state.auth.csrf):
        raise HTTPException(403, "Invalid CSRF token")
    return user


async def writing_clinician(request: Request, user=Depends(writing_user)):
    if user.role != "clinician":
        raise HTTPException(403, "Clinical access required")
    async with request.app.state.clock_lock:
        yield user


def public_user(user: User):
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}
