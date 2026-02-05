import time
from fastapi import APIRouter, Request, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from ..config import settings, logger
from ..dependencies import require_admin
from ..utils.limiter import limiter
from ..providers.github import github_provider
from ..providers.database.activity import activity_provider
from ..services.image_service import validate_image, convert_to_webp, generate_unique_filename

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


@router.get("")
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def get_projects(request: Request, user: dict = Depends(require_admin)):
    start_time = time.perf_counter()
    res = await github_provider.get_projects()
    elapsed = (time.perf_counter() - start_time) * 1000
    logger.info(f"Projects retrieved: {len(res['projects'])} items | {elapsed:.1f}ms")
    return {"status": "success", "projects": res["projects"], "commit": res.get("commit")}


@router.post("/upload-image")
@limiter.limit(settings.RATE_LIMIT_SAVE)
async def upload_project_image(
    request: Request,
    file: UploadFile = File(...),
    projectName: str = Form(...),
    user: dict = Depends(require_admin)
):
    """
    Upload and process a project image.
    - Validates file (type, size)
    - Converts to WebP format
    - Generates unique filename with collision detection
    - Uploads to GitHub
    - Returns auto-generated image URL for projects.json

    Returns:
        {"status": "success", "imageUrl": "public/projects/filename.webp", "filename": "..."}
    """
    start_time = time.perf_counter()

    # Validate image
    is_valid, error_msg = validate_image(file)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    # Convert to WebP
    image_bytes = await convert_to_webp(file)

    # Get existing images to check for collisions
    existing_images = await github_provider.list_images()

    # Generate unique filename
    filename = generate_unique_filename(projectName, existing_images)

    # Upload to GitHub
    try:
        await github_provider.upload_image(filename, image_bytes)
    except Exception as e:
        logger.error(f"Failed to upload image to GitHub: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload image to GitHub")

    # Generate public URL
    image_url = f"public/projects/{filename}"

    elapsed = (time.perf_counter() - start_time) * 1000
    logger.info(f"Image uploaded: {filename} | {elapsed:.1f}ms")

    return {
        "status": "success",
        "imageUrl": image_url,
        "filename": filename
    }



@router.post("/save")
@limiter.limit(settings.RATE_LIMIT_SAVE)
async def save_projects(request: Request, background_tasks: BackgroundTasks, user: dict = Depends(require_admin)):
    start_time = time.perf_counter()
    req = await request.json()
    projects = req.get("projects", [])
    message = req.get("message")
    old_projects = req.get("oldProjects", [])  # Previous state for comparison

    if not isinstance(projects, list):
        raise HTTPException(400, "Projects must be a list")

    # Clean up old images when projects are updated
    if old_projects:
        await _cleanup_deleted_images(projects, old_projects)

    # Save to GitHub
    res = await github_provider.save_projects(projects, message or f"Update by {user['username']}")

    # Log activity in background
    background_tasks.add_task(
        activity_provider.log_activity,
        "projects_updated",
        user["uid"],
        "projects",
        "main",
        {"count": len(projects)}
    )

    elapsed = (time.perf_counter() - start_time) * 1000
    logger.info(f"Projects saved: {len(projects)} items | {elapsed:.1f}ms")
    return {"status": "success", "message": "Projects saved", "commit": res.get("commit")}


async def _cleanup_deleted_images(new_projects: list, old_projects: list) -> None:
    """
    Compare old and new projects, delete images that are no longer used.

    Args:
        new_projects: Current project list
        old_projects: Previous project list
    """
    try:
        # Build set of current image URLs
        new_image_urls = {
            p.get("imageUrl")
            for p in new_projects
            if p.get("imageUrl") and p["imageUrl"].startswith("public/projects/")
        }

        # Build set of old image URLs
        old_image_urls = {
            p.get("imageUrl")
            for p in old_projects
            if p.get("imageUrl") and p["imageUrl"].startswith("public/projects/")
        }

        # Find deleted or changed images
        images_to_delete = old_image_urls - new_image_urls

        # Delete each orphaned image
        for image_url in images_to_delete:
            # Extract filename from "public/projects/filename.webp"
            filename = image_url.split("/")[-1]
            try:
                await github_provider.delete_image(filename)
                logger.info(f"Deleted orphaned image: {filename}")
            except Exception as e:
                logger.warning(f"Failed to delete image {filename}: {e}")

    except Exception as e:
        logger.error(f"Error during image cleanup: {e}")
        # Don't fail the whole save if cleanup fails
