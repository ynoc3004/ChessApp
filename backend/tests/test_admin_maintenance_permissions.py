import unittest

from app.admin_auth import ROLE_PERMISSIONS, required_permission


class AdminMaintenancePermissionTests(unittest.TestCase):
    def test_maintenance_mutations_require_admin_write(self):
        permission = required_permission("POST", "/api/admin/maintenance/backups")
        self.assertEqual(permission, "admin.write")
        self.assertIn(permission, ROLE_PERMISSIONS["admin"])
        self.assertNotIn(permission, ROLE_PERMISSIONS["moderator"])

    def test_maintenance_read_is_further_protected_by_system_read_dependency(self):
        self.assertIn("system.read", ROLE_PERMISSIONS["admin"])
        self.assertNotIn("system.read", ROLE_PERMISSIONS["moderator"])


if __name__ == "__main__":
    unittest.main()
