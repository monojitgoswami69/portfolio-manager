"""
Portfolio Backend - Single File FastAPI Application
All routes, services, and providers in one file for simplicity.
"""
import os
import io
import re
import json
import base64
import secrets
import hashlib
import logging
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any

import jwt
import httpx
from PIL import Image
from dotenv import load_dotenv
from pydantic import BaseModel, EmailStr, Field
from google.cloud import firestore
from google.cloud.firestore_v1 import Query, FieldFilter
from google.oauth2 import service_account
from fastapi import FastAPI, Request, Depends, HTTPException, BackgroundTasks, Form, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# ============================================
# Configuration
# ============================================

load_dotenv(override=True)

def get_env(key: str, default: Any = None, required: bool = False) -> Any:
    """Get environment variable with optional default."""
    val = os.getenv(key)
    if val is None or val.strip() == "":
        if required:
            raise ValueError(f"Missing required environment variable: {key}")
        return default
    return val.strip()

# Server settings
HOST = get_env("HOST", "0.0.0.0")
PORT = int(get_env("PORT", 8000))
LOG_LEVEL = get_env("LOG_LEVEL", "INFO").upper()

# Authentication
JWT_SECRET = get_env("JWT_SECRET", required=True)
JWT_ALGORITHM = get_env("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_MINUTES = int(get_env("JWT_EXPIRATION_MINUTES", 60))
JWT_REFRESH_THRESHOLD_MINUTES = int(get_env("JWT_REFRESH_THRESHOLD_MINUTES", 15))
ADMIN_USERNAME = get_env("ADMIN_USERNAME", required=True)
ADMIN_PASSWORD_HASH = hashlib.sha256(get_env("ADMIN_PASSWORD", required=True).encode()).hexdigest()

# Firebase
FIREBASE_CRED_PATH = get_env("FIREBASE_CRED_PATH")
FIREBASE_CRED_BASE64 = get_env("FIREBASE_CRED_BASE64")

# Firestore Collections
METRICS_COLLECTION = get_env("METRICS_COLLECTION", "metrics")
WEEKLY_METRICS_COLLECTION = get_env("WEEKLY_METRICS_COLLECTION", "weekly_metrics")
ACTIVITY_LOG_COLLECTION = get_env("ACTIVITY_LOG_COLLECTION", "activity_log")
COMMUNICATION_COLLECTION = get_env("COMMUNICATION_COLLECTION", "communication")

# GitHub
GITHUB_TOKEN = get_env("GITHUB_TOKEN", required=True)
GITHUB_BRANCH = get_env("GITHUB_BRANCH", "main")
HTTP_TIMEOUT = float(get_env("HTTP_CLIENT_TIMEOUT", 60.0))

# Parse GitHub paths (format: owner/repo/path/to/file)
def parse_github_path(full_path: str) -> tuple:
    parts = full_path.split('/', 2)
    if len(parts) < 3:
        raise ValueError(f"Invalid GitHub path: {full_path}")
    return f"{parts[0]}/{parts[1]}", parts[2]

GITHUB_REPO, GITHUB_PROJECTS_PATH = parse_github_path(get_env("GITHUB_PROJECTS_DIRECTORY", required=True))
_, GITHUB_CONTACTS_PATH = parse_github_path(get_env("GITHUB_CONTACTS_DIRECTORY", required=True))
GITHUB_PROJECT_IMAGES_PATH = None
if get_env("GITHUB_PROJECT_IMAGES_DIRECTORY"):
    _, GITHUB_PROJECT_IMAGES_PATH = parse_github_path(get_env("GITHUB_PROJECT_IMAGES_DIRECTORY"))

# Knowledge and System Instructions can be in a different repo
GITHUB_KNOWLEDGE_REPO = None
GITHUB_KNOWLEDGE_PATH = None
if get_env("GITHUB_KNOWLEDGE_DIRECTORY"):
    GITHUB_KNOWLEDGE_REPO, GITHUB_KNOWLEDGE_PATH = parse_github_path(get_env("GITHUB_KNOWLEDGE_DIRECTORY"))

GITHUB_SYS_INS_REPO = None
GITHUB_SYS_INS_PATH = None
if get_env("GITHUB_SYSTEM_INSTRUCTIONS_PATH"):
    GITHUB_SYS_INS_REPO, GITHUB_SYS_INS_PATH = parse_github_path(get_env("GITHUB_SYSTEM_INSTRUCTIONS_PATH"))

# Limits
LOG_DEFAULT_LIMIT = int(get_env("LOG_DEFAULT_LIMIT", 50))
LOG_MAX_LIMIT = int(get_env("LOG_MAX_LIMIT", 200))

# ============================================
# Logging
# ============================================

class SanitizingFormatter(logging.Formatter):
    PATTERNS = [
        (re.compile(r'(Bearer\s+)[^\s]+', re.I), r'\1[REDACTED]'),
        (re.compile(r'(token["\']?\s*[:=]\s*["\']?)[^"\'\s]+', re.I), r'\1[REDACTED]'),
        (re.compile(r'(password["\']?\s*[:=]\s*["\']?)[^"\'\s]+', re.I), r'\1[REDACTED]'),
    ]
    def format(self, record):
        msg = super().format(record)
        for pattern, replacement in self.PATTERNS:
            msg = pattern.sub(replacement, msg)
        return msg

handler = logging.StreamHandler()
handler.setFormatter(SanitizingFormatter("%(asctime)s - %(levelname)s - %(message)s"))
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), handlers=[handler])
logger = logging.getLogger("portfolio-backend")

