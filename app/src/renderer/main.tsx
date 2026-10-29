import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './App.tsx';

// On a Mac the top bar doubles as the title bar: it makes room for the traffic lights and drags the window.
if (window.frame?.platform === 'darwin') {
  document.documentElement.classList.add('mac');
  window.frame.onFullScreen((on) => document.documentElement.classList.toggle('full-screen', on));
}

createRoot(document.getElementById('root')!).render(<App />);
