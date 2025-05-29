const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /themes
router.get('/', (req, res) => {
  db.query('SELECT * FROM themes', (err, rows) => {
    if (err) return res.status(500).json({ message: 'Lỗi truy vấn themes' });
    res.json(rows);
  });
});

// POST /themes
router.post('/', (req, res) => {
  const { name } = req.body;
  db.query('INSERT INTO themes (name) VALUES (?)', [name], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Không thể thêm chủ đề' });
    }
    res.json({ id: result.insertId, name });
  });
});

// PUT /themes/:id
router.put('/:id', (req, res) => {
  const { name } = req.body;
  db.query('UPDATE themes SET name = ? WHERE id = ?', [name, req.params.id], err => {
    if (err) return res.status(500).json({ message: 'Lỗi cập nhật chủ đề' });
    res.json({ message: 'Đã cập nhật chủ đề' });
  });
});

// DELETE /themes/:id
router.delete('/:id', (req, res) => {
  db.query('DELETE FROM themes WHERE id = ?', [req.params.id], err => {
    if (err) return res.status(500).json({ message: 'Lỗi xóa chủ đề' });
    res.json({ message: 'Đã xóa chủ đề' });
  });
});

module.exports = router;
