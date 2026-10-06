// src/main.tsx（ファイル全体。これで丸ごと置き換えてください）
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ズーム無効③：iPhone(Safari / ホーム画面アプリ)のピンチ拡大を止める
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
