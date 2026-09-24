import { createRoot } from 'react-dom/client';
import '@/design/foundations/global.css';
import './fonts/fonts.css';
import './app.css';
import { connectLive } from './api/live';
import { AppShell } from './shell/AppShell';
import { appStore, applyTheme } from './state/app';

applyTheme(appStore.get().theme);
if (appStore.get().embed) document.documentElement.classList.add('embed');

connectLive();

createRoot(document.getElementById('root')!).render(<AppShell />);
