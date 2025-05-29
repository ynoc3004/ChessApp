import { useEffect, useState } from 'react';
import axios from 'axios';

function VerifyEmail() {
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      axios.get(`http://localhost:5000/auth/verify?token=${token}`)
        .then(res => setMsg(res.data))
        .catch(() => setMsg('Token không hợp lệ hoặc đã hết hạn.'));
    }
  }, []);

  return (
    <div>
      <h2>Xác minh tài khoản</h2>
      <p>{msg}</p>
    </div>
  );
}

export default VerifyEmail;
