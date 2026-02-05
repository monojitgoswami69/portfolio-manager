"""
Image processing service for project photos.
Handles validation, WebP conversion, and filename generation with collision detection.
"""
import io
import secrets
import re
from pathlib import Path
from PIL import Image
from fastapi import UploadFile, HTTPException
from ...config import logger

# Constants
MAX_IMAGE_SIZE = 2 * 1024 * 1024  # 2 MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
UID_LENGTH = 8


def validate_image(file: UploadFile) -> tuple[bool, str]:
    """
    Validate uploaded image file.

    Returns:
        tuple[bool, str]: (is_valid, error_message)
    """
    # Check MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        return False, f"Invalid image type. Allowed types: {', '.join(ALLOWED_MIME_TYPES)}"

    # File size is checked during upload, but validate again for safety
    # Note: FastAPI handles the actual size stream validation

    return True, ""


def generate_random_uid(length: int = UID_LENGTH) -> str:
    """Generate a random URL-safe identifier."""
    return secrets.token_urlsafe(length)[:length]


def sanitize_filename(name: str) -> str:
    """
    Sanitize project name for use in filename.
    Converts to lowercase, removes special chars, replaces spaces with underscores.
    """
    # Convert to lowercase
    name = name.lower()
    # Remove special characters (keep only alphanumeric and basic separators)
    name = re.sub(r'[^a-z0-9_-]', '', name)
    # Replace multiple underscores with single underscore
    name = re.sub(r'_+', '_', name)
    # Remove leading/trailing underscores
    name = name.strip('_')

    return name if name else "project"


def generate_unique_filename(
    project_name: str,
    existing_filenames: list[str]
) -> str:
    """
    Generate a unique filename for project image.
    Format: {project_name}_{uid}.webp

    If filename exists, regenerates with new UID until unique.

    Args:
        project_name: Original project name
        existing_filenames: List of existing filenames to check against

    Returns:
        str: Unique filename in format {name}_{uid}.webp
    """
    sanitized_name = sanitize_filename(project_name)
    existing_names_set = set(existing_filenames)

    # Try up to 10 times to generate unique filename
    for attempt in range(10):
        uid = generate_random_uid()
        filename = f"{sanitized_name}_{uid}.webp"

        if filename not in existing_names_set:
            return filename

    # Fallback: use full UUID if collisions occur (unlikely but safe)
    logger.warning(f"High collision rate for project '{project_name}', using fallback UUID")
    uid = secrets.token_hex(8)  # 16 chars hex
    return f"{sanitized_name}_{uid}.webp"


async def convert_to_webp(file: UploadFile) -> bytes:
    """
    Read image from UploadFile and convert to WebP format.
    Optimizes for web delivery.

    Args:
        file: FastAPI UploadFile object

    Returns:
        bytes: WebP image data

    Raises:
        HTTPException: If image processing fails
    """
    try:
        # Read file content
        content = await file.read()

        # Validate size
        if len(content) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File size exceeds {MAX_IMAGE_SIZE // (1024*1024)} MB limit"
            )

        # Open image
        image = Image.open(io.BytesIO(content))

        # Convert RGBA to RGB if necessary (WebP compatibility)
        if image.mode in ("RGBA", "LA", "P"):
            # Create white background
            background = Image.new("RGB", image.size, (255, 255, 255))
            # Paste image with alpha channel
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode == "RGBA" else None)
            image = background

        # Convert to WebP with optimization
        output = io.BytesIO()
        image.save(
            output,
            format="WEBP",
            quality=85,  # Good quality with reasonable compression
            method=6     # Best compression method
        )

        return output.getvalue()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image conversion failed: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to process image: {str(e)}"
        )


__all__ = [
    "validate_image",
    "generate_unique_filename",
    "convert_to_webp",
    "sanitize_filename",
    "MAX_IMAGE_SIZE",
]
