from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Zoho OAuth
    zoho_client_id: str
    zoho_client_secret: str
    zoho_refresh_token: str
    zoho_org_id: str
    
    # Security
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    
    # App
    debug: bool = False
    
    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()
