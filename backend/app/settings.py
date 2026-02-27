from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # --- Mongo ---
    MONGODB_URI: str = "mongodb://mongo:27017"
    MONGODB_DB: str = "project_qa"

    # --- Auth mode (POC) ---
    AUTH_MODE: str = "dev"   # dev | local | entra (later)

    # --- Chroma ---
    CHROMA_ROOT: str = "/data/chroma_projects"

    # --- Web origin (CORS) ---
    WEB_ORIGIN: str = "http://localhost:3000"

    # Optional LLM
    LLM_BASE_URL: str | None = None
    LLM_API_KEY: str | None = None
    LLM_MODEL: str | None = None
    OPENAI_API_KEY: str | None = None
    PATH_PICKER_ROOTS: str = "/host/repos"

    BACKEND_DEBUG_MODE: bool = True
    APP_RUNTIME_MODE: str = "server"
    APP_BACKEND_ORIGIN: str = ""
    APP_STORAGE_ENGINE: str = "mongo"
    APP_VERSION: str = "dev"
    APP_BUILD_SHA: str | None = None
    DESKTOP_SESSION_ID: str | None = None
    RUNTIME_PROFILE_PATH: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