# ============================================
# Firestore Database
# ============================================

_db: Optional[firestore.AsyncClient] = None

def initialize_firebase():
    """Initialize Firebase/Firestore."""
    global _db
    if _db:
        return
    
    creds = None
    if FIREBASE_CRED_PATH and os.path.exists(FIREBASE_CRED_PATH):
        creds = service_account.Credentials.from_service_account_file(FIREBASE_CRED_PATH)
        logger.info(f"Firebase initialized from file: {FIREBASE_CRED_PATH}")
    elif FIREBASE_CRED_BASE64:
        # Remove whitespace (including newlines) from base64 string
        clean_base64 = FIREBASE_CRED_BASE64.replace('\n', '').replace(' ', '')
        cred_json = json.loads(base64.b64decode(clean_base64))
        creds = service_account.Credentials.from_service_account_info(cred_json)
        logger.info("Firebase initialized from base64 credentials")
    
    _db = firestore.AsyncClient(credentials=creds)

def get_db() -> firestore.AsyncClient:
    """Get Firestore client."""
    if not _db:
        initialize_firebase()
    return _db

async def close_db():
    """Close Firestore client."""
    global _db
    if _db:
        _db.close()
        _db = None

# ============================================
# JWT Authentication
# ============================================

def create_token(user_id: str, role: str = "admin") -> str:
    """Create JWT token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "uid": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRATION_MINUTES)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    """Decode and validate JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

def verify_password(password: str) -> bool:
    """Verify admin password."""
    return secrets.compare_digest(
        hashlib.sha256(password.encode()).hexdigest(),
        ADMIN_PASSWORD_HASH
    )

