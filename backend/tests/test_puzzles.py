import csv
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import puzzles
from scripts.import_lichess_puzzles import import_database
from scripts.update_lichess_puzzles import update_database

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
    def test_session_samples_across_rating_range(self):
        with self.source.open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(SAMPLE)); writer.writeheader()
            for index in range(100):
                writer.writerow({**SAMPLE, 'PuzzleId': f'{index:05d}', 'Rating': str(800 + index * 20)})
        self.assertEqual(import_database(self.source, puzzles.PUZZLES), 100)
        response = self.client.get('/api/puzzles/session?minimum=800&maximum=2800&limit=10')
        self.assertEqual(response.status_code, 200)
        ratings = [item['rating'] for item in response.json()['puzzles']]
        self.assertEqual(len(ratings), 10)
        self.assertEqual(len(set(ratings)), 10)
        self.assertLess(min(ratings), 1100)
        self.assertGreater(max(ratings), 2500)
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
    def test_update_downloads_once_and_keeps_old_data_on_failure(self):
        import zstandard
        archive = zstandard.ZstdCompressor().compress(self.source.read_bytes())
        calls = []
        headers = {'ETag': 'version-1', 'Content-Length': str(len(archive))}
        def opener(request, timeout):
            calls.append(request.get_method())
            response = io.BytesIO(archive if request.get_method() == 'GET' else b'')
            response.headers = headers
            return response
        self.assertTrue(update_database(puzzles.PUZZLES, opener=opener))
        before = puzzles.PUZZLES.read_bytes()
        self.assertFalse(update_database(puzzles.PUZZLES, opener=opener))
        self.assertEqual(calls, ['HEAD', 'GET', 'HEAD'])
        headers['ETag'] = 'version-2'
        self.assertTrue(update_database(puzzles.PUZZLES, check=True, opener=opener))
        def broken(request, timeout):
            response = io.BytesIO(b'bad' if request.get_method() == 'GET' else b'')
            response.headers = headers
            return response
        with self.assertRaises(ValueError):
            update_database(puzzles.PUZZLES, opener=broken)
        self.assertEqual(puzzles.PUZZLES.read_bytes(), before)
        self.assertEqual(list(self.root.glob('lichess-download-*')), [])
    def test_saved_position_validity_and_notes(self):
        item = dict(id='lichess:00sHx', title='Bài hay', fen=SAMPLE['FEN'], source='lichess', sourcePath='https://lichess.org/training/00sHx', note='Chiếu hết', themes='mate')
        self.assertEqual(self.client.put('/api/collection', json=item).status_code, 200)
        item['note'] = 'Ôn lại'; self.client.put('/api/collection', json=item)
        items = self.client.get('/api/collection').json()['items']; self.assertEqual(len(items),1); self.assertEqual(items[0]['note'],'Ôn lại')
        item['fen'] = '8/8/8/8/8/8/8/8 w - - 0 1'; self.assertEqual(self.client.put('/api/collection', json=item).status_code,400)
        item['fen'] = SAMPLE['FEN']; item['sourcePath'] = 'javascript:alert(1)'; self.assertEqual(self.client.put('/api/collection', json=item).status_code,400)
    def test_delete_collection_removes_only_requested_item(self):
        item = dict(id='lichess:00sHx', title='Bài hay', fen=SAMPLE['FEN'], source='lichess', sourcePath='https://lichess.org/training/00sHx', note='', themes='mate')
        self.client.put('/api/collection', json=item)
        self.client.put('/api/collection', json={**item, 'id': 'lichess:other'})
        self.assertEqual(self.client.delete('/api/collection/lichess%3A00sHx').status_code, 200)
        self.assertEqual([entry['id'] for entry in self.client.get('/api/collection').json()['items']], ['lichess:other'])
        self.assertEqual(self.client.delete('/api/collection/lichess%3A00sHx').status_code, 404)

if __name__ == '__main__': unittest.main()
