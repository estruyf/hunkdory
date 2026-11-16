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

// The keys next to buttons, unless turned off in Settings. The shortcuts work either way.
const hints = () => {
  try {
    document.documentElement.toggleAttribute('data-no-shortcut-hints', localStorage.getItem('pref:shortcut-hints') === 'false');
  } catch {
    // Storage blocked: they show.
  }
};
hints();
window.addEventListener('pref-changed', (e) => (e as CustomEvent<string>).detail === 'shortcut-hints' && hints());
// Changed in another window.
window.addEventListener('storage', (e) => e.key === 'pref:shortcut-hints' && hints());

createRoot(document.getElementById('root')!).render(<App />);
