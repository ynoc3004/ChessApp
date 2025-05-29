// frontend/src/App.js
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Navbar             from './components/Navbar';
import Footer             from './components/Footer';
import Home               from './pages/Home';
import Register           from './pages/Register';
import LoginRedirect      from './pages/LoginRedirect';
import VerifyEmail        from './pages/VerifyEmail';
import ExercisesPage      from './pages/ExercisesPage';
import AdminDashboard     from './pages/AdminDashboard';
import AdminExercisesPage from './pages/AdminExercisesPage';
import AdminUsersPage from './pages/AdminUsersPage';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute     from './components/AdminRoute';

function App() {
  return (
    <BrowserRouter>
      <Navbar />

      <Routes>
        {/* Các route công khai */}
        <Route path="/"        element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login"    element={<LoginRedirect />} />
        <Route path="/verify"   element={<VerifyEmail />} />

        {/* Route dành cho user đã login */}
        <Route
          path="/exercises"
          element={
            <ProtectedRoute>
              <ExercisesPage />
            </ProtectedRoute>
          }
        />

        {/* Route dành riêng cho Admin */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/exercises"
          element={
            <AdminRoute>
              <AdminExercisesPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <AdminUsersPage />
            </AdminRoute>
          }
        />
        {/* Nếu không trùng route nào, redirect về Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
        
      </Routes>

      <Footer />
    </BrowserRouter>
  );
}

export default App;
