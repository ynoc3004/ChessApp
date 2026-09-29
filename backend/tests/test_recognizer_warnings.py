import unittest

from app.recognizer import _position_warnings


class PositionWarningsTests(unittest.TestCase):
    def test_black_to_move_in_check_is_valid(self):
        self.assertEqual(_position_warnings("4k3/4R3/8/8/8/8/8/4K3"), [])

    def test_invalid_for_both_turns_is_flagged(self):
        warnings = _position_warnings("8/8/8/8/8/8/8/4K3")
        self.assertTrue(any("chưa hợp lệ" in warning for warning in warnings))
