"""
GitHub provider for system instructions and projects.
Supports fetching and pushing content to GitHub repositories.
"""
import httpx
import base64
import json
from typing import Optional

from ...config import settings, logger
from ...exceptions import GitHubError


class GitHubProvider:
    """GitHub-based storage for system instructions and projects."""

    def __init__(self):
        self.token = settings.GITHUB_TOKEN
        self.branch = settings.GITHUB_BRANCH
        self.repo = settings.GITHUB_REPO

    def _headers(self):
        return {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"Bearer {self.token}",
            "User-Agent": "Portfolio-Backend"
        }

    async def _get_sha(self, path: str) -> Optional[str]:
        """Get the SHA of a file for updates."""
        try:
            async with httpx.AsyncClient(timeout=settings.HTTP_CLIENT_TIMEOUT) as client:
                r = await client.get(
                    f"https://api.github.com/repos/{self.repo}/contents/{path}?ref={self.branch}",
                    headers=self._headers()
                )
                return r.json().get("sha") if r.status_code == 200 else None
        except Exception as e:
            logger.error(f"Failed to get SHA for {path}: {e}")
            return None

    async def _get_file(self, path: str) -> dict:
        """Get file content from GitHub."""
        async with httpx.AsyncClient(timeout=settings.HTTP_CLIENT_TIMEOUT) as client:
            r = await client.get(
                f"https://api.github.com/repos/{self.repo}/contents/{path}?ref={self.branch}",
                headers=self._headers()
            )
            if r.status_code == 404:
                return {"content": "", "sha": None}
            if r.status_code != 200:
                raise GitHubError(f"Failed to fetch {path}: status {r.status_code}")
            data = r.json()
            content = base64.b64decode(data.get("content", "").replace("\n", "")).decode('utf-8')
            return {"content": content, "sha": data.get("sha")}

    async def _save_file(self, path: str, content: str, message: str) -> dict:
        """Save file content to GitHub."""
        sha = await self._get_sha(path)
        url = f"https://api.github.com/repos/{self.repo}/contents/{path}"
        data = {
            "message": message,
            "content": base64.b64encode(content.encode('utf-8')).decode('utf-8'),
            "branch": self.branch
        }
        if sha:
            data["sha"] = sha

        async with httpx.AsyncClient(timeout=settings.HTTP_CLIENT_TIMEOUT) as client:
            r = await client.put(url, headers=self._headers(), json=data)
            if r.status_code not in [200, 201]:
                error_msg = r.json().get("message", "Unknown error")
                raise GitHubError(f"Failed to save {path}: {error_msg}")
            res = r.json().get("commit", {})
            return {"sha": res.get("sha"), "success": True}

    # --- System Instructions ---
    async def get_instructions(self) -> dict:
        """Get system instructions from GitHub."""
        result = await self._get_file(settings.GITHUB_SYS_INS_PATH)
        return {"content": result["content"], "commit": result["sha"]}

    async def save_instructions(self, content: str, message: str) -> dict:
        """Save system instructions to GitHub."""
        result = await self._save_file(settings.GITHUB_SYS_INS_PATH, content, message)
        return {"commit": result["sha"], "success": True}

    # --- Projects ---
    async def get_projects(self) -> dict:
        """Get projects JSON from GitHub."""
        result = await self._get_file(settings.GITHUB_PROJECTS_PATH)
        if not result["content"]:
            return {"projects": [], "commit": None}
        try:
            projects = json.loads(result["content"])
            return {"projects": projects, "commit": result["sha"]}
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse projects JSON: {e}")
            raise GitHubError(f"Invalid projects JSON: {e}")

    async def save_projects(self, projects: list, message: str) -> dict:
        """Save projects JSON to GitHub."""
        content = json.dumps(projects, indent=4, ensure_ascii=False)
        result = await self._save_file(settings.GITHUB_PROJECTS_PATH, content, message)
        return {"commit": result["sha"], "success": True}

    # --- Contacts ---
    async def get_contacts(self) -> dict:
        """Get contacts JSON from GitHub."""
        result = await self._get_file(settings.GITHUB_CONTACTS_PATH)
        if not result["content"]:
            return {"contact": {"email": "", "socials": {}}, "commit": None}
        try:
            contacts = json.loads(result["content"])
            return {"contact": contacts.get("contact", {}), "commit": result["sha"]}
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse contacts JSON: {e}")
            raise GitHubError(f"Invalid contacts JSON: {e}")

    async def save_contacts(self, contact: dict, message: str) -> dict:
        """Save contacts JSON to GitHub."""
        content = json.dumps({"contact": contact}, indent=4, ensure_ascii=False)
        result = await self._save_file(settings.GITHUB_CONTACTS_PATH, content, message)
        return {"commit": result["sha"], "success": True}

    # --- Project Images ---
    async def upload_image(self, filename: str, image_bytes: bytes) -> dict:
        """
        Upload a project image to GitHub.

        Args:
            filename: Image filename (e.g., 'project_abc123.webp')
            image_bytes: Binary image content

        Returns:
            dict: {"sha": commit_sha, "success": True}

        Raises:
            GitHubError: If upload fails
        """
        if not settings.GITHUB_PROJECT_IMAGES_PATH:
            raise GitHubError("GITHUB_PROJECT_IMAGES_DIRECTORY not configured")

        path = f"{settings.GITHUB_PROJECT_IMAGES_PATH}/{filename}"
        sha = await self._get_sha(path)
        url = f"https://api.github.com/repos/{self.repo}/contents/{path}"

        data = {
            "message": f"Upload project image: {filename}",
            "content": base64.b64encode(image_bytes).decode('utf-8'),
            "branch": self.branch
        }
        if sha:
            data["sha"] = sha

        try:
            async with httpx.AsyncClient(timeout=settings.HTTP_CLIENT_TIMEOUT) as client:
                r = await client.put(url, headers=self._headers(), json=data)
                if r.status_code not in [200, 201]:
                    error_msg = r.json().get("message", "Unknown error")
                    raise GitHubError(f"Failed to upload image {filename}: {error_msg}")
                res = r.json().get("commit", {})
                return {"sha": res.get("sha"), "success": True}
        except Exception as e:
            logger.error(f"Failed to upload image {filename}: {e}")
            raise

    async def delete_image(self, filename: str) -> dict:
        """
        Delete a project image from GitHub.

        Args:
            filename: Image filename (e.g., 'project_abc123.webp')

        Returns:
            dict: {"sha": commit_sha, "success": True}

        Raises:
            GitHubError: If deletion fails or file not found
        """
        if not settings.GITHUB_PROJECT_IMAGES_PATH:
            raise GitHubError("GITHUB_PROJECT_IMAGES_DIRECTORY not configured")

        path = f"{settings.GITHUB_PROJECT_IMAGES_PATH}/{filename}"
        sha = await self._get_sha(path)

        if not sha:
            logger.warning(f"Image {filename} not found in GitHub, skipping deletion")
            return {"sha": None, "success": True}

        url = f"https://api.github.com/repos/{self.repo}/contents/{path}"
        data = {
            "message": f"Delete project image: {filename}",
            "sha": sha,
            "branch": self.branch
        }

        try:
            async with httpx.AsyncClient(timeout=settings.HTTP_CLIENT_TIMEOUT) as client:
                r = await client.delete(url, headers=self._headers(), json=data)
                if r.status_code not in [200, 204]:
                    error_msg = r.json().get("message", "Unknown error")
                    raise GitHubError(f"Failed to delete image {filename}: {error_msg}")
                if r.status_code == 200:
                    res = r.json().get("commit", {})
                    return {"sha": res.get("sha"), "success": True}
                return {"sha": None, "success": True}
        except Exception as e:
            logger.error(f"Failed to delete image {filename}: {e}")
            raise

    async def list_images(self) -> list[str]:
        """
        List all project images in GitHub directory.

        Returns:
            list[str]: List of image filenames

        Raises:
            GitHubError: If listing fails
        """
        if not settings.GITHUB_PROJECT_IMAGES_PATH:
            logger.warning("GITHUB_PROJECT_IMAGES_DIRECTORY not configured")
            return []

        url = f"https://api.github.com/repos/{self.repo}/contents/{settings.GITHUB_PROJECT_IMAGES_PATH}?ref={self.branch}"

        try:
            async with httpx.AsyncClient(timeout=settings.HTTP_CLIENT_TIMEOUT) as client:
                r = await client.get(url, headers=self._headers())

                if r.status_code == 404:
                    logger.info("Project images directory not found, returning empty list")
                    return []

                if r.status_code != 200:
                    logger.error(f"Failed to list images: status {r.status_code}")
                    return []

                items = r.json()
                if not isinstance(items, list):
                    return []

                # Filter only files (not directories)
                filenames = [item["name"] for item in items if item["type"] == "file"]
                return filenames

        except Exception as e:
            logger.error(f"Failed to list images from GitHub: {e}")
            return []


github_provider = GitHubProvider()
