import { useEffect, useState } from 'react';
import axios from 'axios';

function ExercisesPage() {
  const [exercises, setExercises] = useState([]);

  useEffect(() => {
    axios.get('http://localhost:5000/exercises')
      .then(res => setExercises(res.data))
      .catch(err => console.error('Lỗi tải bài tập:', err));
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>🧠 Danh sách bài tập cờ vua</h2>
      {exercises.length === 0 ? (
        <p>Không có bài tập nào.</p>
      ) : (
        <ul>
          {exercises.map((ex, idx) => (
            <li key={ex.id}>
              <b>Bài {idx + 1}:</b> FEN: <code>{ex.fen}</code> | Mức độ: {ex.level} | Chủ đề: {ex.theme}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ExercisesPage;