async def require_admin(request: Request) -> dict:
    """Dependency to require admin authentication."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization header")
    
    token = auth_header[7:]
    user = decode_token(token)
    
    # Check for token refresh (sliding expiration)
    exp = datetime.fromtimestamp(user["exp"], tz=timezone.utc)
    now = datetime.now(timezone.utc)
    remaining = (exp - now).total_seconds() / 60
    
    if remaining < JWT_REFRESH_THRESHOLD_MINUTES:
        new_token = create_token(user["uid"], user.get("role", "admin"))
        request.state.new_token = new_token
    
    return user

# ============================================
# GitHub API Client
# ============================================

async def github_request(method: str, path: str, data: dict = None, repo: str = None) -> dict:
    """Make GitHub API request."""
    target_repo = repo or GITHUB_REPO
    url = f"https://api.github.com/repos/{target_repo}/contents/{path}"
    
    # Use Bearer format for better compatibility with both classic and fine-grained tokens
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28"
    }
    
    if GITHUB_BRANCH:
        if method == "GET":
            url += f"?ref={GITHUB_BRANCH}"
        elif data:
            data["branch"] = GITHUB_BRANCH
    
    logger.debug(f"GitHub API {method} request to: {target_repo}/{path}")
    
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        try:
            if method == "GET":
                resp = await client.get(url, headers=headers)
            elif method == "PUT":
                resp = await client.put(url, headers=headers, json=data)
            elif method == "DELETE":
                resp = await client.delete(url, headers=headers, json=data)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            if resp.status_code == 404:
                logger.warning(f"GitHub API 404: {target_repo}/{path} not found")
                return None
            
            if resp.status_code == 401:
                logger.error("GitHub API 401: Invalid or expired token")
                raise HTTPException(401, "GitHub authentication failed. Check token permissions.")
            
            if resp.status_code == 403:
                error_msg = resp.json().get("message", "Forbidden")
                logger.error(f"GitHub API 403: {error_msg}")
                if "rate limit" in error_msg.lower():
                    raise HTTPException(429, "GitHub API rate limit exceeded")
                raise HTTPException(403, f"GitHub access denied: {error_msg}. Check token scopes for private repos.")
            
            resp.raise_for_status()
            return resp.json()
            
        except httpx.HTTPStatusError as e:
            logger.error(f"GitHub API error {e.response.status_code}: {e.response.text}")
            raise HTTPException(e.response.status_code, f"GitHub API error: {e.response.text}")
        except httpx.RequestError as e:
            logger.error(f"GitHub API request failed: {str(e)}")
            raise HTTPException(500, f"Failed to connect to GitHub: {str(e)}")

async def github_get_file(path: str, repo: str = None) -> tuple:
    """Get file content and SHA from GitHub."""
    result = await github_request("GET", path, repo=repo)
    if not result:
        return None, None
    content = base64.b64decode(result["content"]).decode("utf-8")
    return content, result["sha"]

async def github_save_file(path: str, content: str, message: str, sha: str = None, repo: str = None) -> dict:
    """Save file to GitHub."""
    data = {
        "message": message,
        "content": base64.b64encode(content.encode()).decode()
    }
    if sha:
        data["sha"] = sha
    return await github_request("PUT", path, data, repo=repo)

async def github_save_binary(path: str, binary_data: bytes, message: str, sha: str = None, repo: str = None) -> dict:
    """Save binary file to GitHub."""
    data = {
        "message": message,
        "content": base64.b64encode(binary_data).decode()
    }
    if sha:
        data["sha"] = sha
    return await github_request("PUT", path, data, repo=repo)

async def github_delete_file(path: str, message: str, sha: str, repo: str = None) -> dict:
    """Delete file from GitHub."""
    return await github_request("DELETE", path, {"message": message, "sha": sha}, repo=repo)

async def github_list_directory(path: str, repo: str = None) -> List[dict]:
    """List directory contents from GitHub."""
    result = await github_request("GET", path, repo=repo)
    if not result or not isinstance(result, list):
        return []
    return result

# ============================================
# Image Processing
# ============================================

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB

def validate_image(file: UploadFile) -> None:
    """Validate uploaded image file."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    
    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

async def convert_to_webp(file: UploadFile, max_size: int = 1200) -> bytes:
    """Convert image to WebP format."""
    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(400, f"File too large. Max size: {MAX_IMAGE_SIZE // (1024*1024)}MB")
    
    img = Image.open(io.BytesIO(content))
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    
    # Resize if too large
    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
    
    output = io.BytesIO()
    img.save(output, format="WEBP", quality=85, optimize=True)
    return output.getvalue()

