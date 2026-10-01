import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.academy import ensure_schema
from app.academy_tournament import (
    CreateTournamentRequest,
    PairingResultRequest,
    admin_router,
    create_tournament,
    ensure_tournament_schema,
    finish_tournament,
    next_round,
    open_registration,
    public_router,
    record_pairing_result,
    register_student,
    round_pairings,
    standings,
    start_tournament,
    student_tournaments,
)


class AcademyTournamentTests(unittest.TestCase):
    def seed_students(self, database: Path, count: int = 4):
        ensure_tournament_schema(database)
        ids = []
        with sqlite3.connect(database) as db:
            for index in range(count):
                student_id = f"student-{index + 1}"
                ids.append(student_id)
                db.execute(
                    "INSERT INTO academy_students(id,username,display_name,password_hash,enabled,current_step,placement_status,xp,puzzle_rating,created,updated) "
                    "VALUES(?,?,?,?,1,4,'completed',0,?,?,?)",
                    (student_id, f"student.{index + 1}", f"Đệ tử {index + 1}", "unused", 1000 - index * 50, 1, 1),
                )
            db.commit()
        return ids

    def create_open(self, database: Path, **updates):
        values = dict(
            title="Nội Môn Step 4",
            stepMin=4,
            stepMax=4,
            ratingMin=700,
            ratingMax=1200,
            maxPlayers=16,
            rounds=3,
        )
        values.update(updates)
        tournament = create_tournament(CreateTournamentRequest(**values), database=database, now=10)
        open_registration(tournament["id"], database=database, now=11)
        return tournament["id"]

    def test_registration_checks_step_and_rating(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            student_ids = self.seed_students(database, 2)
            tournament_id = self.create_open(database)
            result = register_student(tournament_id, student_ids[0], database=database, now=12)
            self.assertTrue(result["registered"])
            duplicate = register_student(tournament_id, student_ids[0], database=database, now=13)
            self.assertTrue(duplicate["duplicate"])
            with sqlite3.connect(database) as db:
                db.execute("UPDATE academy_students SET current_step=6 WHERE id=?", (student_ids[1],))
                db.commit()
            with self.assertRaises(ValueError):
                register_student(tournament_id, student_ids[1], database=database, now=14)

    def test_class_scoped_tournament(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            students = self.seed_students(database, 2)
            with sqlite3.connect(database) as db:
                db.execute("INSERT INTO academy_teachers VALUES('teacher-1','Sư phụ','',NULL,1,1,1)")
                db.execute("INSERT INTO academy_classes VALUES('class-1','Trúc Cơ 4A',4,4,'teacher-1',1,1,1)")
                db.execute("INSERT INTO academy_enrollments VALUES('enroll-1',?,'class-1',1,1,NULL)", (students[0],))
                db.commit()
            tournament_id = self.create_open(database, classId="class-1")
            self.assertTrue(register_student(tournament_id, students[0], database=database)["registered"])
            with self.assertRaises(ValueError):
                register_student(tournament_id, students[1], database=database)

    def test_swiss_pairing_avoids_repeat_and_updates_standings(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            students = self.seed_students(database, 4)
            tournament_id = self.create_open(database, rounds=3)
            for student_id in students:
                register_student(tournament_id, student_id, database=database)
            started = start_tournament(tournament_id, database=database, now=20)
            self.assertEqual(len(started["pairings"]), 2)
            first_round = round_pairings(tournament_id, 1, database)
            first_pairs = {frozenset((pair["whiteId"], pair["blackId"])) for pair in first_round}
            for pair in first_round:
                record_pairing_result(
                    tournament_id,
                    pair["id"],
                    PairingResultRequest(result="1-0"),
                    database=database,
                    now=21,
                )
            table = standings(tournament_id, database)
            self.assertEqual(sum(item["score"] for item in table), 2.0)
            second = next_round(tournament_id, database=database, now=22)
            second_pairs = {frozenset((pair["whiteId"], pair["blackId"])) for pair in second["pairings"]}
            self.assertTrue(first_pairs.isdisjoint(second_pairs))

    def test_odd_field_gets_single_bye_and_bye_score(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            students = self.seed_students(database, 5)
            tournament_id = self.create_open(database)
            for student_id in students:
                register_student(tournament_id, student_id, database=database)
            start_tournament(tournament_id, database=database, now=20)
            pairings = round_pairings(tournament_id, 1, database)
            byes = [pair for pair in pairings if pair["blackId"] is None]
            self.assertEqual(len(byes), 1)
            bye_id = byes[0]["whiteId"]
            table = standings(tournament_id, database)
            bye_player = next(item for item in table if item["studentId"] == bye_id)
            self.assertEqual(bye_player["score"], 1.0)
            self.assertEqual(bye_player["byeCount"], 1)

    def test_finish_requires_all_results(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            students = self.seed_students(database, 2)
            tournament_id = self.create_open(database, rounds=1)
            for student_id in students:
                register_student(tournament_id, student_id, database=database)
            start_tournament(tournament_id, database=database, now=20)
            with self.assertRaises(ValueError):
                finish_tournament(tournament_id, database=database, now=21)
            pairing = round_pairings(tournament_id, 1, database)[0]
            record_pairing_result(tournament_id, pairing["id"], PairingResultRequest(result="1/2-1/2", pgn="[Event \"Test\"]"), database=database, now=22)
            finished = finish_tournament(tournament_id, database=database, now=23)
            self.assertTrue(finished["completed"])
            self.assertEqual(finished["standings"][0]["score"], 0.5)

    def test_student_listing_exposes_registration_state(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            student = self.seed_students(database, 1)[0]
            tournament_id = self.create_open(database)
            before = student_tournaments(student, database)
            item = next(item for item in before if item["id"] == tournament_id)
            self.assertTrue(item["eligible"])
            self.assertFalse(item["registered"])
            register_student(tournament_id, student, database=database)
            after = student_tournaments(student, database)
            item = next(item for item in after if item["id"] == tournament_id)
            self.assertTrue(item["registered"])

    def test_routes_registered(self):
        admin_paths = {getattr(route, "path", "") for route in admin_router.routes}
        public_paths = {getattr(route, "path", "") for route in public_router.routes}
        self.assertIn("/academy/tournaments", admin_paths)
        self.assertIn("/academy/tournaments/{tournament_id}/start", admin_paths)
        self.assertIn("/academy/tournaments/{tournament_id}/pairings/{pairing_id}/result", admin_paths)
        self.assertIn("/api/academy/tournaments", public_paths)
        self.assertIn("/api/academy/tournaments/{tournament_id}/register", public_paths)


if __name__ == "__main__":
    unittest.main()
