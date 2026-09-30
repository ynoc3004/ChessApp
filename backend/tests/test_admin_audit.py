import tempfile
import unittest
from pathlib import Path

from app import main
from app.admin_audit import _normalized_action
from app.audit_store import audit_stats, list_events, record_event


class AdminAuditTests(unittest.TestCase):
    def test_audit_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/audit", paths)
        self.assertIn("/api/admin/audit/stats", paths)

    def test_normalized_action_hides_dynamic_ids(self):
        action, resource_type, resource_id = _normalized_action(
            "DELETE", "/api/admin/books/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/positions/17"
        )
        self.assertEqual(action, "DELETE books/:id/positions/:id")
        self.assertEqual(resource_type, "books")
        self.assertEqual(resource_id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

    def test_store_records_filters_and_stats(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "audit.sqlite3"
            record_event(
                "DELETE books/:id",
                "books",
                "a" * 32,
                details={"statusCode": 200},
                database=database,
            )
            record_event(
                "POST puzzles/update",
                "puzzles",
                status="failure",
                message="HTTP 500",
                database=database,
            )

            books = list_events(resource_type="books", database=database)
            failures = list_events(status="failure", database=database)
            stats = audit_stats(database)

            self.assertEqual(books["total"], 1)
            self.assertEqual(books["events"][0]["resourceId"], "a" * 32)
            self.assertEqual(failures["total"], 1)
            self.assertEqual(stats["total"], 2)
            self.assertEqual(stats["success"], 1)
            self.assertEqual(stats["failure"], 1)
            self.assertEqual(stats["topActions"][0]["count"], 1)


if __name__ == "__main__":
    unittest.main()
