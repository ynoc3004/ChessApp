const mysql = require('mysql2');
const conn = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'chess_app'
});
conn.connect(err => {
  if (err) throw err;
  console.log('✅ Kết nối thành công đến MySQL');
});
module.exports = conn;
