import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';

// On a Mac the view headers double as the title bar: they make room for the traffic lights and drag the window.
if (window.frame?.platform === 'darwin') {
  document.documentElement.classList.add('mac');
  window.frame.onFullScreen((on) => document.documentElement.classList.toggle('full-screen', on));
}

// A focus ring only while moving with Tab, as in Switchboard: a click clears it, Tab brings it back.
window.addEventListener('keydown', (e) => e.key === 'Tab' && document.documentElement.setAttribute('data-keyboard-nav', ''), true);
window.addEventListener('pointerdown', () => document.documentElement.removeAttribute('data-keyboard-nav'), true);

createRoot(document.getElementById('root')!).render(<App />);
