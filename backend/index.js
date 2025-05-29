const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Kiểm tra kết nối MySQL
const db = require('./db');
db.connect(err => {
  if (err) {
    console.error('❌ Không thể kết nối MySQL:', err);
    process.exit(1);
  }
  console.log('✅ Kết nối thành công đến MySQL');
});

// Khai báo các route
app.use('/auth', require('./routes/auth'));
app.use('/exercises', require('./routes/exercises'));
app.use('/results', require('./routes/results'));
app.use('/bot', require('./routes/bot'));
app.use('/chat', require('./routes/chat'));
app.use('/admin', require('./routes/admin'));
app.use('/themes', require('./routes/themes'));

// Mặc định
app.get('/', (req, res) => {
  res.send('🎉 Backend Chess App đang hoạt động!');
});

// Khởi động server
app.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));
