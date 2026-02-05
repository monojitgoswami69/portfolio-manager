import os
import hashlib
import secrets
import logging
import re
from typing import Any
from dotenv import load_dotenv


class Settings:
    def __init__(self):
        load_dotenv(override=True)

        def get_req(key: str) -> str:
            val = os.getenv(key)
            if val is None or val.strip() == "":
                raise ValueError(f"Missing required environment variable: {key}")
            return val

        def get_opt(key: str, default: Any = None) -> Any:
            return os.getenv(key, default)

        # --- Server Settings ---
        self.LOG_LEVEL = get_opt("LOG_LEVEL", "INFO").upper()

        # --- Authentication ---
        self.JWT_SECRET = get_req("JWT_SECRET")
        self.JWT_ALGORITHM = get_opt("JWT_ALGORITHM", "HS256")
        self.JWT_EXPIRATION_MINUTES = int(get_opt("JWT_EXPIRATION_MINUTES", 60))  # 1 hour
        self.JWT_REFRESH_THRESHOLD_MINUTES = int(get_opt("JWT_REFRESH_THRESHOLD_MINUTES", 15))  # 15 min renewal window
        self.ADMIN_USERNAME = get_req("ADMIN_USERNAME")
        self._admin_password_hash = hashlib.sha256(get_req("ADMIN_PASSWORD").encode()).hexdigest()

        # --- Firebase ---
        self.FIREBASE_CRED_PATH = get_opt("FIREBASE_CRED_PATH")
        self.FIREBASE_CRED_BASE64 = get_opt("FIREBASE_CRED_BASE64")
        if not self.FIREBASE_CRED_PATH and not self.FIREBASE_CRED_BASE64:
            if not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
                raise ValueError("No Firebase credentials provided")

        # --- Firestore Collections ---
        self.KNOWLEDGE_COLLECTION = get_opt("KNOWLEDGE_COLLECTION", "chatbot-knowledge")
        self.METRICS_COLLECTION = get_opt("METRICS_COLLECTION", "metrics")
        self.WEEKLY_METRICS_COLLECTION = get_opt("WEEKLY_METRICS_COLLECTION", "weekly_metrics")
        self.ACTIVITY_LOG_COLLECTION = get_opt("ACTIVITY_LOG_COLLECTION", "activity_log")
        self.SYS_INS_HISTORY_COLLECTION = get_opt("SYS_INS_HISTORY_COLLECTION", "system_instructions_history")

        # --- GitHub Integration ---
        self.GITHUB_TOKEN = get_req("GITHUB_TOKEN")

        # Parse projects directory (format: owner/repo/path/to/projects.json)
        projects_dir = get_req("GITHUB_PROJECTS_DIRECTORY")
        self.GITHUB_REPO, self.GITHUB_PROJECTS_PATH = self._parse_github_path(projects_dir)

        # Parse contacts directory (format: owner/repo/path/to/contact.json)
        contacts_dir = get_req("GITHUB_CONTACTS_DIRECTORY")
        _, self.GITHUB_CONTACTS_PATH = self._parse_github_path(contacts_dir)

        # Parse project images directory (format: owner/repo/path/to/images)
        images_dir = get_opt("GITHUB_PROJECT_IMAGES_DIRECTORY")
        if images_dir:
            _, self.GITHUB_PROJECT_IMAGES_PATH = self._parse_github_path(images_dir)
        else:
            self.GITHUB_PROJECT_IMAGES_PATH = None

        self.GITHUB_BRANCH = get_opt("GITHUB_BRANCH", "main")
        self.HTTP_CLIENT_TIMEOUT = float(get_opt("HTTP_CLIENT_TIMEOUT", 60.0))

        # --- Rate Limiting ---
        self.RATE_LIMIT_DEFAULT = get_opt("RATE_LIMIT_DEFAULT", "100/minute")
        self.RATE_LIMIT_LOGIN = get_opt("RATE_LIMIT_LOGIN", "10/minute")
        self.RATE_LIMIT_SAVE = get_opt("RATE_LIMIT_SAVE", "20/minute")

        # --- Limits ---
        self.SYS_INS_MAX_CONTENT = int(get_opt("SYS_INS_MAX_CONTENT", 1_000_000))
        self.SYS_INS_MAX_MESSAGE = int(get_opt("SYS_INS_MAX_MESSAGE", 500))
        self.KNOWLEDGE_MAX_CONTENT = int(get_opt("KNOWLEDGE_MAX_CONTENT", 1_000_000))
        self.LOG_DEFAULT_LIMIT = int(get_opt("LOG_DEFAULT_LIMIT", 50))
        self.LOG_MAX_LIMIT = int(get_opt("LOG_MAX_LIMIT", 200))

    def verify_password(self, password: str) -> bool:
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        return secrets.compare_digest(password_hash, self._admin_password_hash)
    
    def _parse_github_path(self, full_path: str) -> tuple[str, str]:
        """Parse owner/repo/path/to/file.json into (owner/repo, path/to/file.json)"""
        parts = full_path.split('/', 2)
        if len(parts) < 3:
            raise ValueError(f"Invalid GitHub path format: {full_path}. Expected: owner/repo/path/to/file.json")
        repo = f"{parts[0]}/{parts[1]}"
        file_path = parts[2]
        return repo, file_path


# Initialize Settings
try:
    settings = Settings()
except Exception as e:
    print(f"[ERROR] Configuration Load Failed: {e}")
    exit(1)


# Configure Logging
class SanitizingFormatter(logging.Formatter):
    SENSITIVE_PATTERNS = [
        (re.compile(r'(Bearer\s+)[^\s]+', re.I), r'\1[REDACTED]'),
        (re.compile(r'(token["\']?\s*[:=]\s*["\']?)[^"\'\s]+', re.I), r'\1[REDACTED]'),
        (re.compile(r'(password["\']?\s*[:=]\s*["\']?)[^"\'\s]+', re.I), r'\1[REDACTED]'),
    ]

    def format(self, record):
        message = super().format(record)
        for pattern, replacement in self.SENSITIVE_PATTERNS:
            message = pattern.sub(replacement, message)
        return message


handler = logging.StreamHandler()
handler.setFormatter(SanitizingFormatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL, logging.INFO), handlers=[handler])
logger = logging.getLogger("portfolio-backend")
