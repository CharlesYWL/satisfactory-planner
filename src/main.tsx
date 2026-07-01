import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './i18n';
import './styles.css';
import { initStateFromUrl, startUrlSync } from './store/urlSync';

// 先从 URL 灌入初始状态（在首次渲染前），再开启 store → URL 的实时回写同步。
initStateFromUrl();
startUrlSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
