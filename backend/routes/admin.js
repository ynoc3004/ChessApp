// backend/routes/admin.js
const express = require('express');
const db      = require('../db');
const { protect, admin } = require('../middleware/authMiddleware');
const router  = express.Router();

// GET /admin/users — lấy danh sách tất cả user
router.get('/users', protect, admin, (req, res) => {
  db.query(
    'SELECT id, name, email, is_admin, is_premium, created_at FROM users',
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error fetching users' });
      res.json(rows);
    }
  );
});

// PUT /admin/users/:id — cập nhật is_admin, is_premium
router.put('/users/:id', protect, admin, (req, res) => {
  const { is_admin, is_premium } = req.body;
  db.query(
    'UPDATE users SET is_admin = ?, is_premium = ? WHERE id = ?',
    [is_admin ? 1 : 0, is_premium ? 1 : 0, req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Error updating user' });
      if (result.affectedRows === 0)
        return res.status(404).json({ message: 'User not found' });
      res.json({ message: 'Updated successfully' });
    }
  );
});

// DELETE /admin/users/:id — xóa tài khoản
router.delete('/users/:id', protect, admin, (req, res) => {
  db.query(
    'DELETE FROM users WHERE id = ?',
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Error deleting user' });
      if (result.affectedRows === 0)
        return res.status(404).json({ message: 'User not found' });
      res.json({ message: 'Deleted successfully' });
    }
  );
});

module.exports = router;
