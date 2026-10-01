import tempfile
import unittest
from pathlib import Path

from app import academy
from app.academy import assign_student_class, create_class, create_student, create_teacher
from app.academy_teacher import CreateAssignmentRequest, create_assignment
from app.academy_teacher_portal import (
    _authenticate_teacher_token,
    _login_teacher,
    _teacher_owns_student,
    create_teacher_account,
    ensure_teacher_portal_schema,
    public_router,
)


class TeacherPortalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "academy.sqlite3"
        self.old_iterations = academy.PASSWORD_ITERATIONS
        academy.PASSWORD_ITERATIONS = 1000
        ensure_teacher_portal_schema(self.db)

    def tearDown(self):
        academy.PASSWORD_ITERATIONS = self.old_iterations
        self.tmp.cleanup()

    def _teacher_with_class(self, name="Sư phụ A"):
        teacher = create_teacher(name, ai_profile_id="teacher-ai-a", database=self.db)
        klass = create_class("Trúc Cơ 4A", 4, 4, teacher["id"], database=self.db)
        return teacher, klass

    def test_teacher_account_login_and_session(self):
        teacher, _klass = self._teacher_with_class()
        account = create_teacher_account(teacher["id"], "teacher.a", "very-secret-123", self.db)
        self.assertEqual(account["teacherId"], teacher["id"])
        self.assertEqual(account["aiProfileId"], "teacher-ai-a")

        token, expires, logged_in = _login_teacher("teacher.a", "very-secret-123", self.db)
        self.assertGreater(expires, 0)
        self.assertEqual(logged_in["teacherId"], teacher["id"])
        authenticated = _authenticate_teacher_token(token, self.db)
        self.assertEqual(authenticated["teacherId"], teacher["id"])

    def test_teacher_scope_blocks_other_teacher_student(self):
        teacher_a, class_a = self._teacher_with_class("Sư phụ A")
        teacher_b = create_teacher("Sư phụ B", database=self.db)
        class_b = create_class("Trúc Cơ 4B", 4, 4, teacher_b["id"], database=self.db)
        student_a = create_student("student.a", "Đệ tử A", "student-pass-123", class_a["id"], self.db)
        student_b = create_student("student.b", "Đệ tử B", "student-pass-123", class_b["id"], self.db)

        self.assertTrue(_teacher_owns_student(teacher_a["id"], student_a["id"], self.db))
        self.assertFalse(_teacher_owns_student(teacher_a["id"], student_b["id"], self.db))

    def test_assignment_validation_is_bound_to_teacher(self):
        teacher_a, class_a = self._teacher_with_class("Sư phụ A")
        teacher_b = create_teacher("Sư phụ B", database=self.db)
        class_b = create_class("Lớp B", 4, 4, teacher_b["id"], database=self.db)
        create_student("student.a", "Đệ tử A", "student-pass-123", class_a["id"], self.db)
        create_student("student.b", "Đệ tử B", "student-pass-123", class_b["id"], self.db)

        assignment = create_assignment(
            CreateAssignmentRequest(
                teacherId=teacher_a["id"], targetType="class", targetId=class_a["id"],
                title="Fork tuần này", ratingMin=800, ratingMax=1200, puzzleCount=5,
            ),
            database=self.db,
        )
        self.assertEqual(assignment["teacherId"], teacher_a["id"])
        with self.assertRaises(LookupError):
            create_assignment(
                CreateAssignmentRequest(
                    teacherId=teacher_a["id"], targetType="class", targetId=class_b["id"],
                    title="Không được phép", ratingMin=800, ratingMax=1200, puzzleCount=5,
                ),
                database=self.db,
            )

    def test_teacher_routes_are_registered(self):
        paths = {route.path for route in public_router.routes}
        self.assertIn("/api/teacher/auth/login", paths)
        self.assertIn("/api/teacher/dashboard", paths)
        self.assertIn("/api/teacher/assignments", paths)
        self.assertIn("/api/teacher/students/{student_id}", paths)
        self.assertIn("/api/teacher/tournaments", paths)


if __name__ == "__main__":
    unittest.main()
