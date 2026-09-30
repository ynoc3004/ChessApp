import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import main
from app.academy import (
    _active_enrollment,
    _compute_placement,
    _dashboard,
    _login_student,
    admin_router,
    assign_student_class,
    create_class,
    create_student,
    create_teacher,
    ensure_schema,
    public_router,
)


class AcademyV1Tests(unittest.TestCase):
    def test_student_accounts_are_separate_and_login(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            student = create_student("hocvien01", "Học Viên 01", "matkhau-rat-dai", database=database)
            token, expires, logged_in = _login_student("hocvien01", "matkhau-rat-dai", database=database)
            self.assertTrue(token)
            self.assertGreater(expires, 0)
            self.assertEqual(student["id"], logged_in["id"])
            self.assertEqual(logged_in["placementStatus"], "pending")
            self.assertEqual(logged_in["puzzleRating"], 800)

    def test_class_assignment_exposes_teacher_and_ai_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            teacher = create_teacher("Sư phụ An", "HLV Step 4", "teacher-ai-an", database)
            academy_class = create_class("Trúc Cơ 4A", 4, 4, teacher["id"], database)
            student = create_student("detu001", "Đệ Tử Một", "matkhau-rat-dai", database=database)
            assign_student_class(student["id"], academy_class["id"], database)
            enrollment = _active_enrollment(student["id"], database)
            self.assertEqual(enrollment["class"]["name"], "Trúc Cơ 4A")
            self.assertEqual(enrollment["teacher"]["displayName"], "Sư phụ An")
            self.assertEqual(enrollment["teacher"]["aiProfileId"], "teacher-ai-an")

    def test_placement_scoring_returns_step_and_skill_map(self):
        rows = [
            {"id": "q1", "step": 2, "skill": "Bắt quân", "correct_index": 0},
            {"id": "q2", "step": 2, "skill": "Bắt quân", "correct_index": 1},
            {"id": "q3", "step": 3, "skill": "Chiếu hết", "correct_index": 0},
            {"id": "q4", "step": 3, "skill": "Chiếu hết", "correct_index": 1},
            {"id": "q5", "step": 4, "skill": "Tính toán", "correct_index": 0},
        ]
        answers = {"q1": 0, "q2": 1, "q3": 0, "q4": 1, "q5": 1}
        score, recommended, skills, steps = _compute_placement(rows, answers)
        self.assertEqual(score, 80.0)
        self.assertEqual(recommended, 3)
        self.assertEqual(skills["Bắt quân"]["percent"], 100.0)
        self.assertEqual(skills["Tính toán"]["percent"], 0.0)
        self.assertEqual(steps["4"]["percent"], 0.0)

    def test_dashboard_marks_placement_as_next_action(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            student = create_student("detu002", "Đệ Tử Hai", "matkhau-rat-dai", database=database)
            dashboard = _dashboard(student["id"], database)
            self.assertEqual(dashboard["nextAction"], "placement")
            self.assertFalse(dashboard["placement"]["ready"])

    def test_public_and_admin_routes_are_registered(self):
        public_paths = {getattr(route, "path", "") for route in public_router.routes}
        admin_paths = {getattr(route, "path", "") for route in admin_router.routes}
        self.assertIn("/api/academy/auth/login", public_paths)
        self.assertIn("/api/academy/dashboard", public_paths)
        self.assertIn("/api/academy/placement/start", public_paths)
        self.assertIn("/academy/students", admin_paths)
        self.assertIn("/academy/classes", admin_paths)
        self.assertIn("/academy/placement/questions", admin_paths)

    def test_http_student_flow_has_no_questions_until_teacher_configures_bank(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            with patch("app.academy.ACADEMY_DB", database):
                ensure_schema(database)
                create_student("detu003", "Đệ Tử Ba", "matkhau-rat-dai", database=database)
                client = TestClient(main.app)
                login = client.post("/api/academy/auth/login", json={"username": "detu003", "password": "matkhau-rat-dai"})
                self.assertEqual(login.status_code, 200)
                token = login.json()["token"]
                headers = {"Authorization": f"Bearer {token}"}
                dashboard = client.get("/api/academy/dashboard", headers=headers)
                self.assertEqual(dashboard.status_code, 200)
                self.assertFalse(dashboard.json()["placement"]["ready"])
                start = client.post("/api/academy/placement/start", headers=headers)
                self.assertEqual(start.status_code, 409)
                self.assertIn("Step by Step", start.json()["detail"])


if __name__ == "__main__":
    unittest.main()
