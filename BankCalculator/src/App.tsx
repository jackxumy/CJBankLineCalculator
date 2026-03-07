import { useState } from 'react';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import ResultPage from './pages/ResultPage';
import './App.css';

type Page = 'home' | 'editor' | 'result';

function App() {
  const [page, setPage] = useState<Page>('home');

  if (page === 'home') {
    return <HomePage onNavigate={() => setPage('editor')} />;
  }

  if (page === 'editor') {
    return (
      <>
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }}>
          <button
            onClick={() => setPage('result')}
            style={{ padding: '6px 10px', fontSize: 12 }}
          >
            切换到结果可视化
          </button>
        </div>
        <EditorPage />
      </>
    );
  }

  // result 页面
  return (
    <>
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }}>
        <button
          onClick={() => setPage('editor')}
          style={{ padding: '6px 10px', fontSize: 12 }}
        >
          返回编辑页面
        </button>
      </div>
      <ResultPage />
    </>
  );
}

export default App;

