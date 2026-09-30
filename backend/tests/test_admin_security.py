import tempfile
import unittest
from pathlib import Path

from app import main
from app import admin_auth
from app.admin_security import (
    account_session_summary,
    change_account_password,
    list_account_sessions,
    revoke_all_user_sessions,
    revoke_other_sessions,
)


class AdminSecurityTests(unittest.TestCase):
    def test_security_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/security", paths)
        self.assertIn("/api/admin/security/password", paths)
        self.assertIn("/api/admin/security/sessions/revoke-others", paths)
        self.assertIn("/api/admin/security/users", paths)

    def test_lists_and_revokes_other_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "users.sqlite3"
            user = admin_auth.create_user("session.test", "Session Test", "LongPassword123!", "admin", database=database)
            token_one, _, _ = admin_auth.login_user("session.test", "LongPassword123!", database=database)
            token_two, _, _ = admin_auth.login_user("session.test", "LongPassword123!", database=database)

            sessions = list_account_sessions(user["id"], current_token=token_two, database=database)
            self.assertEqual(len(sessions), 2)
            self.assertEqual(sum(1 for item in sessions if item["current"]), 1)

            deleted = revoke_other_sessions(user["id"], token_two, database=database)
            self.assertEqual(deleted, 1)
            remaining = list_account_sessions(user["id"], current_token=token_two, database=database)
            self.assertEqual(len(remaining), 1)
            self.assertTrue(remaining[0]["current"])

            with self.assertRaises(PermissionError):
                admin_auth.authenticate_token(token_one, database=database)
            self.assertEqual(admin_auth.authenticate_token(token_two, database=database).id, user["id"])

    def test_password_change_revokes_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "users.sqlite3"
            user = admin_auth.create_user("password.test", "Password Test", "OldPassword123!", "moderator", database=database)
            token, _, _ = admin_auth.login_user("password.test", "OldPassword123!", database=database)

            change_account_password(
                user["id"],
                "OldPassword123!",
                "NewPassword456!",
                database=database,
            )

            with self.assertRaises(PermissionError):
                admin_auth.authenticate_token(token, database=database)
            with self.assertRaises(PermissionError):
                admin_auth.login_user("password.test", "OldPassword123!", database=database)
            new_token, _, principal = admin_auth.login_user("password.test", "NewPassword456!", database=database)
            self.assertEqual(principal.id, user["id"])
            self.assertTrue(new_token)

    def test_owner_summary_and_bulk_revoke(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "users.sqlite3"
            first = admin_auth.create_user("first.admin", "First", "FirstPassword123!", "admin", database=database)
            second = admin_auth.create_user("second.mod", "Second", "SecondPassword123!", "moderator", database=database)
            admin_auth.login_user("first.admin", "FirstPassword123!", database=database)
            admin_auth.login_user("first.admin", "FirstPassword123!", database=database)
            admin_auth.login_user("second.mod", "SecondPassword123!", database=database)

            summary = {item["id"]: item for item in account_session_summary(database=database)}
            self.assertEqual(summary[first["id"]]["sessionCount"], 2)
            self.assertEqual(summary[second["id"]]["sessionCount"], 1)

            self.assertEqual(revoke_all_user_sessions(first["id"], database=database), 2)
            summary_after = {item["id"]: item for item in account_session_summary(database=database)}
            self.assertEqual(summary_after[first["id"]]["sessionCount"], 0)


if __name__ == "__main__":
    unittest.main()
