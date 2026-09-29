"""ChessApp backend package."""

from . import admin as admin
from .admin_books import router as admin_books_router

# Keep the main app wiring unchanged: extend the existing protected admin router.
admin.router.include_router(admin_books_router)
