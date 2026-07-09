import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerCustomProtocol } from 'linkifyjs';
import App from './App';
import './styles/globals.css';

// note:// 블록 링크 스킴 — linkify가 초기화되기 전, 앱 시작 시 한 번만 등록.
// (에디터마다 tiptap Link가 재등록하면 "already initialized" 경고가 뜬다)
registerCustomProtocol('note');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
