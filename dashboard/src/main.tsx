import { createRoot } from 'react-dom/client';
import { connectLive } from './api/live';
import { App } from './App';
import { appStore, applyTheme } from './state/app';
import './styles.css';

applyTheme(appStore.get().theme);
if (appStore.get().embed) document.documentElement.classList.add('embed');

connectLive();

createRoot(document.getElementById('root')!).render(<App />);
