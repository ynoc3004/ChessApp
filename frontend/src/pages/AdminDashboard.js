import { Link } from 'react-router-dom';
import './AdminDashboard.css';

function AdminDashboard() {
  return (
    <div className="admin-container">
      <h1>🔒 Admin Dashboard</h1>
      <p>Chào mừng admin đến với khu vực quản trị.</p>

      <div className="admin-grid">
        <Link to="/admin/exercises" className="admin-card red">
          <span className="emoji">📚</span>
          <h3>Quản lý bài tập</h3>
          <p>Thêm, sửa, xoá các bài tập cờ vua</p>
        </Link>

        <Link to="/admin/users" className="admin-card blue">
          <span className="emoji">👥</span>
          <h3>Quản lý người dùng</h3>
          <p>Xem danh sách và quyền tài khoản</p>
        </Link>

        <Link to="/admin/stats" className="admin-card green">
          <span className="emoji">📊</span>
          <h3>Thống kê kết quả</h3>
          <p>Theo dõi hoạt động của học viên</p>
        </Link>
      </div>
    </div>
  );
}

export default AdminDashboard;
