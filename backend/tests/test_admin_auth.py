import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.admin_auth import (
    ROLE_PERMISSIONS,
    authenticate_token,
    create_user,
    delete_user,
    get_user,
    hash_password,
    list_users,
    login_user,
    required_permission,
    reset_password,
    update_user,
    verify_password,
)


class AdminAuthTests(unittest.TestCase):
    def test_password_hash_round_trip(self):
        encoded = hash_password("very-secure-password")
        self.assertTrue(verify_password("very-secure-password", encoded))
        self.assertFalse(verify_password("wrong-password", encoded))
        self.assertNotIn("very-secure-password", encoded)

    def test_static_owner_token_remains_bootstrap_fallback(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"CHESSAPP_ADMIN_TOKEN": "owner-secret"}, clear=False
        ):
            principal = authenticate_token("owner-secret", Path(directory) / "users.sqlite3")
        self.assertEqual(principal.role, "owner")
        self.assertEqual(principal.auth_type, "bootstrap")
        self.assertIn("users.manage", principal.permissions)

    def test_account_session_and_role_change_invalidate_session(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "users.sqlite3"
            user = create_user(
                "mod.one",
                "Moderator One",
                "moderator-password-123",
                "moderator",
                database=database,
            )
            token, expires, principal = login_user(
                "mod.one", "moderator-password-123", database=database
            )
            self.assertGreater(expires, 0)
            self.assertEqual(principal.id, user["id"])
            self.assertIn("books.write", principal.permissions)
            self.assertNotIn("puzzles.write", principal.permissions)
            self.assertEqual(authenticate_token(token, database).username, "mod.one")

            updated = update_user(user["id"], role="user", database=database)
            self.assertEqual(updated["role"], "user")
            with self.assertRaises(PermissionError):
                authenticate_token(token, database)
            with self.assertRaises(PermissionError):
                login_user("mod.one", "moderator-password-123", database=database)

    def test_password_reset_revokes_old_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "users.sqlite3"
            user = create_user(
                "admin.one",
                "Admin One",
                "original-password-123",
                "admin",
                database=database,
            )
            token, _, _ = login_user("admin.one", "original-password-123", database=database)
            reset_password(user["id"], "replacement-password-456", database)
            with self.assertRaises(PermissionError):
                authenticate_token(token, database)
            with self.assertRaises(PermissionError):
                login_user("admin.one", "original-password-123", database=database)
            _, _, principal = login_user("admin.one", "replacement-password-456", database=database)
            self.assertEqual(principal.role, "admin")

    def test_crud_users(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "users.sqlite3"
            user = create_user(
                "owner.two",
                "Owner Two",
                "owner-password-123",
                "owner",
                database=database,
            )
            self.assertEqual(len(list_users(database)), 1)
            updated = update_user(user["id"], display_name="Renamed Owner", enabled=False, database=database)
            self.assertEqual(updated["displayName"], "Renamed Owner")
            self.assertFalse(updated["enabled"])
            self.assertIsNotNone(get_user(user["id"], database))
            delete_user(user["id"], database)
            self.assertIsNone(get_user(user["id"], database))

    def test_permission_matrix(self):
        self.assertIn("users.manage", ROLE_PERMISSIONS["owner"])
        self.assertNotIn("users.manage", ROLE_PERMISSIONS["admin"])
        self.assertIn("books.write", ROLE_PERMISSIONS["moderator"])
        self.assertNotIn("puzzles.write", ROLE_PERMISSIONS["moderator"])
        self.assertEqual(ROLE_PERMISSIONS["user"], frozenset())
        self.assertEqual(required_permission("DELETE", "/api/admin/books/{job_id}"), "books.write")
        self.assertEqual(required_permission("POST", "/api/admin/puzzles/update"), "puzzles.write")
        self.assertEqual(required_permission("GET", "/api/admin/audit"), "audit.read")
        self.assertEqual(required_permission("PATCH", "/api/admin/users/{user_id}"), "users.manage")
        self.assertEqual(required_permission("GET", "/api/admin/books"), "admin.read")


if __name__ == "__main__":
    unittest.main()
