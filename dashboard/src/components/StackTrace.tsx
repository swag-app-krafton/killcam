import { memo } from 'react';

const FRAMEWORK = /^(java|javax|jdk|sun|android|androidx|kotlin|kotlinx|dalvik|libcore|com\.android|com\.google\.android|org\.jetbrains|com\.facebook\.react|com\.facebook\.hermes)\./;
const APP = /^com\.swag\./;

type FrameKind = 'app' | 'lib' | 'framework';

function classify(frame: string): FrameKind {
  if (APP.test(frame)) return 'app';
  if (FRAMEWORK.test(frame)) return 'framework';
  return 'lib';
}

/**
 * Java/Kotlin stack trace with app frames (com.swag.*) highlighted, third-party
 * frames normal, and platform frames (java., android., kotlin., ...) dimmed.
 */
export const StackTrace = memo(function StackTrace({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <pre className="stack mono" aria-label="Stack trace">
      {lines.map((line, i) => {
        const at = /^(\s*)at\s+(.+)$/.exec(line);
        if (at) {
          const frame = at[2];
          const kind = classify(frame);
          const m = /^(.*)\.([^.(]+)\((.*)\)$/.exec(frame);
          return (
            <span key={i} className={`st-frame st-${kind}`}>
              {'at '}
              {m ? (
                <>
                  <span className="st-cls">{m[1]}</span>.<span className="st-fn">{m[2]}</span>
                  <span className="st-loc">({m[3]})</span>
                </>
              ) : (
                frame
              )}
            </span>
          );
        }
        if (/^\s*\.\.\.\s*\d+\s+more/.test(line)) {
          return (
            <span key={i} className="st-more">
              {line.trim()}
            </span>
          );
        }
        const caused = /^(Caused by:|Suppressed:)\s*(.*)$/.exec(line.trim());
        if (caused) {
          return (
            <span key={i} className="st-cause">
              <b>{caused[1]}</b> {caused[2]}
            </span>
          );
        }
        return (
          <span key={i} className={i === 0 ? 'st-head' : 'st-text'}>
            {line || '\u00a0'}
          </span>
        );
      })}
    </pre>
  );
});
