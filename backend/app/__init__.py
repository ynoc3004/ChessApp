"""ChessApp backend package."""

from .env import load_env_file

# Local secrets/config live in backend/.env. Existing process variables win.
load_env_file()

from . import admin as admin
from .academy import admin_router as academy_admin_router
from .academy_game_analysis import admin_router as academy_game_analysis_admin_router
from .academy_teacher import admin_router as academy_teacher_admin_router
from .academy_tournament import admin_router as academy_tournament_admin_router
from .admin_audit import router as admin_audit_router
from .admin_auth import users_router as admin_users_router
from .admin_books import router as admin_books_router
from .admin_dataset import router as admin_dataset_router
from .admin_maintenance import router as admin_maintenance_router
from .admin_model import router as admin_model_router
from .admin_restore import router as admin_restore_router
from .admin_review import router as admin_review_router

# Keep the main app wiring unchanged: extend the existing protected admin router.
admin.router.include_router(admin_books_router)
admin.router.include_router(admin_dataset_router)
admin.router.include_router(admin_model_router)
admin.router.include_router(admin_review_router)
admin.router.include_router(academy_admin_router)
admin.router.include_router(academy_teacher_admin_router)
admin.router.include_router(academy_tournament_admin_router)
admin.router.include_router(academy_game_analysis_admin_router)
admin.router.include_router(admin_audit_router)
admin.router.include_router(admin_users_router)
admin.router.include_router(admin_maintenance_router)
admin.router.include_router(admin_restore_router)

# Recognition v4 is intentionally attached here so the existing public API and
# scanner routes do not need to change. app.__init__ runs before app.main imports
# ``recognize_board``; therefore main receives the wrapped pipeline naturally.
from . import recognizer as _recognizer
from .specialist_model import apply_specialist_model as _apply_specialist_model

if not getattr(_recognizer.recognize_board, "_chessapp_specialist_v4", False):
    _base_recognize_board = _recognizer.recognize_board

    def _recognize_board_v4(image_path):
        base_result = _base_recognize_board(image_path)
        try:
            return _apply_specialist_model(image_path, base_result)
        except Exception:
            # The user-trained specialist is an enhancement, never a hard
            # dependency. Corrupt/missing local models must not break scanning.
            output = dict(base_result)
            output["specialistAvailable"] = False
            output["specialistCorrectedSquares"] = []
            return output

    _recognize_board_v4._chessapp_specialist_v4 = True  # type: ignore[attr-defined]
    _recognizer.recognize_board = _recognize_board_v4
