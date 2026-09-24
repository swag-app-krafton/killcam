import type { MatchType } from '../api/types';

/**
 * Client-side mirror of the device's mock URL matching (for the "test URL" box).
 * contains: substring of the full URL. exact: whole URL equality (query included).
 * glob: whole-URL match where `*` is any run of characters (including "/") and `?` one character.
 * regex: Java-style find() anywhere in the URL (anchor with ^...$ for a full match).
 */
export function compilePattern(type: MatchType, pattern: string): { test: (url: string) => boolean; error: string | null } {
  try {
    switch (type) {
      case 'contains':
        return { test: (u) => u.includes(pattern), error: null };
      case 'exact':
        return { test: (u) => u === pattern, error: null };
      case 'glob': {
        let re = '';
        for (const ch of pattern) {
          if (ch === '*') re += '.*';
          else if (ch === '?') re += '.';
          else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
        const r = new RegExp('^' + re + '$');
        return { test: (u) => r.test(u), error: null };
      }
      case 'regex': {
        const r = new RegExp(pattern);
        return { test: (u) => r.test(u), error: null };
      }
    }
  } catch (e) {
    return { test: () => false, error: e instanceof Error ? e.message : String(e) };
  }
}
