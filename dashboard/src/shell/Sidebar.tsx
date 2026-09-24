import { IconButton, Row, Spacer, Stack, Text } from '@/design';
import { liveStore } from '../api/live';
import { appStore, toggleRail } from '../state/app';
import { useRoute } from '../state/router';
import { useStore } from '../state/store';
import { GROUPS, SCREENS } from './routes';
import s from './Shell.module.css';

/** swagperf's sidebar: numbered screens in groups, a rail of two-letter codes
 *  when collapsed, a drawer on narrow screens. */
export function Sidebar({ rail, drawer, onNavigate }: { rail: boolean; drawer: boolean; onNavigate?: () => void }) {
  const { panel } = useRoute();
  const devtools = useStore(appStore, (x) => x.devtools);
  const info = useStore(liveStore, (x) => x.info);
  const full = !rail;
  return (
    <nav aria-label="Primary" className={`${s.nav} ${drawer ? s.navDrawer : rail ? s.navRail : ''}`}>
      {/* In React Native DevTools the host already shows the product name. */}
      {!devtools && (
        <Row gap={12} className={s.brand}>
          <div className={s.brandMark}>KC</div>
          {full && (
            <div className={s.brandName}>
              SWAG PAY
              <br />
              KILLCAM
            </div>
          )}
        </Row>
      )}
      {GROUPS.map((g) => (
        <div key={g} className={s.group}>
          <Text as="div" variant="label" nowrap className={s.groupLabel}>
            {full ? g : '—'}
          </Text>
          <Stack gap={2}>
            {SCREENS.filter((x) => x.group === g).map((x) => (
              <a key={x.id} href={`#/${x.id}`} className={s.item} title={x.label} aria-current={x.id === panel ? 'page' : undefined} onClick={onNavigate}>
                <span className={s.mark}>{full ? String(SCREENS.indexOf(x) + 1).padStart(2, '0') : x.code}</span>
                {full && <span>{x.label}</span>}
              </a>
            ))}
          </Stack>
        </div>
      ))}
      <Spacer />
      <Row gap={10} className={s.navFoot}>
        {!drawer && <IconButton icon={rail ? 'chevronsRight' : 'chevronsLeft'} label={rail ? 'Expand sidebar' : 'Collapse sidebar'} outlined onClick={toggleRail} />}
        {full && (
          <Text as="div" variant="caption">
            Killcam {info?.killcamVersion ?? ''}
            <br />
            in {info ? `${info.appName} ${info.versionName}` : 'the app'}
          </Text>
        )}
      </Row>
    </nav>
  );
}
