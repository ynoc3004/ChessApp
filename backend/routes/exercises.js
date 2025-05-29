const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /exercises
router.get('/', (req, res) => {
  db.query('SELECT * FROM exercises', (err, rows) => {
    if (err) return res.status(500).json({ message: 'Lỗi truy vấn exercises' });
    res.json(rows);
  });
});

// POST /exercises
router.post('/', (req, res) => {
  const { fen, level, side_to_move, solution, theme_id } = req.body;
  const sql = `
    INSERT INTO exercises 
      (fen, level, side_to_move, solution, theme_id)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.query(sql, [fen, level, side_to_move, solution, theme_id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Không thể thêm bài tập' });
    }
    res.json({ id: result.insertId, message: 'Đã thêm bài tập' });
  });
});

// PUT /exercises/:id
router.put('/:id', (req, res) => {
  const { fen, level, side_to_move, solution, theme_id } = req.body;
  const sql = `
    UPDATE exercises
      SET fen=?, level=?, side_to_move=?, solution=?, theme_id=?
    WHERE id=?
  `;
  db.query(sql, [fen, level, side_to_move, solution, theme_id, req.params.id], err => {
    if (err) return res.status(500).json({ message: 'Lỗi cập nhật bài tập' });
    res.json({ message: 'Đã cập nhật bài tập' });
  });
});

// DELETE /exercises/:id
router.delete('/:id', (req, res) => {
  db.query('DELETE FROM exercises WHERE id = ?', [req.params.id], err => {
    if (err) return res.status(500).json({ message: 'Lỗi xóa bài tập' });
    res.json({ message: 'Đã xóa bài tập' });
  });
});

module.exports = router;
