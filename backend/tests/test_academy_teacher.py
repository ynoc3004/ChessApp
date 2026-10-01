import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.academy_teacher import (
    CreateAssignmentRequest,
    admin_router,
    assignment_session,
    create_assignment,
    ensure_teacher_schema,
    public_router,
    record_assignment_event,
    student_assignments,
    teacher_dashboard,
)
from app.academy_training import TrainingResultRequest, record_training_result


class AcademyTeacherTests(unittest.TestCase):
    def _seed_academy(self, database: Path) -> dict[str, str]:
        ensure_teacher_schema(database)
        teacher_id = "teacher-1"
        class_id = "class-1"
        student_a = "student-a"
        student_b = "student-b"
        with sqlite3.connect(database) as db:
            db.execute(
                "INSERT INTO academy_teachers(id,display_name,bio,ai_profile_id,active,created,updated) VALUES(?,?,?,?,1,1,1)",
                (teacher_id, "Sư phụ An", "HLV Step 4", "teacher-ai-an"),
            )
            db.execute(
                "INSERT INTO academy_classes(id,name,step_min,step_max,teacher_id,active,created,updated) VALUES(?,?,?,?,?,1,1,1)",
                (class_id, "Trúc Cơ 4A", 4, 4, teacher_id),
            )
            for index, student_id in enumerate((student_a, student_b), start=1):
                db.execute(
                    "INSERT INTO academy_students(id,username,display_name,password_hash,enabled,current_step,placement_status,xp,puzzle_rating,created,updated) "
                    "VALUES(?,?,?,?,1,4,'completed',0,900,1,1)",
                    (student_id, f"student.{index}", f"Đệ tử {index}", "unused"),
                )
                db.execute(
                    "INSERT INTO academy_enrollments(id,student_id,class_id,active,enrolled_at) VALUES(?,?,?,1,1)",
                    (f"enroll-{index}", student_id, class_id),
                )
                db.execute(
                    "INSERT INTO academy_placement_attempts(id,student_id,status,question_ids_json,answers_json,skill_scores_json,step_scores_json,score,recommended_step,started,completed) "
                    "VALUES(?,?, 'completed','[]','{}',?,'{}',75,4,1,2)",
                    (
                        f"placement-{index}",
                        student_id,
                        json.dumps({"Đòn đôi": {"correct": 1, "total": 4, "percent": 25.0}}, ensure_ascii=False),
                    ),
                )
            db.commit()
        return {"teacher": teacher_id, "class": class_id, "a": student_a, "b": student_b}

    def _seed_puzzles(self, path: Path, count: int = 8) -> None:
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE puzzles(id TEXT PRIMARY KEY, fen TEXT, moves TEXT, rating INTEGER, themes TEXT)")
            db.execute("CREATE TABLE themes(theme TEXT, id TEXT, rating INTEGER)")
            db.execute("CREATE INDEX idx_themes_theme_rating ON themes(theme,rating,id)")
            db.execute("CREATE INDEX idx_puzzles_rating ON puzzles(rating,id)")
            for index in range(count):
                puzzle_id = f"p{index:03d}"
                rating = 900 + index * 20
                db.execute(
                    "INSERT INTO puzzles VALUES(?,?,?,?,?)",
                    (puzzle_id, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e2e4 e7e5", rating, "fork opening"),
                )
                db.execute("INSERT INTO themes VALUES('fork',?,?)", (puzzle_id, rating))
            db.commit()

    def test_class_assignment_snapshots_active_students(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            ids = self._seed_academy(database)
            assignment = create_assignment(
                CreateAssignmentRequest(
                    teacherId=ids["teacher"],
                    targetType="class",
                    targetId=ids["class"],
                    title="Đòn đôi tuần 1",
                    theme="fork",
                    ratingMin=850,
                    ratingMax=1200,
                    puzzleCount=5,
                    dueAt=20_000,
                ),
                database=database,
                now=1_000,
            )
            self.assertEqual(assignment["targetCount"], 2)
            self.assertEqual(assignment["completedCount"], 0)
            self.assertEqual(len(student_assignments(ids["a"], database, now=1_001)), 1)
            self.assertEqual(len(student_assignments(ids["b"], database, now=1_001)), 1)

    def test_assignment_session_and_unique_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "academy.sqlite3"
            puzzles = root / "puzzles.sqlite3"
            ids = self._seed_academy(database)
            self._seed_puzzles(puzzles)
            assignment = create_assignment(
                CreateAssignmentRequest(
                    teacherId=ids["teacher"],
                    targetType="student",
                    targetId=ids["a"],
                    title="Song Kích",
                    theme="fork",
                    ratingMin=850,
                    ratingMax=1200,
                    puzzleCount=2,
                ),
                database=database,
                now=1_000,
            )
            session = assignment_session(
                assignment["id"], ids["a"], database=database, puzzles_db=puzzles, now=1_100
            )
            self.assertEqual(len(session["puzzles"]), 2)
            self.assertTrue(all(item["academyAssignmentId"] == assignment["id"] for item in session["puzzles"]))
            first_id = session["puzzles"][0]["id"]
            progress = record_assignment_event(
                assignment["id"], ids["a"], "event-0001", first_id, True, database, now=1_200
            )
            self.assertEqual(progress["attempts"], 1)
            duplicate_puzzle = record_assignment_event(
                assignment["id"], ids["a"], "event-0002", first_id, True, database, now=1_300
            )
            self.assertEqual(duplicate_puzzle["attempts"], 1)
            second_session = assignment_session(
                assignment["id"], ids["a"], database=database, puzzles_db=puzzles, now=1_400
            )
            self.assertNotIn(first_id, [item["id"] for item in second_session["puzzles"]])
            second_id = second_session["puzzles"][0]["id"]
            complete = record_assignment_event(
                assignment["id"], ids["a"], "event-0003", second_id, False, database, now=1_500
            )
            self.assertEqual(complete["status"], "completed")
            self.assertEqual(complete["remaining"], 0)

    def test_assignment_training_updates_student_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "academy.sqlite3"
            puzzles = root / "puzzles.sqlite3"
            ids = self._seed_academy(database)
            self._seed_puzzles(puzzles, count=2)
            assignment = create_assignment(
                CreateAssignmentRequest(
                    teacherId=ids["teacher"], targetType="student", targetId=ids["a"],
                    title="Bài cá nhân", theme="fork", ratingMin=850, ratingMax=1200, puzzleCount=1,
                ),
                database=database,
                now=1_000,
            )
            training = record_training_result(
                ids["a"],
                TrainingResultRequest(
                    eventId="training-event-1", puzzleId="p000", mode="manual",
                    skill="Đòn đôi", theme="fork", mistakes=0, hinted=False, elapsedMs=10_000,
                ),
                database=database,
                puzzles_db=puzzles,
                now=2_000,
            )
            self.assertGreater(training["xpAwarded"], 0)
            progress = record_assignment_event(
                assignment["id"], ids["a"], "training-event-1", "p000", True, database, now=2_000
            )
            self.assertEqual(progress["status"], "completed")
            dashboard = teacher_dashboard(ids["teacher"], database, now=2_100)
            student = next(item for item in dashboard["students"] if item["id"] == ids["a"])
            self.assertEqual(student["training"]["attempts"], 1)
            self.assertGreater(student["xp"], 0)
            self.assertEqual(dashboard["assignments"][0]["completedCount"], 1)

    def test_teacher_dashboard_attention_signals(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            ids = self._seed_academy(database)
            dashboard = teacher_dashboard(ids["teacher"], database, now=10_000)
            self.assertEqual(dashboard["summary"]["students"], 2)
            self.assertEqual(dashboard["summary"]["classes"], 1)
            self.assertEqual(dashboard["summary"]["needAttention"], 2)
            self.assertTrue(all(item["needsAttention"] for item in dashboard["students"]))
            self.assertTrue(any("7 ngày" in reason for reason in dashboard["students"][0]["attentionReasons"]))

    def test_routes_registered(self):
        admin_paths = {getattr(route, "path", "") for route in admin_router.routes}
        public_paths = {getattr(route, "path", "") for route in public_router.routes}
        self.assertIn("/academy/teacher/dashboard", admin_paths)
        self.assertIn("/academy/teacher/assignments", admin_paths)
        self.assertIn("/api/academy/assignments", public_paths)
        self.assertIn("/api/academy/assignments/{assignment_id}/session", public_paths)
        self.assertIn("/api/academy/assignments/{assignment_id}/result", public_paths)


if __name__ == "__main__":
    unittest.main()
