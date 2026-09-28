import csv
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import puzzles
from scripts.import_lichess_puzzles import import_database

SAMPLE = {"PuzzleId": "00sHx", "FEN": "q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17", "Moves": "e8d7 a2e6 d7d8 f7f8", "Rating": "1760", "Themes": "mate mateIn2 middlegame short"}

class PuzzleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "puzzles.csv"
        with self.source.open('w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(SAMPLE)); w.writeheader(); w.writerow(SAMPLE); w.writerow(SAMPLE)
        self.patch = patch.multiple(puzzles, DATA=self.root, PUZZLES=self.root/'puzzles.sqlite3', COLLECTION=self.root/'collection.sqlite3')
        self.patch.start()
        app = FastAPI(); app.include_router(puzzles.router); self.client = TestClient(app)
    def tearDown(self):
        self.client.close(); self.patch.stop(); self.temp.cleanup()
    def test_missing_database(self):
        self.assertFalse(self.client.get('/api/puzzles/status').json()['ready'])
        self.assertEqual(self.client.get('/api/puzzles/session').status_code, 409)
    def test_import_filters_and_duplicate(self):
        self.assertEqual(import_database(self.source, puzzles.PUZZLES), 1)
        self.assertEqual(self.client.get('/api/puzzles/status').json()['count'], 1)
        self.assertEqual(len(self.client.get('/api/puzzles/session?theme=mate&minimum=1700&maximum=1800').json()['puzzles']), 1)
        self.assertEqual(self.client.get('/api/puzzles/session?theme=fork').json()['puzzles'], [])
        self.assertEqual(self.client.get('/api/puzzles/session?minimum=2000&maximum=1000').status_code, 400)
    def test_failed_import_preserves_existing(self):
        import_database(self.source, puzzles.PUZZLES)
        before = puzzles.PUZZLES.read_bytes(); self.source.write_text('wrong,header\n')
        with self.assertRaises(ValueError): import_database(self.source, puzzles.PUZZLES)
        self.assertEqual(before, puzzles.PUZZLES.read_bytes())
        self.assertEqual(list(self.root.glob('puzzles-import-*')), [])
    def test_compressed_input(self):
        import zstandard
        compressed = self.root/'puzzles.csv.zst'; compressed.write_bytes(zstandard.ZstdCompressor().compress(self.source.read_bytes()))
        self.assertEqual(import_database(compressed, puzzles.PUZZLES, 1), 1)
    def test_saved_position_validity_and_notes(self):
        item = dict(id='lichess:00sHx', title='Bài hay', fen=SAMPLE['FEN'], source='lichess', sourcePath='https://lichess.org/training/00sHx', note='Chiếu hết', themes='mate')
        self.assertEqual(self.client.put('/api/collection', json=item).status_code, 200)
        item['note'] = 'Ôn lại'; self.client.put('/api/collection', json=item)
        items = self.client.get('/api/collection').json()['items']; self.assertEqual(len(items),1); self.assertEqual(items[0]['note'],'Ôn lại')
        item['fen'] = '8/8/8/8/8/8/8/8 w - - 0 1'; self.assertEqual(self.client.put('/api/collection', json=item).status_code,400)
        item['fen'] = SAMPLE['FEN']; item['sourcePath'] = 'javascript:alert(1)'; self.assertEqual(self.client.put('/api/collection', json=item).status_code,400)

if __name__ == '__main__': unittest.main()
