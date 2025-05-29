import { useState } from 'react';
import axios from 'axios';

function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [msg, setMsg] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await axios.post('http://localhost:5000/auth/register', form);
    setMsg(res.data.message || 'Vui lòng kiểm tra email để xác minh.');
  };

  return (
    <div>
      <h2>Đăng ký</h2>
      <form onSubmit={handleSubmit}>
        <input name="name" placeholder="Tên" onChange={handleChange} /><br />
        <input name="email" placeholder="Email" onChange={handleChange} /><br />
        <input type="password" name="password" placeholder="Mật khẩu" onChange={handleChange} /><br />
        <button type="submit">Đăng ký</button>
      </form>
      <p>{msg}</p>
    </div>
  );
}

export default Register;