def generate_image_filename(project_name: str) -> str:
    """Generate unique filename for project image."""
    slug = re.sub(r'[^a-z0-9]+', '-', project_name.lower()).strip('-')[:30]
    unique = secrets.token_hex(4)
    return f"{slug}-{unique}.webp"

# ============================================
# Pydantic Models
# ============================================

class LoginRequest(BaseModel):
    username: str
    password: str

class CommunicationSubmit(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    message: str = Field(..., min_length=1, max_length=2000)

class StatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(new|done|dismissed)$")

class ContentSave(BaseModel):
    content: str
    message: Optional[str] = None

class ContactSave(BaseModel):
    contact: dict
    message: Optional[str] = None

class ProjectsSave(BaseModel):
    projects: List[dict]
    message: Optional[str] = None
    oldProjects: Optional[List[dict]] = None

# ============================================
# Lifespan Context Manager
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("Starting Portfolio Backend...")
    initialize_firebase()
    logger.info("Portfolio Backend started successfully")
    yield
    logger.info("Shutting down...")
    await close_db()

# ============================================
# FastAPI Application
# ============================================

app = FastAPI(
    title="Portfolio Backend",
    description="Backend API for Portfolio Website Admin Dashboard",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-New-Token"],
)

# ============================================
# Exception Handlers
# ============================================

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(status_code=500, content={"status": "error", "message": "Internal server error"})

# ============================================
# Middleware
# ============================================

@app.middleware("http")
async def add_new_token_header(request: Request, call_next):
    response = await call_next(request)
    if hasattr(request.state, "new_token"):
        response.headers["X-New-Token"] = request.state.new_token
    return response



# ============================================
# Routes: Health & Root
# ============================================

@app.get("/")
async def root():
    return {"message": "Portfolio Backend API", "version": "2.0.0", "docs": "/docs"}

@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

# ============================================
# Routes: Authentication
# ============================================

@app.post("/api/v1/auth/login")
async def login(request: Request, data: LoginRequest):
    if data.username != ADMIN_USERNAME or not verify_password(data.password):
        raise HTTPException(401, "Invalid credentials")
    
    token = create_token(ADMIN_USERNAME, "admin")
    
    # Log activity
    try:
        db = get_db()
        await db.collection(ACTIVITY_LOG_COLLECTION).add({
            "type": "login",
            "user_id": ADMIN_USERNAME,
            "timestamp": datetime.now(timezone.utc),
            "details": {}
        })
    except Exception as e:
        logger.warning(f"Failed to log login activity: {e}")
    
    return {
        "status": "success",
        "token": token,
        "user": {"uid": ADMIN_USERNAME, "username": ADMIN_USERNAME, "role": "admin"}
    }

@app.post("/api/v1/auth/logout")
async def logout(user: dict = Depends(require_admin)):
    return {"status": "success", "message": "Logged out"}

# ============================================
# Routes: Dashboard
# ============================================

@app.get("/api/v1/dashboard/stats")
async def dashboard_stats(request: Request, user: dict = Depends(require_admin)):
    db = get_db()
    
    # Get metrics
    metrics_ref = db.collection(METRICS_COLLECTION).document("counters")
    metrics_doc = await metrics_ref.get()
    metrics = metrics_doc.to_dict() if metrics_doc.exists else {}
    
    return {
        "status": "success",
        "stats": {
            "total_queries": metrics.get("total_queries", 0),
            "total_uploads": metrics.get("total_uploads", 0),
            "total_logins": metrics.get("total_logins", 0)
        }
    }

@app.get("/api/v1/dashboard/activity")
async def dashboard_activity(request: Request, limit: int = 20, user: dict = Depends(require_admin)):
    limit = min(limit, LOG_MAX_LIMIT)
    db = get_db()
    
    query = db.collection(ACTIVITY_LOG_COLLECTION).order_by(
        "timestamp", direction=Query.DESCENDING
    ).limit(limit)
    
    activities = []
    async for doc in query.stream():
        data = doc.to_dict()
        data["id"] = doc.id
        if hasattr(data.get("timestamp"), "isoformat"):
            data["timestamp"] = data["timestamp"].isoformat()
        activities.append(data)
    
    return {"status": "success", "activity": activities}

@app.get("/api/v1/dashboard/weekly")
async def dashboard_weekly(request: Request, user: dict = Depends(require_admin)):
    db = get_db()
    
    # Get last 7 days of metrics
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=6)
    
    weekly = []
    query = db.collection(WEEKLY_METRICS_COLLECTION).where(
        filter=FieldFilter("date", ">=", start_date.isoformat())
    ).order_by("date")
    
    async for doc in query.stream():
        weekly.append(doc.to_dict())
    
    return {"status": "success", "weekly": weekly}

