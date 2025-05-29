const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const db = require('../db');

const router = express.Router();
const SECRET = 'Kd93!s@2Gk#1pVzChESSapp2025*'; // Chuỗi bảo mật dùng để tạo JWT token

// 📧 Cấu hình gửi email xác minh
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'phamngochoat30@gmail.com',         // Email gửi đi
    pass: 'wxbyrwlbhjuwpqvy'                 // App password từ Gmail
  }
});

// 📝 API: Đăng ký tài khoản mới
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const verifyToken = uuidv4();

  const sql = 'INSERT INTO users (name, email, password, verify_token) VALUES (?, ?, ?, ?)';
  db.query(sql, [name, email, hashedPassword, verifyToken], (err, result) => {
    if (err) {
      console.error('❌ Lỗi tạo tài khoản:', err);
      return res.status(500).send({ message: 'Email đã tồn tại hoặc lỗi hệ thống.' });
    }

    const link = `http://localhost:3000/verify?token=${verifyToken}`;
    console.log(`📧 Gửi xác minh cho ${email}: ${link}`);

    transporter.sendMail({
      from: 'Chess App <phamngochoat30@gmail.com>',
      to: email,
      subject: 'Xác minh tài khoản Chess App',
      html: `<p>Vui lòng nhấp vào liên kết sau để xác minh tài khoản:</p><a href="${link}">${link}</a>`
    });

    res.send({ message: '✅ Đăng ký thành công. Kiểm tra email để xác minh tài khoản.' });
  });
});

// 🔓 API: Xác minh tài khoản từ email
router.get('/verify', (req, res) => {
  const { token } = req.query;

  db.query(
    'UPDATE users SET email_verified = 1, verify_token = NULL WHERE verify_token = ?',
    [token],
    (err, result) => {
      if (err || result.affectedRows === 0) {
        console.error('❌ Token không hợp lệ hoặc hết hạn');
        return res.status(400).send('❌ Token không hợp lệ hoặc đã hết hạn.');
      }

      console.log('✅ Tài khoản đã được xác minh.');
      res.send('✅ Xác minh tài khoản thành công! Bạn có thể đăng nhập.');
    }
  );
});

// 🔐 API: Đăng nhập
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  console.log('🟡 Đang đăng nhập:', email);

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.error('❌ Lỗi truy vấn:', err);
      return res.status(500).send({ message: 'Lỗi máy chủ.' });
    }

    if (results.length === 0) {
      console.warn('❌ Không tìm thấy email:', email);
      return res.status(400).send({ message: 'Sai email hoặc mật khẩu.' });
    }

    const user = results[0];
    console.log('🔍 Thông tin người dùng:', {
      id: user.id,
      email: user.email,
      is_admin: user.is_admin,
      verified: user.email_verified
    });

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.warn('❌ Mật khẩu sai cho:', email);
      return res.status(400).send({ message: 'Sai mật khẩu.' });
    }

    if (!user.email_verified) {
      console.warn('⚠️ Email chưa xác minh:', email);
      return res.status(403).send({ message: 'Vui lòng xác minh email trước khi đăng nhập.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, is_admin: user.is_admin },
      SECRET,
      { expiresIn: '1d' }
    );

    console.log('✅ Đăng nhập thành công:', email);
    res.send({
      token,
      name: user.name,
      is_admin: user.is_admin
    });
  });
});

module.exports = router;
