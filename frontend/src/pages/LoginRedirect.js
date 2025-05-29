// frontend/src/pages/LoginRedirect.js
import { useState } from 'react';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';

function LoginRedirect() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [msg, setMsg]   = useState('');
  const navigate        = useNavigate();
  const location        = useLocation();

  // Nếu có state.from (được ProtectedRoute đẩy vào), thì login xong quay về đó,
  // ngược lại mặc định là /exercises
  const from = location.state?.from?.pathname || '/exercises';

  const handleChange = e => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      const res = await axios.post(
        'http://localhost:5000/auth/login',
        form
      );
      const { token, is_admin, name } = res.data;

      // Lưu token + user info
      localStorage.setItem('token', token);
      localStorage.setItem('name', name);
      localStorage.setItem('is_admin', is_admin);

      // Nếu admin, luôn vào /admin
      if (parseInt(is_admin, 10) === 1) {
        navigate('/admin', { replace: true });
      } else {
        // user thường thì quay về from
        navigate(from, { replace: true });
      }
    } catch (err) {
      setMsg(err.response?.data?.message || 'Lỗi đăng nhập');
    }
  };

  return (
    <div className="login-container">
      <h2>Đăng nhập</h2>
      <form onSubmit={handleSubmit} className="login-form">
        <input
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
        /><br />
        <input
          type="password"
          name="password"
          placeholder="Mật khẩu"
          value={form.password}
          onChange={handleChange}
          required
        /><br />
        <button type="submit">Đăng nhập</button>
      </form>
      {msg && <p className="error-msg">{msg}</p>}
    </div>
  );
}

export default LoginRedirect;
