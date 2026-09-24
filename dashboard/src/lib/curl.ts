import type { NetworkCall } from '../api/types';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** cURL for a captured call (used for saved sessions; live calls use /api/network/{id}/curl). */
export function buildCurl(c: NetworkCall): string {
  const parts = [`curl -X ${c.method} ${q(c.url)}`];
  for (const h of c.requestHeaders) {
    if (/^(accept-encoding|content-length|host)$/i.test(h.name)) continue;
    parts.push(`-H ${q(`${h.name}: ${h.value}`)}`);
  }
  if (c.requestBody?.text) parts.push(`--data-raw ${q(c.requestBody.text)}`);
  else if (c.requestBody?.base64) parts.push(`--data-binary @body.bin  # ${c.requestBody.size} bytes of binary`);
  return parts.join(' \\\n  ');
}
