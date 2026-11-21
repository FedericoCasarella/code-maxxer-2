import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { ErrorBoundary } from './components/app/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary where="app">
    <App />
  </ErrorBoundary>
)
