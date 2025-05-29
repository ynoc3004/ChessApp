// frontend/src/pages/Home.js
import { Link } from 'react-router-dom';
import './Home.css';

function Home() {
  return (
    <div className="home-container">
      <h1 className="home-title">♟️ CHĂM CHỈ LUYỆN TẬP LÀ CÁCH TỐT NHẤT ĐỂ NÂNG CAO TRÌNH ĐỘ ♟️</h1>
      
      <div className="home-nav">
        <Link to="/exercises">
          <div className="home-button">📚 Làm bài tập</div>
        </Link>
        <Link to="/play">
          <div className="home-button">🤖 Chơi với bot</div>
        </Link>
        <Link to="/chat">
          <div className="home-button">💬 Chat với AI</div>
        </Link>
      </div>
    </div>
  );
}

export default Home;
