"""Local administration; no public account-registration endpoint."""
import argparse

from sqlalchemy import select

from .config import Settings
from .database import database, migrate
from .models import Assignment, Patient, User
from .seed import seed


def main():
    parser = argparse.ArgumentParser(description="Initialize VitalWatch or assign an existing family account")
    parser.add_argument("command", choices=["init", "assign"])
    parser.add_argument("email", nargs="?")
    parser.add_argument("patient_id", nargs="?")
    args = parser.parse_args()
    settings = Settings()
    engine, sessions = database(settings.database_url)
    migrate(engine)
    with sessions() as db:
        if args.command == "init":
            seed(db, settings)
            print(f"Workspace initialized. New demo credentials, if generated, are stored privately in {settings.credentials_path}.")
        else:
            user = db.scalar(select(User).where(User.email == (args.email or "").lower()))
            if not user or user.role != "family" or not db.get(Patient, args.patient_id):
                parser.error("Specify an existing family email and patient ID")
            if not db.scalar(select(Assignment).where(Assignment.user_id == user.id, Assignment.patient_id == args.patient_id)):
                db.add(Assignment(user_id=user.id, patient_id=args.patient_id))
                db.commit()
            print("Family patient assignment saved.")
    engine.dispose()


if __name__ == "__main__":
    main()
