import unittest

from app import main


class AdminSecurityPermissionTests(unittest.TestCase):
    def test_owner_session_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/security/users/{user_id}/revoke-sessions", paths)
        methods = main.app.openapi()["paths"]["/api/admin/security/users/{user_id}/revoke-sessions"]
        self.assertIn("post", methods)


if __name__ == "__main__":
    unittest.main()
