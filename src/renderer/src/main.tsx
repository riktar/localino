import React from 'react'
import ReactDOM from 'react-dom/client'
import { Panel, UsageWindow } from './components/panel'
import './styles.css'

// nativeTheme drives the media query in every window, including before React mounts.
const scheme = window.matchMedia('(prefers-color-scheme: dark)')
const applyScheme = (): void => { document.documentElement.classList.toggle('dark', scheme.matches) }
applyScheme()
scheme.addEventListener('change', applyScheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{new URLSearchParams(location.search).get('view') === 'usage' ? <UsageWindow/> : <Panel/>}</React.StrictMode>,
)
