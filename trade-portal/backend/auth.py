import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from models import TradeAccount, get_db

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7  # one week

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)


def create_access_token(account_id: int) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": str(account_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_account(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> TradeAccount:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        account_id_raw: Optional[str] = payload.get("sub")
        if account_id_raw is None:
            raise cred_exc
        account_id = int(account_id_raw)
    except (JWTError, ValueError):
        raise cred_exc

    account = db.query(TradeAccount).filter(TradeAccount.id == account_id).first()
    if account is None:
        raise cred_exc
    return account


def require_approved(account: TradeAccount = Depends(get_current_account)) -> TradeAccount:
    if account.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Trade account is {account.status}. Please wait for approval.",
        )
    return account
