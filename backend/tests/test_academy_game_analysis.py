import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.academy_game_analysis import (
    admin_router,
    ensure_game_analysis_schema,
    pending_games,
    practical_profile,
    public_router,
)
from app.game_analysis_engine import EngineSnapshot, analyze_game_with_evaluator, severity_for_loss


PGN = """[Event \"Academy\"]
[Result \"*\"]

1. e4 e5 2. Nf3 Nc6 *
"""


class AcademyGameAnalysisTests(unittest.TestCase):
    def _seed(self, database: Path) -> tuple[str, str, str, str]:
        ensure_game_analysis_schema(database)
        white, black, tournament, pairing = "white-1", "black-1", "tour-1", "pair-1"
        with sqlite3.connect(database) as db:
            for student_id, name in ((white, "Đệ tử Trắng"), (black, "Đệ tử Đen")):
                db.execute(
                    "INSERT INTO academy_students(id,username,display_name,password_hash,enabled,current_step,placement_status,xp,puzzle_rating,created,updated) VALUES(?,?,?,?,1,4,'completed',0,1000,1,1)",
                    (student_id, student_id, name, "unused"),
                )
            db.execute(
                "INSERT INTO academy_tournaments(id,title,description,step_min,step_max,rating_min,rating_max,class_id,max_players,planned_rounds,status,starts_at,created,updated) VALUES(?,?, '',1,20,400,3000,NULL,16,3,'completed',NULL,1,1)",
                (tournament, "Nội môn"),
            )
            db.execute(
                "INSERT INTO academy_tournament_pairings(id,tournament_id,round_no,board_no,white_id,black_id,result,pgn,reported_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (pairing, tournament, 1, 1, white, black, "1-0", PGN, 2),
            )
            db.commit()
        return white, black, tournament, pairing

    def test_severity_thresholds(self):
        self.assertIsNone(severity_for_loss(79))
        self.assertEqual(severity_for_loss(80), "inaccuracy")
        self.assertEqual(severity_for_loss(150), "mistake")
        self.assertEqual(severity_for_loss(300), "blunder")

    def test_engine_sequence_extracts_only_meaningful_loss(self):
        snapshots = iter([
            EngineSnapshot(0, ["d2d4"]),
            EngineSnapshot(-350, ["e7e5"]),
            EngineSnapshot(-300, ["g1f3"]),
            EngineSnapshot(-300, ["b8c6"]),
            EngineSnapshot(-300, []),
        ])
        moves, moments = analyze_game_with_evaluator(PGN, "white", "black", lambda _board: next(snapshots))
        self.assertEqual(moves, 4)
        self.assertEqual(len(moments), 1)
        self.assertEqual(moments[0]["studentId"], "white")
        self.assertEqual(moments[0]["severity"], "blunder")
        self.assertEqual(moments[0]["category"], "opening")
        self.assertEqual(moments[0]["cpLoss"], 350)

    def test_practical_profile_requires_repeated_game_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            white, _black, tournament, pairing = self._seed(database)
            with sqlite3.connect(database) as db:
                for index in range(2):
                    analysis_id = f"analysis-{index}"
                    pair_id = pairing if index == 0 else f"pair-{index + 1}"
                    if index:
                        db.execute(
                            "INSERT INTO academy_tournament_pairings(id,tournament_id,round_no,board_no,white_id,black_id,result,pgn,reported_at) SELECT ?,tournament_id,2,1,white_id,black_id,'0-1',pgn,3 FROM academy_tournament_pairings WHERE id=?",
                            (pair_id, pairing),
                        )
                    db.execute(
                        "INSERT INTO academy_game_analyses(id,pairing_id,tournament_id,pgn_hash,status,engine_depth,moves_total,moments_total,created,completed) VALUES(?,?,?,?, 'completed',12,20,2,?,?)",
                        (analysis_id, pair_id, tournament, f"hash-{index}", 10 + index, 10 + index),
                    )
                    db.execute(
                        "INSERT INTO academy_game_moments(id,analysis_id,pairing_id,student_id,ply,move_no,color,san,uci,fen_before,best_move_uci,best_line,best_score_cp,played_score_cp,cp_loss,severity,missed_win,category,category_label,created) VALUES(?,?,?,?,12,6,'white','Ke2','e1e2','fen','e1f2','e1f2',50,-300,350,'blunder',0,'endgame','Tàn cuộc',?)",
                        (f"moment-{index}", analysis_id, pair_id, white, 10 + index),
                    )
                db.commit()
            profile = practical_profile(white, database)
            self.assertEqual(profile["gamesAnalyzed"], 2)
            self.assertEqual(profile["severity"]["blunder"], 2)
            self.assertEqual(profile["recommendation"]["category"], "endgame")
            self.assertEqual(profile["recommendation"]["theme"], "endgame")

    def test_pending_game_marks_changed_pgn_stale(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "academy.sqlite3"
            _white, _black, tournament, pairing = self._seed(database)
            with sqlite3.connect(database) as db:
                db.execute(
                    "INSERT INTO academy_game_analyses(id,pairing_id,tournament_id,pgn_hash,status,engine_depth,created) VALUES('analysis',?,?, 'old-hash','completed',12,1)",
                    (pairing, tournament),
                )
                db.commit()
            games = pending_games(database)
            self.assertEqual(len(games), 1)
            self.assertTrue(games[0]["stale"])

    def test_routes_registered(self):
        admin_paths = {getattr(route, "path", "") for route in admin_router.routes}
        public_paths = {getattr(route, "path", "") for route in public_router.routes}
        self.assertIn("/academy/game-analysis/overview", admin_paths)
        self.assertIn("/academy/game-analysis/pairings/{pairing_id}/start", admin_paths)
        self.assertIn("/api/academy/game-analysis/profile", public_paths)
        self.assertIn("/api/academy/game-analysis/games/{analysis_id}", public_paths)


if __name__ == "__main__":
    unittest.main()
