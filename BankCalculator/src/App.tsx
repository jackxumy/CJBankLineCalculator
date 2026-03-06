import { useState } from 'react';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import './App.css';

function App() {
  const [showEditor, setShowEditor] = useState(false);

  if (!showEditor) {
    return <HomePage onNavigate={() => setShowEditor(true)} />;
  }

  return <EditorPage />;
}

export default App;

