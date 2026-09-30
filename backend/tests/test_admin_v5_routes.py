import unittest

from app import main


class AdminV5RouteTests(unittest.TestCase):
    def test_account_and_user_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/auth/login", paths)
        self.assertIn("/api/admin/auth/logout", paths)
        self.assertIn("/api/admin/users", paths)
        self.assertIn("/api/admin/users/roles", paths)
        self.assertIn("/api/admin/users/{user_id}", paths)
        self.assertIn("/api/admin/users/{user_id}/password", paths)


if __name__ == "__main__":
    unittest.main()
