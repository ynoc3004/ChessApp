// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const db  = require('../db');

const SECRET = 'Kd93!s@2Gk#1pVzChESSapp2025*';

async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ message: 'No token, authorization denied' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);

    // Lấy user từ DB, loại bỏ password
    db.query(
      'SELECT id, name, email, is_admin, is_premium, created_at FROM users WHERE id = ?',
      [decoded.id],
      (err, rows) => {
        if (err || rows.length === 0)
          return res.status(401).json({ message: 'Invalid token' });

        req.user = rows[0];
        next();
      }
    );
  } catch (error) {
    return res.status(401).json({ message: 'Token is not valid' });
  }
}

function admin(req, res, next) {
  if (req.user && req.user.is_admin === 1) {
    next();
  } else {
    res.status(403).json({ message: 'Admin access only' });
  }
}

module.exports = { protect, admin };
