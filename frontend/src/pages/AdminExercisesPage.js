// frontend/src/pages/AdminExercisesPage.js
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import './AdminExercisesPage.css';

// danh sách mã các quân (đúng key trong Chessboard.DEFAULT_PIECES)
const PIECES = [
  'wP','wN','wB','wR','wQ','wK',
  'bP','bN','bB','bR','bQ','bK',
];

function AdminExercisesPage() {
  // --- chung ---
  const [themes, setThemes]       = useState([]);
  const [exercises, setExercises] = useState([]);
  const [activePanel, setActivePanel] = useState('theme'); // 'theme' | 'exercise'
  const [message, setMessage]     = useState('');
  const [search, setSearch]       = useState({ global: '', theme: '' });

  // --- chessboard ---
  const [game]       = useState(new Chess());
  const [position, setPosition] = useState(game.fen());
  const [orientation, setOrientation] = useState('white');

  // --- chọn quân / xóa quân ---
  const [currentTool, setCurrentTool] = useState(null);

  // --- form bài tập ---
  const [form, setForm]       = useState({ id: null, fen: '', level: '', theme_id: '', solution: '' });
  const [editing, setEditing] = useState(false);
  const [sideToMove, setSideToMove] = useState('w');  
  // --- form chủ đề ---
  const [newTheme, setNewTheme] = useState('');

  // load lần đầu
  useEffect(() => {
    fetchThemes();
    fetchExercises();
    startAddExercise();
  }, []);

  // đồng bộ FEN vào form
  useEffect(() => {
    setForm(f => ({ ...f, fen: position }));
  }, [position]);

  // helper message
  const showMsg = txt => {
    setMessage(txt);
    setTimeout(() => setMessage(''), 3000);
  };

  // --- CRUD themes ---
  const fetchThemes = () => {
    axios.get('http://localhost:5000/themes')
      .then(r => setThemes(r.data))
      .catch(console.error);
  };
  const addTheme = () => {
    if (!newTheme.trim()) return;
    axios.post('http://localhost:5000/themes', { name: newTheme.trim() })
      .then(() => {
        setNewTheme('');
        fetchThemes();
        showMsg('✅ Đã thêm chủ đề');
      })
      .catch(() => showMsg('❌ Lỗi thêm chủ đề'));
  };
  const editTheme = th => {
    const name = prompt('Tên mới:', th.name);
    if (!name) return;
    axios.put(`http://localhost:5000/themes/${th.id}`, { name })
      .then(fetchThemes)
      .catch(() => showMsg('❌ Lỗi cập nhật chủ đề'));
  };
  const deleteTheme = id => {
    if (!window.confirm('Xóa chủ đề này?')) return;
    axios.delete(`http://localhost:5000/themes/${id}`)
      .then(fetchThemes)
      .catch(() => showMsg('❌ Lỗi xóa chủ đề'));
  };

  // --- CRUD exercises ---
  const fetchExercises = () => {
    axios.get('http://localhost:5000/exercises')
      .then(r => setExercises(r.data))
      .catch(console.error);
  };
  const startAddExercise = () => {
    setEditing(false);
    game.reset();
    setOrientation('white');
    setCurrentTool(null);
    setPosition(game.fen());
    setSideToMove('w');
    setForm({ id: null, fen: game.fen(), level:'', theme_id:'', solution:'' });
    setActivePanel('exercise');
  };
  const startEditExercise = ex => {
    setEditing(true);
    game.load(ex.fen);
    setOrientation(ex.orientation || 'white');
    setPosition(ex.fen);
    const parts = ex.fen.split(' ');
    setSideToMove(parts[1] || 'w');
    setForm({ ...ex });
    setCurrentTool(null);
    setActivePanel('exercise');
  };
  const deleteExercise = id => {
    if (!window.confirm('Xóa bài tập này?')) return;
    axios.delete(`http://localhost:5000/exercises/${id}`)
      .then(fetchExercises)
      .catch(() => showMsg('❌ Lỗi xóa bài tập'));
  };
  const submitExercise = e => {
    e.preventDefault();
    const payload = {
      fen: form.fen,
      level: form.level,
      side_to_move: sideToMove,
      solution: form.solution,
      theme_id: form.theme_id
    };

    const url    = editing
      ? `http://localhost:5000/exercises/${form.id}`
      : 'http://localhost:5000/exercises';
    const method = editing ? axios.put : axios.post;

    method(url, payload)
      .then(() => {
        fetchExercises();
        showMsg(editing ? '✅ Cập nhật thành công' : '✅ Thêm mới thành công');
        startAddExercise();
      })
      .catch(() => showMsg('❌ Lỗi server'));
  };


  // --- thao tác bàn cờ ---
  const onSquareClick = sq => {
    if (currentTool === 'trash') {
      game.remove(sq);
    } else if (PIECES.includes(currentTool)) {
      const color = currentTool[0] === 'w' ? 'w' : 'b';
      const type  = currentTool[1].toLowerCase();
      game.put({ color, type }, sq);
    }
    setPosition(game.fen());
  };
  const rotateBoard = () => setOrientation(o => o === 'white' ? 'black' : 'white');
  const resetBoard  = () => { game.reset(); setOrientation('white'); setPosition(game.fen()); };
  const clearBoard  = () => { game.clear(); setPosition(game.fen()); };

  // --- lọc bài tập ---
  const filteredExercises = exercises.filter(ex => {
    const nm = themes.find(t => t.id===ex.theme_id)?.name || '';
    return (`${ex.fen} ${ex.level} ${nm}`)
      .toLowerCase()
      .includes(search.global.toLowerCase());
  });

  return (
    <div className="exercise-admin-container grid-2cols">
      {message && <div className="success-msg">{message}</div>}

      {/* Cột trái */}
      <div>
        {/* Thêm chủ đề */}
        <div className="admin-card clickable" onClick={() => setActivePanel('theme')}>
          <h4>➕ Thêm chủ đề</h4>
          <div className="input-row">
            <input
              placeholder="Tên chủ đề"
              value={newTheme}
              onChange={e => setNewTheme(e.target.value)}
            />
            <button onClick={addTheme}>Thêm</button>
          </div>
        </div>

        {/* Thêm/Sửa bài tập */}
        <div className="admin-card">
            <h4>
              {editing ? '📝 Sửa bài tập' : '➕ Thêm bài tập'}
              <button
                className="btn-minor clickable"
                onClick={e => {
                  e.stopPropagation();     // ngăn không truyền lên cha
                  startAddExercise();
                  setActivePanel('exercise');
                }}
              >
                Bắt đầu
              </button>
            </h4>


          <div className="editor-container">
            {/* 1) Toolbar chọn quân */}
            <div className="piece-toolbar">
              {PIECES.map(p => (
                <div
                  key={p}
                  className={`piece-tool${currentTool===p ? ' selected' : ''}`}
                  onClick={() => setCurrentTool(p)}
                >
                  <img
                    src={`/images/pieces/${p}.svg`}
                    alt={p}
                    width={32}
                    height={32}
                  />
                </div>
              ))}
              <div
                className={`piece-tool${currentTool==='trash' ? ' selected' : ''}`}
                onClick={() => setCurrentTool('trash')}
              >
                🗑️
              </div>
            </div>

            {/* 2) Chessboard */}
            <Chessboard
              position={position}
              onSquareClick={onSquareClick}
              boardOrientation={orientation}
              boardWidth={300}
              customDarkSquareStyle={{ backgroundColor: '#b58863' }}
              customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
            />

            {/* 3) Controls */}
            <div className="board-controls">
              <button onClick={resetBoard}>🔄 Thế cờ ban đầu</button>
              <button onClick={rotateBoard}>🔄 Quay bàn cờ</button>
              <button onClick={clearBoard}>🗑️ Xóa toàn bộ</button>
            </div>
          </div>

          {/* 4) Form thông tin */}
          <form className="exercise-form" onSubmit={submitExercise}>
            <select
              name="level"
              value={form.level}
              onChange={e=>setForm(f=>({...f, level:e.target.value}))}
              required
            >
              <option value="">Chọn độ khó</option>
              <option value="Dễ">Dễ</option>
              <option value="Trung bình">Trung bình</option>
              <option value="Khó">Khó</option>
            </select>

            <select
              name="theme_id"
              value={form.theme_id}
              onChange={e=>setForm(f=>({...f, theme_id:e.target.value}))}
              required
            >
              <option value="">Chọn chủ đề</option>
              {themes.map(t=>(
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            <input
              name="solution"
              value={form.solution}
              onChange={e=>setForm(f=>({...f, solution:e.target.value}))}
              placeholder="Giải pháp (chuỗi nước đi)"
              required
            />
            {/* –– Chọn lượt đi –– */}
            <div className="setting-group">
              <label>Lượt đi:</label>
              <select
                value={sideToMove}
                onChange={e => {
                  const s = e.target.value;        // 'w' hoặc 'b'
                  setSideToMove(s);

                  // cập nhật lại FEN trong position và game
                  const parts = position.split(' ');
                  parts[1] = s;
                  const newFen = parts.join(' ');
                  game.load(newFen);
                  setPosition(newFen);
                }}
              >
                <option value="w">Trắng</option>
                <option value="b">Đen</option>
              </select>
            </div>

            <input
              readOnly
              placeholder="FEN"
              value={position}
            />

            <button type="submit">
              {editing ? 'Cập nhật' : 'Thêm mới'}
            </button>
          </form>
        </div>
      </div>

      {/* Cột phải */}
      <div className="admin-panel">
        {/* Danh sách chủ đề */}
        {activePanel==='theme' && (
          <div className="panel-card">
            <h4>📋 Danh sách chủ đề</h4>
            <div className="table-filter">
              <input
                name="theme"
                placeholder="🔍 Tìm chủ đề..."
                value={search.theme}
                onChange={e=>setSearch(s=>({...s, theme:e.target.value}))}
              />
            </div>
            <div className="theme-table-wrapper">
              <table className="theme-table">
                <thead>
                  <tr><th>STT</th><th>Chủ đề</th><th>Hành động</th></tr>
                </thead>
                <tbody>
                  {themes
                    .filter(t=>t.name.toLowerCase().includes(search.theme.toLowerCase()))
                    .map((t,i)=>(
                      <tr key={t.id}>
                        <td>{i+1}</td>
                        <td>{t.name}</td>
                        <td>
                          <button onClick={()=>editTheme(t)}>✏️</button>
                          <button onClick={()=>deleteTheme(t.id)}>🗑️</button>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Danh sách bài tập */}
        {activePanel==='exercise' && (
          <div className="panel-card">
            <h4>📋 Danh sách bài tập</h4>
            <div className="table-filter">
              <input
                name="global"
                placeholder="🔍 Tìm kiếm..."
                value={search.global}
                onChange={e=>setSearch(s=>({...s, global:e.target.value}))}
              />
            </div>
            <div className="table-wrapper">
              <table className="exercise-table">
                <thead>
                  <tr>
                    <th>STT</th><th>THẾ CỜ</th><th>Độ khó</th><th>Chủ đề</th><th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExercises.map(ex => {
                    const theme = themes.find(t => t.id === ex.theme_id)?.name || 'N/A';
                    return (
                      <tr key={ex.id}>
                        <td>{ex.id}</td>
                        <td>
                          <div className="fen-cell">
                            {/* Bàn cờ nhỏ */}
                            <div className="small-board">
                              <Chessboard
                                position={ex.fen}
                                boardWidth={80}
                                boardOrientation={ex.side_to_move === 'b' ? 'black' : 'white'}
                                customDarkSquareStyle={{ backgroundColor: '#b58863' }}
                                customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
                                draggable={false}
                                arePiecesDraggable={false}
                              />
                            </div>
                            {/* Tooltip phóng to */}
                            <div className="tooltip-board">
                              <Chessboard
                                position={ex.fen}
                                boardWidth={240}
                                boardOrientation={ex.side_to_move === 'b' ? 'black' : 'white'}
                                customDarkSquareStyle={{ backgroundColor: '#b58863' }}
                                customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
                                draggable={false}
                                arePiecesDraggable={false}
                              />
                            </div>
                          </div>
                        </td>
                        <td>{ex.level}</td>
                        <td>{theme}</td>
                        <td>
                          <button onClick={()=>startEditExercise(ex)}>✏️</button>
                          <button onClick={()=>deleteExercise(ex.id)}>🗑️</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminExercisesPage;