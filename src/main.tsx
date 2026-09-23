import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, loadSettings } from './ui/settings';
import './styles.css';

// Paint the saved palette before the first render, so nothing flashes.
applyTheme(loadSettings());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
