import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.academy_training import (
    DAY,
    TrainingResultRequest,
    build_training_session,
    ensure_training_schema,
    mistake_book,
    recommended_rating_range,
    record_training_result,
    review_interval,
    router,
    skill_to_theme,
    training_profile,
)


class AcademyTrainingTests(unittest.TestCase):
    def _seed_student(self, database: Path, student_id: str = "student-1") -> str:
        ensure_training_schema(database)
        with sqlite3.connect(database) as db:
            db.execute(
                "INSERT INTO academy_students(id,username,display_name,password_hash,enabled,current_step,placement_status,xp,puzzle_rating,created,updated) "
                "VALUES(?,?,?,?,1,4,'completed',0,900,1,1)",
                (student_id, "student.one", "Đệ tử Một", "unused"),
            )
            db.execute(
                "INSERT INTO academy_placement_attempts(id,student_id,status,question_ids_json,answers_json,skill_scores_json,step_scores_json,score,recommended_step,started,completed) "
                "VALUES(?,?, 'completed','[]','{}',?,'{}',75,4,1,2)",
                (
                    "placement-1",
                    student_id,
                    json.dumps({
                        "Đòn đôi": {"correct": 1, "total": 4, "percent": 25.0},
                        "Chiếu hết": {"correct": 4, "total": 4, "percent": 100.0},
                    }, ensure_ascii=False),
                ),
            )
            db.commit()
        return student_id

    def _seed_puzzles(self, path: Path, count: int = 12) -> None:
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE puzzles(id TEXT PRIMARY KEY, fen TEXT, moves TEXT, rating INTEGER, themes TEXT)")
            db.execute("CREATE TABLE themes(theme TEXT, id TEXT, rating INTEGER)")
            db.execute("CREATE INDEX idx_themes_theme_rating ON themes(theme,rating,id)")
            db.execute("CREATE INDEX idx_puzzles_rating ON puzzles(rating,id)")
            for index in range(count):
                puzzle_id = f"p{index:03d}"
                rating = 850 + index * 20
                db.execute(
                    "INSERT INTO puzzles VALUES(?,?,?,?,?)",
                    (puzzle_id, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e2e4 e7e5", rating, "fork opening"),
                )
                db.execute("INSERT INTO themes VALUES('fork',?,?)", (puzzle_id, rating))
            db.commit()

    def test_skill_aliases_and_rating_band(self):
        self.assertEqual(skill_to_theme("Đòn đôi"), "fork")
        self.assertEqual(skill_to_theme("Chiếu hết"), "mate")
        self.assertEqual(skill_to_theme("Tàn cuộc"), "endgame")
        self.assertIsNone(skill_to_theme("Tư duy chung"))
        self.assertIsNone(skill_to_theme("Material"))
        minimum, maximum = recommended_rating_range(4, 900)
        self.assertLess(minimum, 900)
        self.assertGreater(maximum, 900)
        self.assertLess(maximum, 2000)

    def test_review_schedule(self):
        self.assertEqual(review_interval(0, False), (0, 1))
        self.assertEqual(review_interval(0, True), (1, 3))
        self.assertEqual(review_interval(1, True), (2, 7))
        self.assertEqual(review_interval(2, True), (3, 14))
        self.assertEqual(review_interval(5, True), (6, 60))

    def test_profile_uses_placement_weakness(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            student_id = self._seed_student(database)
            profile = training_profile(student_id, database, now=1000)
            self.assertEqual(profile["recommendation"]["skill"], "Đòn đôi")
            self.assertEqual(profile["recommendation"]["theme"], "fork")
            self.assertEqual(profile["review"]["due"], 0)
            self.assertEqual(profile["stats"]["attempts"], 0)

    def test_personalized_session_targets_weak_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "academy.sqlite3"
            puzzles = root / "puzzles.sqlite3"
            student_id = self._seed_student(database)
            self._seed_puzzles(puzzles)
            session = build_training_session(
                student_id,
                mode="personalized",
                limit=5,
                database=database,
                puzzles_db=puzzles,
                now=1000,
            )
            self.assertEqual(session["mode"], "personalized")
            self.assertEqual(session["personalization"]["theme"], "fork")
            self.assertGreater(len(session["puzzles"]), 0)
            self.assertLessEqual(len(session["puzzles"]), 5)
            self.assertTrue(any(item["academyTheme"] == "fork" for item in session["puzzles"]))

    def test_mistake_creates_srs_item_and_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "academy.sqlite3"
            puzzles = root / "puzzles.sqlite3"
            student_id = self._seed_student(database)
            self._seed_puzzles(puzzles, count=2)
            now = 10_000.0
            result = record_training_result(
                student_id,
                TrainingResultRequest(
                    eventId="event-first-0001",
                    puzzleId="p000",
                    mode="personalized",
                    skill="Đòn đôi",
                    theme="fork",
                    mistakes=2,
                    hinted=False,
                    elapsedMs=42_000,
                ),
                database=database,
                puzzles_db=puzzles,
                now=now,
            )
            self.assertTrue(result["recorded"])
            self.assertFalse(result["clean"])
            self.assertGreater(result["xpAwarded"], 0)
            self.assertEqual(result["review"]["intervalDays"], 1)
            book = mistake_book(student_id, database=database, puzzles_db=puzzles, now=now)
            self.assertEqual(book["total"], 1)
            self.assertFalse(book["items"][0]["due"])
            due_book = mistake_book(student_id, database=database, puzzles_db=puzzles, now=now + DAY + 1)
            self.assertTrue(due_book["items"][0]["due"])

            clean_review = record_training_result(
                student_id,
                TrainingResultRequest(
                    eventId="event-review-0002",
                    puzzleId="p000",
                    mode="review",
                    skill="Đòn đôi",
                    theme="fork",
                    mistakes=0,
                    hinted=False,
                    elapsedMs=18_000,
                ),
                database=database,
                puzzles_db=puzzles,
                now=now + DAY + 2,
            )
            self.assertEqual(clean_review["review"]["intervalDays"], 3)
            profile = training_profile(student_id, database, now=now + DAY + 2)
            self.assertEqual(profile["stats"]["attempts"], 2)
            self.assertEqual(next(item for item in profile["skills"] if item["skill"] == "Đòn đôi")["attempts"], 2)

    def test_event_id_is_idempotent_and_repeat_reduces_xp(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "academy.sqlite3"
            puzzles = root / "puzzles.sqlite3"
            student_id = self._seed_student(database)
            self._seed_puzzles(puzzles, count=1)
            payload = TrainingResultRequest(
                eventId="event-clean-0001",
                puzzleId="p000",
                mode="personalized",
                skill="Đòn đôi",
                theme="fork",
                mistakes=0,
                hinted=False,
                elapsedMs=10_000,
            )
            first = record_training_result(student_id, payload, database=database, puzzles_db=puzzles, now=20_000)
            duplicate = record_training_result(student_id, payload, database=database, puzzles_db=puzzles, now=20_010)
            self.assertTrue(duplicate["duplicate"])
            self.assertEqual(duplicate["xpAwarded"], first["xpAwarded"])
            second = record_training_result(
                student_id,
                payload.model_copy(update={"eventId": "event-clean-0002"}),
                database=database,
                puzzles_db=puzzles,
                now=20_100,
            )
            self.assertLess(second["xpAwarded"], first["xpAwarded"])
            profile = training_profile(student_id, database, now=20_100)
            self.assertEqual(profile["stats"]["attempts"], 2)

    def test_training_routes_registered(self):
        paths = {getattr(route, "path", "") for route in router.routes}
        self.assertIn("/api/academy/training/profile", paths)
        self.assertIn("/api/academy/training/session", paths)
        self.assertIn("/api/academy/training/result", paths)
        self.assertIn("/api/academy/training/mistakes", paths)


if __name__ == "__main__":
    unittest.main()
