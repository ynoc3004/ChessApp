import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './Navbar.css';

function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const name = localStorage.getItem('name');
    const is_admin = localStorage.getItem('is_admin');
    if (name) setUser({ name, is_admin });
    else setUser(null);
  }, [location]);

  const handleLogout = () => {
    localStorage.clear();
    setUser(null);
    navigate('/');
  };

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <Link to="/" className="nav-link">Trang chủ</Link>
        {user && (
          <>
            <span className="nav-text">👋 Xin chào, <b>{user.name}</b></span>
            {user.is_admin === '1' && (
              <Link to="/admin" className="nav-link">Quản trị</Link>
            )}
          </>
        )}
      </div>

      <div className="navbar-right">
        {!user ? (
          <>
            <Link to="/login" className="nav-link">Đăng nhập</Link>
            <Link to="/register" className="nav-link">Đăng ký</Link>
          </>
        ) : (
          <button onClick={handleLogout} className="logout-btn">Đăng xuất</button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
