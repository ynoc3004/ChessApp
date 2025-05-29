import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export default function AdminRoute({ children }) {
  const name     = localStorage.getItem('name');
  const isAdmin  = localStorage.getItem('is_admin') === '1';
  const location = useLocation();

  if (!name) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!isAdmin) {
    // đã login nhưng không phải admin → quay về home
    return <Navigate to="/" replace />;
  }

  return children;
}