# ============================================
# Routes: Projects
# ============================================

@app.get("/api/v1/projects")
async def get_projects(request: Request, user: dict = Depends(require_admin)):
    content, sha = await github_get_file(GITHUB_PROJECTS_PATH)
    if not content:
        return {"status": "success", "projects": [], "commit": None}
    
    projects = json.loads(content)
    return {"status": "success", "projects": projects, "commit": sha[:7] if sha else None}

@app.post("/api/v1/projects/save")
async def save_projects(
    request: Request,
    data: ProjectsSave,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    _, sha = await github_get_file(GITHUB_PROJECTS_PATH)
    
    content = json.dumps(data.projects, indent=2)
    message = data.message or "Updated by portfolio manager"
    
    result = await github_save_file(GITHUB_PROJECTS_PATH, content, message, sha)
    
    # Cleanup unused images in background
    if data.oldProjects and GITHUB_PROJECT_IMAGES_PATH:
        background_tasks.add_task(cleanup_unused_images, data.projects, data.oldProjects)
    
    # Log activity
    background_tasks.add_task(log_activity, "projects_updated", user["uid"], "projects", None, {})
    
    return {"status": "success", "message": "Projects saved", "commit": result.get("commit", {}).get("sha", "")[:7]}

async def cleanup_unused_images(new_projects: List[dict], old_projects: List[dict]):
    """Remove images that are no longer used."""
    if not GITHUB_PROJECT_IMAGES_PATH:
        return
    
    new_images = {p.get("image", "").split("/")[-1] for p in new_projects if p.get("image")}
    old_images = {p.get("image", "").split("/")[-1] for p in old_projects if p.get("image")}
    
    to_delete = old_images - new_images
    
    for filename in to_delete:
        try:
            path = f"{GITHUB_PROJECT_IMAGES_PATH}/{filename}"
            files = await github_list_directory(GITHUB_PROJECT_IMAGES_PATH)
            for f in files:
                if f.get("name") == filename:
                    await github_delete_file(path, f"Delete unused image: {filename}", f["sha"])
                    logger.info(f"Deleted unused image: {filename}")
                    break
        except Exception as e:
            logger.warning(f"Failed to delete image {filename}: {e}")

@app.post("/api/v1/projects/upload-image")
async def upload_project_image(
    request: Request,
    file: UploadFile = File(...),
    projectName: str = Form(...),
    user: dict = Depends(require_admin)
):
    if not GITHUB_PROJECT_IMAGES_PATH:
        raise HTTPException(400, "Image uploads not configured")
    
    validate_image(file)
    webp_data = await convert_to_webp(file)
    filename = generate_image_filename(projectName)
    
    path = f"{GITHUB_PROJECT_IMAGES_PATH}/{filename}"
    await github_save_binary(path, webp_data, f"Upload project image: {filename}")
    
    # Return the relative URL path
    image_url = f"/projects/{filename}"
    
    return {"status": "success", "imageUrl": image_url, "filename": filename}

# ============================================
# Routes: Contacts
# ============================================

@app.get("/api/v1/contacts")
async def get_contacts(request: Request, user: dict = Depends(require_admin)):
    content, sha = await github_get_file(GITHUB_CONTACTS_PATH)
    if not content:
        return {"status": "success", "contact": {}, "commit": None}
    
    data = json.loads(content)
    # Extract the contact object from GitHub JSON (which has { contact: {...} } structure)
    contact = data.get("contact", {}) if isinstance(data, dict) else data
    return {"status": "success", "contact": contact, "commit": sha[:7] if sha else None}

@app.post("/api/v1/contacts/save")
async def save_contacts(
    request: Request,
    data: ContactSave,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    _, sha = await github_get_file(GITHUB_CONTACTS_PATH)
    
    content = json.dumps(data.contact, indent=2)
    message = data.message or "Updated by portfolio manager"
    
    result = await github_save_file(GITHUB_CONTACTS_PATH, content, message, sha)
    
    background_tasks.add_task(log_activity, "contacts_updated", user["uid"], "contacts", None, {})
    
    return {"status": "success", "message": "Contacts saved", "commit": result.get("commit", {}).get("sha", "")[:7]}

# ============================================
# Routes: Communication (Contact Form Submissions)
# ============================================

@app.post("/api/v1/communication/submit")
async def submit_communication(request: Request, data: CommunicationSubmit):
    """Public endpoint - no auth required."""
    db = get_db()
    
    doc_ref = db.collection(COMMUNICATION_COLLECTION).document()
    await doc_ref.set({
        "name": data.name,
        "email": data.email,
        "message": data.message,
        "status": "new",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc)
    })
    
    logger.info(f"Communication record created: {doc_ref.id}")
    
    return {
        "status": "success",
        "message": "Your message has been received!",
        "record_id": doc_ref.id
    }

@app.get("/api/v1/communication")
async def get_communication(
    request: Request,
    status: Optional[str] = None,
    user: dict = Depends(require_admin)
):
    db = get_db()
    query = db.collection(COMMUNICATION_COLLECTION)
    
    if status and status in ["new", "done", "dismissed"]:
        query = query.where(filter=FieldFilter("status", "==", status))
    
    query = query.order_by("created_at", direction=Query.DESCENDING).limit(100)
    
    records = []
    async for doc in query.stream():
        data = doc.to_dict()
        data["id"] = doc.id
        for field in ["created_at", "updated_at"]:
            if hasattr(data.get(field), "isoformat"):
                data[field] = data[field].isoformat()
        records.append(data)
    
    return {"status": "success", "records": records, "count": len(records)}

@app.patch("/api/v1/communication/{record_id}/status")
async def update_communication_status(
    request: Request,
    record_id: str,
    data: StatusUpdate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    db = get_db()
    doc_ref = db.collection(COMMUNICATION_COLLECTION).document(record_id)
    
    await doc_ref.update({
        "status": data.status,
        "updated_at": datetime.now(timezone.utc)
    })
    
    background_tasks.add_task(log_activity, "communication_updated", user["uid"], "communication", record_id, {"status": data.status})
    
    return {"status": "success", "message": f"Record marked as {data.status}"}

@app.delete("/api/v1/communication/{record_id}")
async def delete_communication(
    request: Request,
    record_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    db = get_db()
    await db.collection(COMMUNICATION_COLLECTION).document(record_id).delete()
    
    background_tasks.add_task(log_activity, "communication_deleted", user["uid"], "communication", record_id, {})
    
    return {"status": "success", "message": "Record deleted"}

# ============================================
# Routes: Knowledge Base
# ============================================

KNOWLEDGE_CATEGORIES = ["about_me", "tech_stack", "projects", "contact", "misc"]

@app.get("/api/v1/knowledge")
async def get_knowledge_all(request: Request, user: dict = Depends(require_admin)):
    if not GITHUB_KNOWLEDGE_PATH:
        raise HTTPException(400, "Knowledge base not configured")
    
    categories = {}
    for category in KNOWLEDGE_CATEGORIES:
        path = f"{GITHUB_KNOWLEDGE_PATH}/{category}.txt"
        content, _ = await github_get_file(path, repo=GITHUB_KNOWLEDGE_REPO)
        categories[category] = {"content": content or "", "exists": content is not None}
    
    return {"status": "success", "categories": categories}

@app.get("/api/v1/knowledge/categories")
async def get_knowledge_categories(request: Request, user: dict = Depends(require_admin)):
    return {"status": "success", "categories": KNOWLEDGE_CATEGORIES}

@app.get("/api/v1/knowledge/{category}")
async def get_knowledge_category(request: Request, category: str, user: dict = Depends(require_admin)):
    if not GITHUB_KNOWLEDGE_PATH:
        raise HTTPException(400, "Knowledge base not configured")
    if category not in KNOWLEDGE_CATEGORIES:
        raise HTTPException(400, f"Invalid category. Valid: {KNOWLEDGE_CATEGORIES}")
    
    path = f"{GITHUB_KNOWLEDGE_PATH}/{category}.txt"
    content, sha = await github_get_file(path, repo=GITHUB_KNOWLEDGE_REPO)
    
    return {
        "status": "success",
        "category": category,
        "content": content or "",
        "sha": sha
    }

@app.post("/api/v1/knowledge/{category}/save")
async def save_knowledge_category(
    request: Request,
    category: str,
    data: ContentSave,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    if not GITHUB_KNOWLEDGE_PATH:
        raise HTTPException(400, "Knowledge base not configured")
    if category not in KNOWLEDGE_CATEGORIES:
        raise HTTPException(400, f"Invalid category. Valid: {KNOWLEDGE_CATEGORIES}")
    
    path = f"{GITHUB_KNOWLEDGE_PATH}/{category}.txt"
    _, sha = await github_get_file(path, repo=GITHUB_KNOWLEDGE_REPO)
    
    message = data.message or "Updated by portfolio manager"
    result = await github_save_file(path, data.content, message, sha, repo=GITHUB_KNOWLEDGE_REPO)
    
    background_tasks.add_task(log_activity, "knowledge_updated", user["uid"], "knowledge", category, {})
    
    return {"status": "success", "message": f"{category} saved", "commit": result.get("commit", {}).get("sha", "")[:7]}

# ============================================
# Routes: System Instructions
# ============================================

@app.get("/api/v1/system-instructions")
async def get_system_instructions(request: Request, user: dict = Depends(require_admin)):
    if not GITHUB_SYS_INS_PATH:
        raise HTTPException(400, "System instructions not configured")
    
    content, sha = await github_get_file(GITHUB_SYS_INS_PATH, repo=GITHUB_SYS_INS_REPO)
    
    return {
        "status": "success",
        "content": content or "",
        "sha": sha
    }

@app.post("/api/v1/system-instructions/save")
async def save_system_instructions(
    request: Request,
    data: ContentSave,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    if not GITHUB_SYS_INS_PATH:
        raise HTTPException(400, "System instructions not configured")
    
    _, sha = await github_get_file(GITHUB_SYS_INS_PATH, repo=GITHUB_SYS_INS_REPO)
    
    message = data.message or "Updated by portfolio manager"
    result = await github_save_file(GITHUB_SYS_INS_PATH, data.content, message, sha, repo=GITHUB_SYS_INS_REPO)
    
    background_tasks.add_task(log_activity, "system_instructions_updated", user["uid"], "system_instructions", None, {})
    
    return {"status": "success", "message": "System instructions saved", "commit": result.get("commit", {}).get("sha", "")[:7]}

# ============================================
# Utility Functions
# ============================================

async def log_activity(action: str, user_id: str, resource_type: str, resource_id: str = None, details: dict = None):
    """Log activity to Firestore."""
    try:
        db = get_db()
        await db.collection(ACTIVITY_LOG_COLLECTION).add({
            "type": action,
            "user_id": user_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details or {},
            "timestamp": datetime.now(timezone.utc)
        })
    except Exception as e:
        logger.warning(f"Failed to log activity: {e}")

# ============================================
# Entry Point
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
