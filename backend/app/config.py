from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gigachat_credentials: str
    gigachat_scope: str = "GIGACHAT_API_CORP"
    gigachat_model: str = "GigaChat-2-Max"
    gigachat_verify_ssl: bool = False

    database_url: str = "sqlite+aiosqlite:///./data/gigame.db"
    redis_url: str = "redis://localhost:6379/0"
    chroma_persist_dir: str = "./data/chroma"
    upload_dir: str = "./data/uploads"

    model_config = {"env_file": "../.env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
