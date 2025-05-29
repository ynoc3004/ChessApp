import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  const name = localStorage.getItem('name');
  const location = useLocation();

  if (!name) {
    // chưa login → redirect về /login, payload vị trí ban đầu
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
