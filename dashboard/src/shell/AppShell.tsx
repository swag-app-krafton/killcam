import { Suspense, lazy, useCallback, useEffect, useRef, type ComponentType } from 'react';
import { Spinner } from '@/design';
import { authStore } from '../api/client';
import { DialogHost, ToastHost } from '../kit/overlays';
import { useHighlightTarget } from '../lib/highlight';
import { useHotkeys } from '../lib/hooks';
import { useIsNarrow } from '../lib/media';
import { appStore } from '../state/app';
import { useRoute, type Panel } from '../state/router';
import { useStore } from '../state/store';
import { BottomTabs, EmbedStrips, EmbedTopBar } from './Embed';
import { ConnectionBanner, PageHeader } from './PageHeader';
import { BreakpointTray } from '../panels/BreakpointTray';
import { ConditionsBanner } from '../panels/NetworkConditions';
import { PinScreen } from './PinScreen';
import { screenOf } from './routes';
import { SessionDetailsDialog } from './SessionDetails';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import s from './Shell.module.css';

/** Each screen is its own chunk, loaded on first visit (as in swagperf). */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));

const PAGES: Record<Panel, ComponentType> = {
  replay: page(() => import('../panels/ReplayPanel'), 'ReplayPanel'),
  network: page(() => import('../panels/NetworkPanel'), 'NetworkPanel'),
  logs: page(() => import('../panels/LogsPanel'), 'LogsPanel'),
  crashes: page(() => import('../panels/CrashesPanel'), 'CrashesPanel'),
  mocks: page(() => import('../panels/MocksPanel'), 'MocksPanel'),
  endpoints: page(() => import('../panels/EndpointsPanel'), 'EndpointsPanel'),
  flags: page(() => import('../panels/FlagsPanel'), 'FlagsPanel'),
  'remote-config': page(() => import('../panels/RemoteConfigPanel'), 'RemoteConfigPanel'),
  actions: page(() => import('../panels/ActionsPanel'), 'ActionsPanel'),
  sessions: page(() => import('../panels/SessionsPanel'), 'SessionsPanel'),
  storage: page(() => import('../panels/StoragePanel'), 'StoragePanel'),
};

/** Pages built around one long list fill the window's height. */
const FILL: Panel[] = ['replay', 'network', 'logs'];

/** Layout, after swagperf's AppShell: [sidebar] [main column] [dock]. Only
 *  <main> scrolls; the dock (a call's detail, a file) is a flex sibling, so
 *  opening it reflows the page instead of covering it. The phone window
 *  (?embed=1) swaps the sidebar and top bar for one compact bar and tabs. */
export function AppShell() {
  const route = useRoute();
  const embed = useStore(appStore, (x) => x.embed);
  const devtools = useStore(appStore, (x) => x.devtools);
  const rail = useStore(appStore, (x) => x.railPinned);
  const drawerOpen = useStore(appStore, (x) => x.drawerOpen);
  const needPin = useStore(authStore, (x) => x.needPin);
  const narrow = useIsNarrow();
  const mainRef = useRef<HTMLElement>(null);
  const screen = screenOf(route.panel);
  const Page = PAGES[route.panel];

  useHighlightTarget(useCallback(() => mainRef.current, []));

  useHotkeys({
    '/': () => {
      const el = document.querySelector<HTMLInputElement>('#main input[type=search]');
      el?.focus();
      el?.select();
    },
  });

  // A screen change starts at the top of the page and closes the drawer.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    appStore.set({ drawerOpen: false, detailsOpen: false });
    document.title = `${screen.label} · Killcam`;
  }, [route.panel, screen.label]);

  return (
    <div className={[s.root, embed && s.embed, devtools && s.devtools].filter(Boolean).join(' ')}>
      {!embed &&
        (narrow ? (
          drawerOpen && (
            <>
              <div className={s.backdrop} onClick={() => appStore.set({ drawerOpen: false })} />
              <Sidebar rail={false} drawer onNavigate={() => appStore.set({ drawerOpen: false })} />
            </>
          )
        ) : (
          <Sidebar rail={rail} drawer={false} />
        ))}
      <div className={s.column}>
        {embed ? <EmbedTopBar /> : <TopBar narrow={narrow} />}
        {embed && <EmbedStrips />}
        <main ref={mainRef} className={s.main} id="main">
          <div className={FILL.includes(route.panel) ? `${s.page} ${s.fill}` : s.page}>
            {!embed && <PageHeader screen={screen} />}
            {!embed && <ConnectionBanner />}
            <BreakpointTray />
            <ConditionsBanner />
            <Suspense fallback={<Spinner />}>
              <Page />
            </Suspense>
          </div>
        </main>
        {embed && <BottomTabs />}
      </div>
      <div id="kc-dock" className={s.dockSlot} />
      <ToastHost />
      <DialogHost />
      <SessionDetailsDialog />
      {needPin && <PinScreen />}
    </div>
  );
}
