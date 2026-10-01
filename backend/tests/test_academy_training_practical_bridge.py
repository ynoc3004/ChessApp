import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.academy_game_analysis import ensure_game_analysis_schema
from app.academy_training import build_training_session


class PracticalTrainingBridgeTests(unittest.TestCase):
    def test_repeated_endgame_errors_become_personalized_focus_without_changing_mastery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "academy.sqlite3"
            puzzles = root / "puzzles.sqlite3"
            ensure_game_analysis_schema(database)
            with sqlite3.connect(database) as db:
                db.execute("INSERT INTO academy_students(id,username,display_name,password_hash,enabled,current_step,placement_status,xp,puzzle_rating,created,updated) VALUES('student','student','Đệ tử','x',1,4,'completed',0,1000,1,1)")
                db.execute("INSERT INTO academy_students(id,username,display_name,password_hash,enabled,current_step,placement_status,xp,puzzle_rating,created,updated) VALUES('opp','opp','Đối thủ','x',1,4,'completed',0,1000,1,1)")
                db.execute("INSERT INTO academy_tournaments(id,title,description,step_min,step_max,rating_min,rating_max,class_id,max_players,planned_rounds,status,created,updated) VALUES('t','Giải','',1,20,400,3000,NULL,8,2,'completed',1,1)")
                for index in range(2):
                    pair = f"p{index}"; analysis = f"a{index}"
                    db.execute("INSERT INTO academy_tournament_pairings(id,tournament_id,round_no,board_no,white_id,black_id,result,pgn,reported_at) VALUES(?, 't', ?,1,'student','opp','1-0','[Result \"*\"]\n\n1. e4 e5 *',2)", (pair, index + 1))
                    db.execute("INSERT INTO academy_game_analyses(id,pairing_id,tournament_id,pgn_hash,status,engine_depth,moves_total,moments_total,created,completed) VALUES(?,?, 't',?,'completed',12,20,1,?,?)", (analysis, pair, f"h{index}", 10 + index, 10 + index))
                    db.execute("INSERT INTO academy_game_moments(id,analysis_id,pairing_id,student_id,ply,move_no,color,san,uci,fen_before,best_move_uci,best_line,best_score_cp,played_score_cp,cp_loss,severity,missed_win,category,category_label,created) VALUES(?,?,?,?,12,6,'white','Ke2','e1e2','fen','e1f2','e1f2',50,-300,350,'blunder',0,'endgame','Tàn cuộc',?)", (f"m{index}", analysis, pair, 'student', 10 + index))
                db.commit()

            with sqlite3.connect(puzzles) as pdb:
                pdb.execute("CREATE TABLE puzzles(id TEXT PRIMARY KEY,fen TEXT,moves TEXT,rating INTEGER,themes TEXT)")
                pdb.execute("CREATE TABLE themes(theme TEXT,id TEXT,rating INTEGER)")
                pdb.execute("CREATE INDEX idx_theme ON themes(theme,rating,id)")
                pdb.execute("CREATE INDEX idx_rating ON puzzles(rating,id)")
                for index in range(10):
                    pid = f"z{index}"
                    rating = 900 + index * 20
                    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                    pdb.execute("INSERT INTO puzzles VALUES(?,?,?,?,?)", (pid, fen, "e2e4 e7e5", rating, "endgame"))
                    pdb.execute("INSERT INTO themes VALUES('endgame',?,?)", (pid, rating))
                pdb.commit()

            session = build_training_session('student', limit=5, database=database, puzzles_db=puzzles, now=100)
            self.assertEqual(session['personalization']['theme'], 'endgame')
            self.assertTrue(session['personalization']['skill'].startswith('Thực chiến'))
            self.assertEqual(session['profile']['practical']['gamesAnalyzed'], 2)
            self.assertEqual(session['profile']['skills'], [])


if __name__ == '__main__':
    unittest.main()
