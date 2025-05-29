import React, { useEffect, useState } from 'react';
import axios from 'axios';

const AdminUsersPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      const { data } = await axios.get('/admin/users', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setUsers(data);
      setLoading(false);
    };
    fetchUsers();
  }, []);

  const handleToggleAdmin = async (id, current) => {
    await axios.put(`/admin/users/${id}`, {
      is_admin: !current,
    }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    setUsers(u => u.map(x => x.id === id ? { ...x, is_admin: !current } : x));
  };

  const handleDelete = async id => {
    if (window.confirm('Bạn có chắc muốn xóa user này?')) {
      await axios.delete(`/admin/users/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setUsers(u => u.filter(x => x.id !== id));
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div className="admin-users">
      <h2>Quản lý người dùng</h2>
      <table className="table">
        <thead>
          <tr>
            <th>ID</th><th>Name</th><th>Email</th><th>Admin?</th><th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <button
                  className={`btn btn-sm ${u.is_admin ? 'btn-success' : 'btn-outline-secondary'}`}
                  onClick={() => handleToggleAdmin(u.id, u.is_admin)}
                >
                  {u.is_admin ? 'Yes' : 'No'}
                </button>
              </td>
              <td>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u.id)}>
                  Xóa
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminUsersPage;
