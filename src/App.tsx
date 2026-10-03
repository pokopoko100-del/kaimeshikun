import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [status, setStatus] = useState('確認中...')

  useEffect(() => {
    const checkConnection = async () => {
      const { data, error } = await supabase.from('households').select('*')

      if (error) {
        setStatus('接続エラー: ' + error.message)
        console.error('Supabase接続エラー:', error)
      } else {
        setStatus('接続成功!')
        console.log('取得データ:', data)
      }
    }

    checkConnection()
  }, [])

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>かいめし君 接続テスト</h1>
      <p>{status}</p>
    </div>
  )
}

export default App