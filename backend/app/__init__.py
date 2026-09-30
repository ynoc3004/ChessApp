"""ChessApp backend package."""

from .env import load_env_file

# Local secrets/config live in backend/.env. Existing process variables win.
load_env_file()

from . import admin as admin
from .admin_audit import router as admin_audit_router
from .admin_auth import users_router as admin_users_router
from .admin_books import router as admin_books_router
from .admin_dataset import router as admin_dataset_router
from .admin_maintenance import router as admin_maintenance_router

# Keep the main app wiring unchanged: extend the existing protected admin router.
admin.router.include_router(admin_books_router)
admin.router.include_router(admin_dataset_router)
admin.router.include_router(admin_audit_router)
admin.router.include_router(admin_users_router)
admin.router.include_router(admin_maintenance_router)
