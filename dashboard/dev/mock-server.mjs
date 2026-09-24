#!/usr/bin/env node
/**
 * Killcam dev mock server: implements every endpoint in docs/API.md with
 * in-memory fake data for Swag Pay, so the dashboard can be built and demoed
 * without a phone. Plain `node:http`, no dependencies.
 *
 *   npm run mock                  # http://localhost:8090
 *   PORT=9000 npm run mock
 *   MOCK_REQUIRE_PIN=1 npm run mock   # every /api call needs the PIN cookie (PIN 123456)
 *   MOCK_NO_STORAGE=1 npm run mock    # prefs/db/files/mmkv/remote-config answer 501 (or a list: prefs,mmkv)
 *
 * Anything that is not /api/* is served from the production build in
 * killcam-core/src/main/resources/killcam-web (run `npm run build` first).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const PORT = Number(process.env.PORT ?? 8090);
const REQUIRE_PIN = process.env.MOCK_REQUIRE_PIN === '1';
/** MOCK_NO_STORAGE=prefs,databases,files,mmkv,remote-config (or 1 for all) answers 501 like a device without that provider. */
const NO_STORAGE = new Set(
  process.env.MOCK_NO_STORAGE === '1'
    ? ['prefs', 'databases', 'files', 'mmkv', 'remote-config']
    : (process.env.MOCK_NO_STORAGE ?? '').split(',').filter(Boolean),
);
const PIN = process.env.MOCK_PIN ?? '123456';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(HERE, '../../killcam-core/src/main/resources/killcam-web');
const KILLCAM_VERSION = '0.1.0-dev';
const APP_VERSION = '3.14.0 (31400)';

// ------------------------------------------------------------------ utils --

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5ca9);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => Math.round(a + rand() * (b - a));
const hexStr = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
const upper = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rand() * 32)]).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => structuredClone(o);

let seqCounter = 0;
const nextSeq = () => ++seqCounter;
let idCounter = 0;
const uid = (prefix) => `${prefix}_${(++idCounter).toString(36).padStart(4, '0')}${hexStr(6)}`;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A small valid RGB PNG, generated so the "image fetch" call has a real binary body. */
function makePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const BANNER_PNG = makePng(96, 48, (x, y) => {
  const stripe = (x + y) % 16 < 8;
  return [242 - y, stripe ? 169 : 140, x < 8 ? 40 : 0];
});

/** Minimal "stored" (uncompressed) ZIP writer for the bug-bundle export. */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ------------------------------------------------------------- fake world --

const USER = { id: 'usr_7Hk2pQx9', name: 'Rahul Sharma', vpa: 'rahul@swag', phone: '+91 98•••••321' };
const DEVICE_ID = 'dvc_' + hexStr(16);
const JWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfN0hrMnBReDkiLCJleHAiOjE3OTAwMDAwMDB9.' + hexStr(43);
const PAYEES = [
  { name: 'RAMESH KUMAR', vpa: 'chaiwala.ramesh@ybl', merchant: true, mcc: '5812', amount: 4500, note: 'Chai & samosa' },
  { name: 'Priya Nair', vpa: 'priya.n@okhdfc', merchant: false, mcc: '0000', amount: 125000, note: 'Goa trip share' },
  { name: 'BGMI UC Store', vpa: 'krafton.uc@icici', merchant: true, mcc: '5816', amount: 79900, note: '660 UC top-up' },
  { name: 'Aarav Mehta', vpa: 'aarav.m@okaxis', merchant: false, mcc: '0000', amount: 30000, note: 'Pizza' },
  { name: 'Fresh Mart', vpa: 'freshmart.blr@paytm', merchant: true, mcc: '5411', amount: 68250, note: 'Groceries' },
];
const CONTACT_NAMES = ['Ananya Iyer', 'Vikram Singh', 'Sneha Reddy', 'Arjun Kapoor', 'Kavya Menon', 'Rohan Das', 'Ishita Jain', 'Karthik Rao', 'Meera Pillai', 'Aditya Verma', 'Neha Gupta', 'Siddharth Bose', 'Pooja Shah', 'Nikhil Joshi', 'Tanvi Kulkarni', 'Varun Malhotra', 'Riya Chatterjee', 'Harsh Agarwal', 'Diya Sen', 'Manav Arora'];
const BANKS = ['okhdfc', 'okaxis', 'ybl', 'oksbi', 'icici', 'swag'];

const baseReqHeaders = (extra = []) => [
  { name: 'Accept', value: 'application/json' },
  { name: 'Authorization', value: `Bearer ${JWT.slice(0, 48)}…` },
  { name: 'X-Device-Id', value: DEVICE_ID },
  { name: 'X-App-Version', value: '3.14.0' },
  { name: 'X-Request-Id', value: crypto.randomUUID() },
  { name: 'User-Agent', value: 'SwagPay/3.14.0 (Android 15; Pixel 8) okhttp/5.1.0' },
  { name: 'Accept-Encoding', value: 'gzip' },
  ...extra,
];
const baseResHeaders = (type, len, extra = []) => [
  { name: 'content-type', value: type },
  { name: 'content-length', value: String(len) },
  { name: 'date', value: new Date().toUTCString() },
  { name: 'server', value: 'envoy' },
  { name: 'x-request-id', value: crypto.randomUUID() },
  { name: 'x-envoy-upstream-service-time', value: String(between(8, 180)) },
  { name: 'cache-control', value: 'no-store' },
  { name: 'strict-transport-security', value: 'max-age=31536000; includeSubDomains' },
  ...extra,
];
const textBody = (obj, type = 'application/json') => {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { text, base64: null, size: Buffer.byteLength(text), truncated: false, contentType: type };
};
const txnRef = () => 'SWG' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + upper(10);

// --------------------------------------------------------------- sessions --

function makeAppInfo(sessionId, sessionStartMs) {
  const mem = between(96, 180);
  return {
    appName: 'Swag Pay',
    packageName: 'com.swag.pay',
    versionName: '3.14.0',
    versionCode: 31400,
    buildType: 'debug',
    deviceName: 'Pixel 8 · Android 15',
    sessionId,
    sessionStartMs,
    killcamVersion: KILLCAM_VERSION,
    sections: [
      {
        title: 'App',
        items: [
          { label: 'Package', value: 'com.swag.pay' },
          { label: 'Version', value: APP_VERSION },
          { label: 'Build type', value: 'debug' },
          { label: 'Flavor', value: 'stage' },
          { label: 'Min / target SDK', value: '26 / 35' },
          { label: 'First installed', value: '2026-08-02 10:14:51' },
          { label: 'Last updated', value: '2026-09-23 18:40:07' },
          { label: 'Installer', value: 'adb' },
          { label: 'Git SHA', value: 'a91f3c2 (feature/upi-lite)' },
        ],
      },
      {
        title: 'Device',
        items: [
          { label: 'Model', value: 'Google Pixel 8 (shiba)' },
          { label: 'Android', value: '15 (API 35), security patch 2026-09-05' },
          { label: 'ABI', value: 'arm64-v8a' },
          { label: 'Screen', value: '1080 × 2400 px, 420 dpi, 1.0× font scale' },
          { label: 'Locale / time zone', value: 'en-IN · Asia/Kolkata' },
          { label: 'Battery', value: '64% · not charging' },
          { label: 'Network', value: 'Wi-Fi (Krafton-Guest), metered: no' },
        ],
      },
      {
        title: 'Runtime',
        items: [
          { label: 'Process', value: `com.swag.pay (pid ${between(12000, 29000)})` },
          { label: 'Heap', value: `${mem} MB used of 512 MB` },
          { label: 'Threads', value: String(between(60, 110)) },
          { label: 'Uptime', value: `${Math.round((Date.now() - sessionStartMs) / 60000)} min` },
          { label: 'React Native', value: '0.79.2 (Hermes, new arch)' },
          { label: 'OkHttp', value: '5.1.0' },
          { label: 'Compose BOM', value: '2026.09.00' },
        ],
      },
      {
        title: 'Swag Pay',
        items: [
          { label: 'User', value: `${USER.name} (${USER.id})` },
          { label: 'Primary VPA', value: USER.vpa },
          { label: 'Linked bank', value: 'HDFC Bank ••4821' },
          { label: 'KYC', value: 'FULL' },
          { label: 'Environment', value: 'stage' },
          { label: 'API base URL', value: 'https://api.swag.gg/v1/' },
          { label: 'Remote config', value: 'v118, fetched 3 min ago' },
          { label: 'Device binding', value: 'BOUND (SIM 1)' },
        ],
      },
      {
        title: 'Killcam',
        items: [
          { label: 'Version', value: KILLCAM_VERSION },
          { label: 'Session', value: sessionId },
          { label: 'Screenshot mode', value: 'on screen change + tap, 540 px JPEG q70' },
          { label: 'Buffers', value: 'network 1000 · logs 5000 · timeline 5000' },
        ],
      },
    ],
  };
}

function newSession(startMs, { live = true, reason = 'live', label = null } = {}) {
  const id = 'ses_' + new Date(startMs).toISOString().slice(0, 10).replace(/-/g, '') + '_' + hexStr(6);
  return {
    id,
    label,
    startMs,
    endMs: null,
    live,
    reason,
    app: makeAppInfo(id, startMs),
    network: [],
    logs: [],
    crashes: [],
    timeline: [],
    screenshots: new Map(),
    currentScreen: null,
  };
}

function summaryOf(s) {
  const fatal = s.crashes.find((c) => c.fatal) ?? null;
  return {
    id: s.id,
    label: s.label,
    startMs: s.startMs,
    endMs: s.endMs,
    live: s.live,
    reason: s.reason,
    crash: s.reason === 'crash' && fatal ? crashSummary(fatal) : null,
    appVersion: APP_VERSION,
    screenshotCount: s.screenshots.size,
    eventCount: s.network.length + s.logs.length + s.timeline.length + s.crashes.length,
  };
}
const netSummary = (c) => {
  const { protocol, responseMessage, requestHeaders, requestBody, responseHeaders, responseBody, ...rest } = c;
  return rest;
};
const crashSummary = (c) => {
  const { stackTrace, ...rest } = c;
  return rest;
};
function bundleOf(s) {
  return {
    session: summaryOf(s),
    app: s.app,
    network: s.network,
    logs: s.logs,
    crashes: s.crashes,
    timeline: s.timeline,
  };
}

// ------------------------------------------------------------- simulator --

/**
 * Records app activity into a session. In history mode (`live=false`) time is
 * synthetic and advanced by wait(); in live mode events are stamped with the
 * wall clock, broadcast over SSE, and network calls complete asynchronously.
 */
class Sim {
  constructor(session, { live, t }) {
    this.s = session;
    this.live = live;
    this.t = t ?? Date.now();
    this.cycle = 0;
  }
  now() {
    return this.live ? Date.now() : this.t;
  }
  async wait(ms) {
    if (this.live) await sleep(ms);
    else this.t += ms;
  }
  emit(event, data) {
    if (this.live && this.s === state.live) broadcast(event, data);
  }
  get paused() {
    return this.live && state.capturePaused;
  }
  pushTimeline(type, label, extra = {}) {
    if (this.paused) return null;
    const ev = {
      id: uid('tl'),
      seq: nextSeq(),
      ts: this.now(),
      type,
      label,
      screen: this.s.currentScreen,
      screenshotId: null,
      data: {},
      ...extra,
    };
    this.s.timeline.push(ev);
    cap(this.s.timeline, 5000);
    this.emit('timeline', ev);
    return ev;
  }
  screenshot(variant = {}) {
    const shotId = uid('shot');
    this.s.screenshots.set(shotId, { screen: this.s.currentScreen ?? 'Unknown', ts: this.now(), variant });
    return this.pushTimeline('screenshot', 'Screenshot', { screenshotId: shotId, data: { width: 360, height: 780 } });
  }
  screen(name, variant = {}) {
    if (this.paused) return;
    this.s.currentScreen = name;
    this.pushTimeline('screen', name, { screen: name });
    this.screenshot(variant);
  }
  tap(target, x, y) {
    return this.pushTimeline('tap', `Tap ${target}`, { data: { x, y, target } });
  }
  lifecycle(label) {
    return this.pushTimeline('lifecycle', label);
  }
  custom(label, data = {}) {
    return this.pushTimeline('custom', label, { data });
  }
  mark(label) {
    return this.pushTimeline('mark', label);
  }
  pushLog(level, tag, message, { kind = 'log', throwable = null, attributes = {}, thread = 'main' } = {}) {
    if (this.paused) return null;
    const e = {
      id: uid('log'),
      seq: nextSeq(),
      ts: this.now(),
      level,
      tag,
      message,
      throwable,
      kind,
      attributes,
      thread,
      screen: this.s.currentScreen,
    };
    this.s.logs.push(e);
    cap(this.s.logs, 5000);
    this.emit('log', e);
    return e;
  }
  log(level, tag, message, opts = {}) {
    return this.pushLog(level, tag, message, { ...opts, kind: 'log' });
  }
  logcat(level, tag, message, opts = {}) {
    return this.pushLog(level, tag, message, { thread: null, ...opts, kind: 'logcat' });
  }
  event(name, attributes = {}) {
    return this.pushLog('I', 'Analytics', name, { kind: 'event', attributes, thread: 'analytics-dispatcher' });
  }
  crash({ fatal, exception, message, thread = 'main', stackTrace }) {
    const c = {
      id: uid('crash'),
      seq: nextSeq(),
      ts: this.now(),
      fatal,
      exception,
      message,
      thread,
      screen: this.s.currentScreen,
      sessionId: this.s.id,
      stackTrace,
    };
    this.s.crashes.push(c);
    this.emit('crash', crashSummary(c));
    return c;
  }

  /**
   * spec: { method, url, reqBody?, reqType?, status?, resBody?, resType?, resBinary?, duration?,
   *         error?, pendingForever?, truncated?, fullSize?, protocol?, extraResHeaders? }
   */
  call(spec) {
    if (this.paused) return null;
    const u = new URL(spec.url);
    const method = spec.method ?? 'GET';
    const reqBody =
      spec.reqBody != null ? textBody(spec.reqBody, spec.reqType ?? 'application/json') : null;
    const reqHeaders = baseReqHeaders(
      reqBody ? [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }] : [],
    );
    let rule = null;
    if (this.live) rule = matchMock(method, spec.url);
    const call = {
      id: uid('net'),
      seq: nextSeq(),
      startMs: this.now(),
      durationMs: null,
      method,
      url: spec.url,
      scheme: u.protocol.replace(':', ''),
      host: u.host,
      path: u.pathname + u.search,
      status: null,
      state: 'pending',
      error: null,
      requestSize: reqBody?.size ?? 0,
      responseSize: 0,
      contentType: null,
      mockRuleId: spec.mockRuleId ?? rule?.id ?? null,
      source: spec.source ?? 'okhttp',
      screen: this.s.currentScreen,
      protocol: null,
      responseMessage: null,
      requestHeaders: reqHeaders,
      requestBody: reqBody,
      responseHeaders: [],
      responseBody: null,
    };
    this.s.network.push(call);
    cap(this.s.network, 1000);
    const duration = spec.duration ?? between(60, 900);
    const finish = () => {
      if (rule) applyMock(call, rule, spec);
      else completeCall(call, spec);
      // respond: after delayMs (0 = immediately); delay: delayMs then the real call; fail: after delayMs.
      call.durationMs = !rule ? duration : rule.action === 'delay' ? duration + rule.delayMs : rule.delayMs + 3;
    };
    if (spec.pendingForever) {
      this.emit('network', netSummary(call));
      return call;
    }
    if (!this.live) {
      finish();
      return call;
    }
    this.emit('network', netSummary(call));
    const wait = !rule ? duration : rule.action === 'delay' ? duration + rule.delayMs : rule.delayMs + 3;
    setTimeout(() => {
      if (!this.s.network.includes(call)) return;
      finish();
      this.emit('network', netSummary(call));
    }, wait);
    return call;
  }
}

function completeCall(call, spec) {
  call.protocol = spec.protocol ?? 'h2';
  if (spec.error) {
    call.state = 'failed';
    call.error = spec.error;
    return;
  }
  call.state = 'complete';
  call.status = spec.status ?? 200;
  call.responseMessage = spec.status && spec.status >= 400 ? httpReason(spec.status) : call.protocol === 'h2' ? '' : 'OK';
  if (spec.resBinary) {
    const b64 = spec.resBinary.toString('base64');
    call.responseBody = { text: null, base64: b64, size: spec.resBinary.length, truncated: false, contentType: spec.resType };
    call.contentType = spec.resType;
    call.responseSize = spec.resBinary.length;
  } else if (spec.resBody !== undefined) {
    const type = spec.resType ?? 'application/json';
    let body = textBody(spec.resBody, type);
    if (spec.truncated) {
      body = { ...body, text: body.text.slice(0, 4096), truncated: true, size: spec.fullSize ?? body.size };
    }
    call.responseBody = body;
    call.contentType = type;
    call.responseSize = body.size;
  }
  call.responseHeaders = baseResHeaders(
    call.contentType ? `${call.contentType}${call.contentType.startsWith('image') ? '' : '; charset=utf-8'}` : 'text/plain',
    call.responseSize,
    spec.extraResHeaders ?? [],
  );
}

function applyMock(call, rule, spec) {
  rule.hits++;
  scheduleMocksBroadcast();
  if (rule.action === 'delay') {
    completeCall(call, spec);
    return;
  }
  call.protocol = 'h2';
  if (rule.action === 'fail') {
    call.state = 'failed';
    call.error = {
      timeout: 'java.net.SocketTimeoutException: timeout (Killcam mock)',
      no_network: `java.net.UnknownHostException: Unable to resolve host "${call.host}": No address associated with hostname (Killcam mock)`,
      connection_reset: 'java.net.SocketException: Connection reset (Killcam mock)',
    }[rule.failure];
    return;
  }
  call.state = 'complete';
  call.status = rule.status;
  call.responseMessage = httpReason(rule.status);
  const typeHeader = rule.headers.find((h) => h.name.toLowerCase() === 'content-type');
  const type = typeHeader ? typeHeader.value.split(';')[0].trim() : 'application/json';
  call.contentType = type;
  call.responseBody = textBody(rule.body, type);
  call.responseSize = call.responseBody.size;
  call.responseHeaders = [...rule.headers, { name: 'x-killcam-mock', value: rule.name }];
}

function httpReason(s) {
  return (
    { 200: 'OK', 201: 'Created', 204: 'No Content', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }[s] ?? ''
  );
}

function cap(arr, n) {
  if (arr.length > n) arr.splice(0, arr.length - n);
}

// ------------------------------------------------------------ app script --

const API = 'https://api.swag.gg/v1';
const homeBody = () => ({
  user: { id: USER.id, name: USER.name, vpa: USER.vpa, kycStatus: 'FULL', avatarUrl: `https://cdn.swag.gg/avatars/${USER.id}.webp` },
  balance: { visible: false, bank: 'HDFC Bank', maskedAccount: 'XXXX4821', lastCheckedAt: null },
  quickActions: [
    { id: 'scan', title: 'Scan & Pay', deeplink: 'swagpay://scan' },
    { id: 'contact', title: 'To Contact', deeplink: 'swagpay://contacts' },
    { id: 'bank', title: 'To Bank', deeplink: 'swagpay://bank-transfer' },
    { id: 'self', title: 'Self Transfer', deeplink: 'swagpay://self' },
  ],
  banners: [
    { id: 'bnr_bgmi_uc', title: 'Top up BGMI UC, get 5% back', imageUrl: 'https://cdn.swag.gg/banners/bgmi-uc-5.png', deeplink: 'swagpay://offers/bgmi-uc' },
  ],
  recentPayees: PAYEES.slice(0, 4).map((p) => ({ name: p.name, vpa: p.vpa, merchant: p.merchant })),
  featureFlagsVersion: 118,
  serverTime: new Date().toISOString(),
});
const offersBody = () => ({
  offers: [
    { id: 'off_bgmi5', title: '5% cashback on BGMI UC', minAmount: 29900, maxCashback: 5000, expiresAt: '2026-10-15T23:59:59+05:30', tags: ['gaming', 'krafton'] },
    { id: 'off_first_upi', title: '₹51 on your first UPI payment', minAmount: 10000, maxCashback: 5100, expiresAt: '2026-12-31T23:59:59+05:30', tags: ['new-user'] },
    { id: 'off_scratch', title: 'Scratch card on every payment above ₹200', minAmount: 20000, maxCashback: 10000, expiresAt: null, tags: ['rewards'] },
  ],
  nextCursor: null,
});
const contactsBody = (page) => ({
  page,
  pageSize: 10,
  hasMore: page < 3,
  contacts: CONTACT_NAMES.slice((page - 1) * 7, (page - 1) * 7 + 10).map((name, i) => ({
    name,
    phone: `+91 9${String(800000000 + page * 1000 + i * 37).slice(0, 9)}`,
    vpa: `${name.split(' ')[0].toLowerCase()}${i}@${BANKS[(i + page) % BANKS.length]}`,
    onSwag: (i + page) % 3 !== 0,
  })),
});

async function beatAppStart(sim) {
  sim.lifecycle('Application.onCreate');
  sim.log('I', 'AppCoordinator', 'Cold start: initialising DI graph, Killcam, RN host');
  sim.logcat('I', 'ReactNativeJS', 'Running "SwagPay" with {"rootTag":1,"initialProps":{"env":"stage"}}', { thread: 'mqt_js' });
  sim.call({ method: 'GET', url: `${API}/config?platform=android&v=31400`, resBody: { version: 118, ttlSec: 900, killSwitches: { upiLite: false }, minSupportedVersion: 31000 }, duration: 142 });
  await sim.wait(420);
  sim.lifecycle('MainActivity.onCreate');
  sim.lifecycle('foreground');
  sim.event('app_open', { cold_start: 'true', startup_ms: String(between(780, 1300)), source: 'launcher' });
  sim.logcat('I', 'Choreographer', 'Skipped 41 frames!  The application may be doing too much work on its main thread.');
}

async function beatHome(sim) {
  sim.screen('Home');
  sim.call({ method: 'GET', url: `${API}/home`, resBody: homeBody(), duration: between(120, 420) });
  if (sim.mockOffers) {
    const c = sim.call({ method: 'GET', url: `${API}/offers`, resBody: { offers: [], nextCursor: null }, duration: 4, mockRuleId: 'mock_offers_empty', extraResHeaders: [{ name: 'x-killcam-mock', value: 'Offers: empty list' }] });
    if (c) c.protocol = 'h2';
  } else {
    sim.call({ method: 'GET', url: `${API}/offers`, resBody: offersBody(), duration: between(90, 300) });
  }
  sim.call({ method: 'GET', url: `${API}/notifications/unread-count`, resBody: { unread: between(0, 4) }, duration: between(40, 140) });
  await sim.wait(300);
  sim.call({ method: 'GET', url: 'https://cdn.swag.gg/banners/bgmi-uc-5.png', resBinary: BANNER_PNG, resType: 'image/png', duration: between(40, 160), protocol: 'http/1.1', extraResHeaders: [{ name: 'connection', value: 'keep-alive' }, { name: 'age', value: '3121' }, { name: 'x-cache', value: 'HIT' }] });
  sim.log('D', 'HomeViewModel', 'Rendered 4 quick actions, 1 banner, 4 recent payees');
  sim.event('home_viewed', { banners: '1', recent_payees: '4' });
}

async function beatContacts(sim) {
  sim.tap('QuickAction("To Contact")', 0.38, 0.33);
  await sim.wait(180);
  sim.screen('Contacts');
  sim.call({ method: 'GET', url: `${API}/contacts?page=1`, resBody: contactsBody(1), duration: between(150, 400) });
  await sim.wait(1400);
  sim.pushTimeline('custom', 'Scroll contacts list', { data: { dy: 1840 } });
  sim.call({ method: 'GET', url: `${API}/contacts?page=2`, resBody: contactsBody(2), duration: between(180, 500) });
  sim.logcat('W', 'ContactsRepository', 'Contact sync took 1843ms for 412 contacts (budget 800ms)', { thread: 'DefaultDispatcher-worker-3' });
  await sim.wait(900);
  sim.tap('Back', 0.06, 0.055);
  sim.screen('Home');
}

async function beatScan(sim) {
  sim.tap('QuickAction("Scan & Pay")', 0.14, 0.33);
  await sim.wait(200);
  sim.screen('Scan');
  sim.logcat('D', 'CameraX', 'Use case binding successful: [Preview, ImageAnalysis]', { thread: 'CameraX-core_camera_0' });
  await sim.wait(1600);
  const p = PAYEES[sim.cycle % PAYEES.length];
  sim.log('I', 'PayFlow', `QR decoded: upi://pay?pa=${p.vpa}&pn=${encodeURIComponent(p.name)}&mc=${p.mcc}`);
  sim.event('qr_scanned', { payee_type: p.merchant ? 'merchant' : 'p2p', mcc: p.mcc });
  sim.call({
    method: 'POST',
    url: `${API}/upi/validate-vpa`,
    reqBody: { vpa: p.vpa, payerVpa: USER.vpa },
    resBody: { valid: true, vpa: p.vpa, name: p.name, merchant: p.merchant, mcc: p.mcc, verifiedMerchant: p.merchant, riskScore: 0.04 },
    duration: between(180, 650),
  });
}

async function beatEnterAmount(sim) {
  const p = PAYEES[sim.cycle % PAYEES.length];
  sim.log('D', 'PayFlow', `VPA valid: ${p.vpa} (merchant=${p.merchant})`);
  sim.screen('PayFlow.EnterAmount', { payee: p.name, vpa: p.vpa });
  await sim.wait(900);
  sim.tap('AmountField', 0.5, 0.36);
  await sim.wait(1300);
  sim.event('amount_entered', { amount_paise: String(p.amount), payee_type: p.merchant ? 'merchant' : 'p2p' });
  sim.screenshot({ payee: p.name, vpa: p.vpa, amount: p.amount });
  await sim.wait(700);
  sim.tap('Button("Proceed")', 0.5, 0.915);
}

async function beatPin(sim) {
  const p = PAYEES[sim.cycle % PAYEES.length];
  sim.screen('PayFlow.Pin', { amount: p.amount, payee: p.name });
  sim.event('payment_initiated', { amount_paise: String(p.amount), payee_vpa: p.vpa, method: 'upi', bank: 'HDFC', flow: 'scan' });
  sim.log('I', 'PayFlow', `Collecting UPI PIN via NPCI CL (txnRef pending, amount=${p.amount})`);
  await sim.wait(2600);
  sim.tap('PinPad.Submit', 0.83, 0.935);
}

async function beatPay(sim) {
  const p = PAYEES[sim.cycle % PAYEES.length];
  const ref = txnRef();
  const outcome = sim.forceOutcome ?? (sim.cycle % 4 === 2 ? 402 : sim.cycle % 7 === 5 ? 500 : 200);
  sim.forceOutcome = undefined;
  const req = { payerVpa: USER.vpa, payeeVpa: p.vpa, amount: { value: p.amount, currency: 'INR' }, note: p.note, txnRef: ref, deviceBindingId: DEVICE_ID, credBlock: '<encrypted:' + hexStr(24) + '>' };
  let res;
  if (outcome === 200) res = { txnId: ref, status: 'SUCCESS', rrn: String(between(426800000000, 426899999999)), amount: p.amount, payee: { name: p.name, vpa: p.vpa }, completedAt: new Date().toISOString() };
  else if (outcome === 402) res = { txnId: ref, status: 'FAILED', error: { code: 'U30', message: 'Debit has failed', reason: 'INSUFFICIENT_FUNDS', retryable: false } };
  else res = { txnId: ref, status: 'UNKNOWN', error: { code: 'INTERNAL', message: 'upstream NPCI switch timeout', traceId: hexStr(32) } };
  sim.call({ method: 'POST', url: `${API}/upi/pay`, reqBody: req, status: outcome, resBody: res, duration: between(900, 2400) });
  await sim.wait(1500);
  if (outcome === 200) {
    sim.log('I', 'PayFlow', `Payment SUCCESS txnId=${ref} rrn=${res.rrn}`);
    sim.event('payment_success', { amount_paise: String(p.amount), txn_id: ref, latency_ms: String(between(900, 2400)) });
  } else {
    sim.log('E', 'PayFlow', `Payment ${res.status} txnId=${ref}: ${res.error.code} ${res.error.message}`);
    sim.event('payment_failed', { amount_paise: String(p.amount), txn_id: ref, error_code: res.error.code, http_status: String(outcome) });
  }
  sim.lastTxn = { ref, ok: outcome === 200, p };
}

async function beatTxnDetail(sim) {
  const t = sim.lastTxn ?? { ref: txnRef(), ok: true, p: PAYEES[0] };
  sim.screen('TransactionDetail', { amount: t.p.amount, payee: t.p.name, ok: t.ok, ref: t.ref });
  sim.call({
    method: 'GET',
    url: `${API}/transactions/${t.ref}`,
    resBody: { txnId: t.ref, status: t.ok ? 'SUCCESS' : 'FAILED', amount: { value: t.p.amount, currency: 'INR' }, payer: { vpa: USER.vpa, bank: 'HDFC Bank ••4821' }, payee: { name: t.p.name, vpa: t.p.vpa }, note: t.p.note, createdAt: new Date().toISOString(), timeline: [{ state: 'INITIATED' }, { state: t.ok ? 'DEBITED' : 'DEBIT_FAILED' }, ...(t.ok ? [{ state: 'CREDITED' }] : [])], scratchCard: t.ok && t.p.amount > 20000 ? { id: 'sc_' + hexStr(8), state: 'UNSCRATCHED' } : null },
    duration: between(90, 260),
  });
  await sim.wait(2200);
  sim.tap('Button("Done")', 0.5, 0.9);
  await sim.wait(200);
  sim.screen('Home');
}

async function beatNoise(sim) {
  const n = sim.cycle % 5;
  if (n === 0) sim.logcat('I', 'art', `Background concurrent mark compact GC freed ${between(4, 22)}MB AllocSpace bytes, 38% free, ${between(40, 90)}MB/${between(96, 140)}MB, paused 312us total ${between(40, 180)}.412ms`, { thread: 'HeapTaskDaemon' });
  if (n === 1) sim.logcat('D', 'OkHttp', `<-- 200 ${API}/home (${between(90, 300)}ms, 3.1kB body)`, { thread: 'OkHttp https://api.swag.gg/...' });
  if (n === 2) sim.logcat('I', 'ReactNativeJS', `[Rewards] render ScratchCardList items=${between(0, 5)}`, { thread: 'mqt_js' });
  if (n === 3) sim.log('V', 'Killcam', `Screenshot encoded in ${between(12, 40)}ms (540×1170, 38KB)`, { thread: 'killcam-capture' });
  if (n === 4) sim.call({ method: 'POST', url: 'https://events.swag.gg/v2/batch', reqBody: { events: between(3, 12), sentAt: new Date().toISOString() }, resBody: { accepted: true }, status: 202, duration: between(60, 200), source: 'okhttp' });
}

const LIVE_SCRIPT = [beatHome, beatNoise, beatScan, beatEnterAmount, beatPin, beatPay, beatTxnDetail, beatNoise, beatContacts, beatNoise];

// ------------------------------------------------------------ app state --

const state = {
  live: null,
  saved: [], // newest first
  capturePaused: false,
  wifiEnabled: false,
  down: false,
  mocks: [],
  flags: [],
  prefs: new Map(),
  files: null,
  mmkv: null,
  remoteConfig: null,
  mocksTimer: null,
};

function initialMocks() {
  const now = Date.now();
  return [
    { id: 'mock_offers_empty', name: 'Offers: empty list', enabled: false, method: 'GET', urlPattern: '/v1/offers', matchType: 'contains', action: 'respond', status: 200, headers: [{ name: 'content-type', value: 'application/json' }], body: JSON.stringify({ offers: [], nextCursor: null }, null, 2), delayMs: 0, failure: 'timeout', hits: 3, createdMs: now - 86_400_000 },
    { id: 'mock_pay_u30', name: 'Pay: insufficient funds (U30)', enabled: false, method: 'POST', urlPattern: 'https://api.swag.gg/v1/upi/pay', matchType: 'exact', action: 'respond', status: 402, headers: [{ name: 'content-type', value: 'application/json' }], body: JSON.stringify({ status: 'FAILED', error: { code: 'U30', message: 'Debit has failed', reason: 'INSUFFICIENT_FUNDS', retryable: false } }, null, 2), delayMs: 0, failure: 'timeout', hits: 0, createdMs: now - 7_200_000 },
    { id: 'mock_slow_home', name: 'Slow home (3s)', enabled: false, method: 'GET', urlPattern: 'https://api.swag.gg/v1/home*', matchType: 'glob', action: 'delay', status: 200, headers: [], body: '', delayMs: 3000, failure: 'timeout', hits: 0, createdMs: now - 3_600_000 },
    { id: 'mock_contacts_offline', name: 'Contacts offline', enabled: false, method: null, urlPattern: '/v1/contacts\\?page=\\d+', matchType: 'regex', action: 'fail', status: 200, headers: [], body: '', delayMs: 800, failure: 'no_network', hits: 0, createdMs: now - 1_800_000 },
  ];
}

function initialFlags() {
  const f = (key, type, def, { remote = null, override = null, group = null, description = null, options = null } = {}) => ({ key, type, description, group, defaultValue: def, remoteValue: remote, override, options });
  return [
    f('pay.new_pin_pad', 'boolean', 'false', { remote: 'true', group: 'Payments', description: 'Compose PIN pad instead of the NPCI CL default' }),
    f('pay.upi_lite_enabled', 'boolean', 'false', { group: 'Payments', description: 'UPI Lite wallet for payments under ₹500' }),
    f('pay.max_amount_paise', 'int', '10000000', { remote: '5000000', group: 'Payments', description: 'Per-transaction limit' }),
    f('pay.collect_request_ttl_sec', 'int', '900', { group: 'Payments' }),
    f('pay.retry_backoff', 'double', '1.5', { group: 'Payments', description: 'Multiplier between /pay status polls' }),
    f('home.layout_variant', 'string', 'classic', { remote: 'grid', group: 'Home', options: ['classic', 'grid', 'stories'], description: 'A/B test: home quick-action layout' }),
    f('home.offers_carousel', 'boolean', 'true', { override: 'false', group: 'Home', description: 'Show the offers carousel under the balance card' }),
    f('home.greeting', 'string', 'Hi {name}', { remote: 'Hey {name}, GG!', group: 'Home' }),
    f('rewards.scratch_card_config', 'json', '{"maxPerDay":3,"animation":"confetti","minAmountPaise":20000}', { remote: '{"maxPerDay":5,"animation":"confetti","minAmountPaise":20000}', group: 'Rewards', description: 'Scratch card rules' }),
    f('rewards.cashback_multiplier', 'double', '1.0', { remote: '1.5', group: 'Rewards' }),
    f('rn.bundle_channel', 'string', 'stable', { group: 'Platform', description: 'CodePush-style RN bundle channel' }),
    f('net.http_timeout_ms', 'int', '15000', { group: 'Platform' }),
    f('killcam.screenshot_on_tap', 'boolean', 'true', { group: 'Platform', description: 'Capture a screenshot after every tap' }),
    f('experiment.bgmi_uc_topup', 'boolean', 'false', { remote: 'true', description: 'BGMI UC top-up tile on home' }),
  ].map(withEffective);
}
function withEffective(fl) {
  const value = fl.override ?? fl.remoteValue ?? fl.defaultValue;
  const source = fl.override != null ? 'override' : fl.remoteValue != null ? 'remote' : 'default';
  return { ...fl, value, source };
}

function initialPrefs() {
  const now = Date.now();
  const m = new Map();
  m.set('swag-pay-startup', [
    { key: 'onboarding-complete', type: 'boolean', value: 'true' },
    { key: 'launch-count', type: 'int', value: '42' },
    { key: 'last-launch-ms', type: 'long', value: String(now - 3_600_000) },
    { key: 'app-theme', type: 'string', value: 'dark' },
    { key: 'font-scale', type: 'float', value: '1.0' },
    { key: 'seen-tooltips', type: 'string_set', value: '["scan_qr","split_bill","rewards_tab"]' },
    { key: 'whats-new-version', type: 'int', value: '31300' },
  ]);
  m.set('swag-pay-auth', [
    { key: 'user-id', type: 'string', value: USER.id },
    { key: 'device-binding-id', type: 'string', value: DEVICE_ID },
    { key: 'token-expiry-ms', type: 'long', value: String(now + 45 * 60_000) },
    { key: 'biometric-enabled', type: 'boolean', value: 'true' },
    { key: 'sim-slot', type: 'int', value: '1' },
  ]);
  m.set('com.swag.pay_preferences', [
    { key: 'notifications.payments', type: 'boolean', value: 'true' },
    { key: 'notifications.offers', type: 'boolean', value: 'false' },
    { key: 'language', type: 'string', value: 'en-IN' },
  ]);
  m.set('killcam', [
    { key: 'wifi-sharing', type: 'boolean', value: 'false' },
    { key: 'pin', type: 'string', value: '••••••' },
    { key: 'overrides', type: 'string_set', value: '["home.offers_carousel"]' },
  ]);
  return m;
}

function initialFiles() {
  const now = Date.now();
  const f = (name, size, content = null, ageMin = 30) => ({ name, dir: false, size: content != null ? Buffer.byteLength(content) : size, modifiedMs: now - ageMin * 60_000, content });
  const d = (name, children, ageMin = 60) => ({ name, dir: true, size: 0, modifiedMs: now - ageMin * 60_000, children });
  const remoteConfig = JSON.stringify({ version: 118, flags: Object.fromEntries(initialFlags().map((x) => [x.key, x.remoteValue ?? x.defaultValue])) }, null, 2);
  const appLog = Array.from({ length: 40 }, (_, i) => `2026-09-24 12:${String(i).padStart(2, '0')}:07.412 I/PayFlow: heartbeat ${i}`).join('\n');
  const prefXml = (name) => `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n${(state.prefs.get(name) ?? []).map((e) => `    <${e.type === 'string_set' ? 'set' : e.type} name="${e.key}" value="${e.value}" />`).join('\n')}\n</map>\n`;
  return {
    files: {
      label: 'Internal files',
      path: '/data/user/0/com.swag.pay/files',
      tree: d('', [
        d('killcam', [d('sessions', [f('ses_prev_crash.json', 482113, null, 190)], 190), d('screenshots', [f('shot_0001.jpg', 38211), f('shot_0002.jpg', 41022)])]),
        d('rn-bundles', [f('index.android.bundle', 2_183_402, null, 900), f('manifest.json', 0, JSON.stringify({ channel: 'stable', version: '3.14.0-rn.7', hash: hexStr(40) }, null, 2), 900)], 900),
        d('datastore', [f('settings.preferences_pb', 212)]),
        d('logs', [f('app.log', 0, appLog, 2)], 2),
        f('remote-config.json', 0, remoteConfig, 3),
        f('profileInstalled', 24, null, 2000),
      ]),
    },
    cache: {
      label: 'Cache',
      path: '/data/user/0/com.swag.pay/cache',
      tree: d('', [
        d('image_manager_disk_cache', [f('journal', 0, 'libcore.io.DiskLruCache\n1\n1\n1\n\nCLEAN 3fa1c0b 3810\nCLEAN 9ab22e1 18221\n'), f('3fa1c0b.0', 3810), f('9ab22e1.0', 18221)]),
        d('okhttp', [f('journal', 0, 'libcore.io.DiskLruCache\n201105\n2\n'), f('b1946ac92492d2347c6235b4d2611184.0', 1832)]),
        f('crash-upload.lock', 0, ''),
      ]),
    },
    databases: {
      label: 'Databases',
      path: '/data/user/0/com.swag.pay/databases',
      tree: d('', [f('swag-pay.db', 290_816), f('swag-pay.db-wal', 32_992), f('swag-pay.db-shm', 32_768), f('RKStorage', 20_480)]),
    },
    shared_prefs: {
      label: 'Shared prefs',
      path: '/data/user/0/com.swag.pay/shared_prefs',
      tree: d('', [...state.prefs.keys()].map((n) => f(`${n}.xml`, 0, prefXml(n)))),
    },
    external: {
      label: 'External (app-specific)',
      path: '/storage/emulated/0/Android/data/com.swag.pay/files',
      tree: d('', [d('receipts', [f('SWG260923QK4XK8P2ZM.pdf', 48_211, null, 1500), f('SWG260924B7Q2M9WJ3A.pdf', 51_004, null, 40)])]),
    },
  };
}

// -------------------------------------------------------------------- mmkv --

function mmkvSize(type, value) {
  switch (type) {
    case 'bool':
      return 1;
    case 'float':
      return 4;
    case 'double':
      return 8;
    case 'int':
    case 'long': {
      let n = BigInt(value);
      if (n < 0n) return 10;
      let b = 1;
      while (n >= 128n) {
        n >>= 7n;
        b++;
      }
      return b;
    }
    case 'bytes':
      return Buffer.from(value, 'base64').length + 1;
    default:
      return Buffer.byteLength(value) + 1;
  }
}
const mmkvEntry = (key, type, value) => ({ key, type, value, sizeBytes: mmkvSize(type, value) });

function initialMmkv() {
  const payees = Buffer.from(
    PAYEES.slice(0, 3)
      .map((p) => `\x0a${String.fromCharCode(p.vpa.length)}${p.vpa}`)
      .join(''),
    'latin1',
  ).toString('base64');
  return new Map([
    [
      'mmkv.default',
      {
        encrypted: false,
        error: null,
        entries: [
          mmkvEntry('onboarding.done', 'bool', 'true'),
          mmkvEntry('user.vpa', 'string', USER.vpa),
          mmkvEntry('user.id', 'string', USER.id),
          mmkvEntry('balance.cachedPaise', 'double', '1234500'),
          mmkvEntry('balance.cachedAtMs', 'long', String(Date.now() - 42 * 60_000)),
          mmkvEntry('session.launchCount', 'long', '42'),
          mmkvEntry('recentPayees', 'bytes', payees),
          mmkvEntry('fx.usdInr', 'float', '83.12'),
          mmkvEntry('rn.lastRoute', 'string', 'RewardsHome'),
          mmkvEntry('experiments.assigned', 'string', '{"home_layout":"grid","pin_pad":"compose"}'),
        ],
      },
    ],
    [
      'swag.secure',
      {
        encrypted: true,
        error: null,
        entries: [
          mmkvEntry('auth.refreshToken', 'string', JWT),
          mmkvEntry('device.bindingId', 'string', DEVICE_ID),
          mmkvEntry('pin.failedAttempts', 'long', '0'),
          mmkvEntry('biometric.enabled', 'bool', 'true'),
          mmkvEntry('upi.lite.balancePaise', 'double', '32000'),
        ],
      },
    ],
    [
      'swag.legacy',
      { encrypted: true, error: 'MMKV CRC check failed: the registered cryptKey does not match this file', entries: [] },
    ],
  ]);
}
function mmkvInstance(id, m) {
  return {
    id,
    keyCount: m.error ? 0 : m.entries.length,
    sizeBytes: m.error ? 4096 : 4096 + m.entries.reduce((a, e) => a + e.key.length + e.sizeBytes + 2, 0),
    encrypted: m.encrypted,
    error: m.error,
  };
}
function validateMmkv(type, value) {
  const v = String(value ?? '');
  if (!['string', 'bool', 'int', 'long', 'float', 'double', 'bytes'].includes(type)) return 'bad type';
  if (type === 'bool' && v !== 'true' && v !== 'false') return 'expected true or false';
  if ((type === 'int' || type === 'long') && !/^-?\d+$/.test(v)) return 'expected an integer';
  if (type === 'int' && (Number(v) > 2147483647 || Number(v) < -2147483648)) return 'out of int range';
  if ((type === 'float' || type === 'double') && (v.trim() === '' || Number.isNaN(Number(v)))) return 'expected a number';
  if (type === 'bytes' && !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) return 'expected base64';
  return null;
}

// ------------------------------------------------------------ remote config --

const RC_GROUP = 'Firebase Remote Config';
function initialRemoteConfig() {
  const v = (key, value, source, inAppDefault = value) => ({ key, value, source, inAppDefault });
  return {
    fetchStatus: 'success',
    lastFetchMs: Date.now() - 3 * 60_000,
    minimumFetchIntervalSeconds: 3600,
    fetchTimeoutSeconds: 60,
    fetches: 0,
    values: [
      v('home_banner_enabled', 'true', 'remote', 'false'),
      v('min_supported_version', '31000', 'remote', '30000'),
      v('pay_timeout_ms', '15000', 'default'),
      v('upi_lite_limit_paise', '50000', 'remote', '20000'),
      v('bgmi_uc_promo', '{"enabled":true,"cashbackPct":5,"maxCashbackPaise":5000,"endsAt":"2026-10-15T23:59:59+05:30","skus":["uc_60","uc_325","uc_660"]}', 'remote', '{"enabled":false}'),
      v('support_chat_url', 'https://support.swag.gg/chat', 'default'),
      v('force_update_message', '', 'static', ''),
      v('rewards_scratch_daily_cap', '3', 'remote', '2'),
      v('onboarding_variant', 'b', 'remote', 'a'),
      v('maintenance_mode', 'false', 'default'),
    ],
  };
}
function inferFlagType(v) {
  if (v === 'true' || v === 'false') return 'boolean';
  if (/^-?\d+$/.test(v)) return 'int';
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return 'double';
  if (/^\s*[[{]/.test(v)) {
    try {
      JSON.parse(v);
      return 'json';
    } catch {}
  }
  return 'string';
}
/** Mirror every RC key into Flags (group "Firebase Remote Config"), keeping existing overrides. */
function syncRcFlags() {
  const rc = state.remoteConfig;
  const others = state.flags.filter((f) => f.group !== RC_GROUP);
  const prev = new Map(state.flags.filter((f) => f.group === RC_GROUP).map((f) => [f.key, f]));
  const mirrored = rc.values.map((x) =>
    withEffective({
      key: x.key,
      type: inferFlagType(x.inAppDefault !== '' ? x.inAppDefault : x.value),
      description: `Firebase Remote Config (${x.source})`,
      group: RC_GROUP,
      defaultValue: x.inAppDefault,
      remoteValue: x.source === 'remote' ? x.value : null,
      override: prev.get(x.key)?.override ?? null,
      options: null,
    }),
  );
  state.flags = [...others, ...mirrored];
}
function remoteConfigInfo() {
  const rc = state.remoteConfig;
  const overrides = new Map(state.flags.filter((f) => f.group === RC_GROUP).map((f) => [f.key, f.override]));
  return {
    fetchStatus: rc.fetchStatus,
    lastFetchMs: rc.lastFetchMs,
    minimumFetchIntervalSeconds: rc.minimumFetchIntervalSeconds,
    fetchTimeoutSeconds: rc.fetchTimeoutSeconds,
    values: rc.values.map((x) => ({ key: x.key, value: x.value, source: x.source, flagOverride: overrides.get(x.key) ?? null })),
  };
}

// --------------------------------------------------------------- databases --

const DB_TXN_STATUSES = ['SUCCESS', 'SUCCESS', 'SUCCESS', 'FAILED', 'PENDING'];
function genTransactions(n) {
  const r = mulberry32(42);
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const p = PAYEES[Math.floor(r() * PAYEES.length)];
    return [
      n - i,
      'SWG2609' + String(10 + Math.floor(r() * 20)) + Math.floor(r() * 1e8).toString(36).toUpperCase().padStart(6, '0'),
      p.vpa,
      p.name,
      Math.round(r() * 200000) + 100,
      DB_TXN_STATUSES[Math.floor(r() * DB_TXN_STATUSES.length)],
      r() > 0.5 ? p.note : null,
      now - i * 3_600_000 - Math.floor(r() * 3_000_000),
    ];
  });
}
const DBS = [
  {
    name: 'swag-pay.db',
    path: '/data/user/0/com.swag.pay/databases/swag-pay.db',
    sizeBytes: 290_816,
    tables: {
      transactions: { type: 'table', columns: ['id', 'txn_id', 'payee_vpa', 'payee_name', 'amount_paise', 'status', 'note', 'created_at'], rows: genTransactions(137) },
      contacts: {
        type: 'table',
        columns: ['id', 'name', 'phone', 'vpa', 'on_swag', 'last_paid_at'],
        rows: CONTACT_NAMES.map((n, i) => [i + 1, n, `+91 98${String(40000000 + i * 7919).slice(0, 8)}`, `${n.split(' ')[0].toLowerCase()}@${BANKS[i % BANKS.length]}`, i % 3 === 0 ? 0 : 1, i % 4 === 0 ? null : Date.now() - i * 86_400_000]),
      },
      offers: {
        type: 'table',
        columns: ['id', 'title', 'min_amount', 'max_cashback', 'expires_at'],
        rows: offersBody().offers.map((o) => [o.id, o.title, o.minAmount, o.maxCashback, o.expiresAt]),
      },
      room_master_table: { type: 'table', columns: ['id', 'identity_hash'], rows: [[42, 'a3c1f00e9b2d4c1e8f6a7b5c4d3e2f10']] },
      android_metadata: { type: 'table', columns: ['locale'], rows: [['en_IN']] },
      recent_transactions: { type: 'view', columns: ['txn_id', 'payee_name', 'amount_paise', 'status'], rows: null },
    },
  },
  {
    name: 'RKStorage',
    path: '/data/user/0/com.swag.pay/databases/RKStorage',
    sizeBytes: 20_480,
    tables: {
      catalystLocalStorage: {
        type: 'table',
        columns: ['key', 'value'],
        rows: [
          ['persist:root', JSON.stringify({ auth: '{"loggedIn":true}', rewards: '{"lastSeen":"2026-09-24"}', _persist: '{"version":3,"rehydrated":true}' })],
          ['@rn/lastRoute', '"RewardsHome"'],
          ['@rewards/scratchCardsSeen', '["sc_1a2b","sc_9f8e"]'],
          ['@i18n/locale', '"en-IN"'],
          ['@codepush/currentPackage', '{"label":"v7","appVersion":"3.14.0"}'],
          ['@analytics/queue', '[]'],
          ['@offers/dismissed', '["off_first_upi"]'],
        ],
      },
    },
  },
];
DBS[0].tables.recent_transactions.rows = DBS[0].tables.transactions.rows.slice(0, 20).map((r) => [r[1], r[3], r[4], r[5]]);

function dbInfo(db) {
  return {
    name: db.name,
    path: db.path,
    sizeBytes: db.sizeBytes,
    tables: Object.entries(db.tables).map(([name, t]) => ({ name, type: t.type, rowCount: t.type === 'view' ? null : t.rows.length })),
  };
}

function runSql(db, sql) {
  const t0 = performance.now();
  const done = (partial) => ({ columns: [], rows: [], totalRows: null, affectedRows: null, truncated: false, error: null, ...partial, elapsedMs: Math.max(1, Math.round(performance.now() - t0 + between(1, 6))) });
  const q = sql.trim().replace(/;+\s*$/, '');
  if (!q) return done({ error: 'empty statement' });
  const pragma = /^pragma\s+table_info\s*\(\s*['"`]?(\w+)['"`]?\s*\)$/i.exec(q);
  if (pragma) {
    const t = db.tables[pragma[1]];
    if (!t) return done({});
    return done({ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], rows: t.columns.map((c, i) => [i, c, typeof t.rows?.[0]?.[i] === 'number' ? 'INTEGER' : 'TEXT', i === 0 ? 1 : 0, null, i === 0 ? 1 : 0]) });
  }
  const m = /^select\s+(.+?)\s+from\s+['"`]?(\w+)['"`]?(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(\w+)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+)(?:\s+offset\s+(\d+))?)?$/is.exec(q);
  if (m) {
    const [, colsRaw, tableName, where, orderBy, dir, limit, offset] = m;
    if (tableName === 'sqlite_master') {
      return done({ columns: ['type', 'name', 'tbl_name'], rows: Object.entries(db.tables).map(([n, t]) => [t.type, n, n]) });
    }
    const t = db.tables[tableName];
    if (!t) return done({ error: `no such table: ${tableName}` });
    let rows = t.rows.slice();
    if (where) {
      const w = /^(\w+)\s*(=|!=|<>|>|<|>=|<=|like)\s*(?:'([^']*)'|(-?\d+(?:\.\d+)?))$/i.exec(where.trim());
      if (!w) return done({ error: `near "${where.trim().split(/\s+/)[0]}": the mock only understands WHERE <col> <op> <literal>` });
      const ci = t.columns.indexOf(w[1]);
      if (ci < 0) return done({ error: `no such column: ${w[1]}` });
      const lit = w[3] ?? Number(w[4]);
      const op = w[2].toLowerCase();
      rows = rows.filter((r) => {
        const v = r[ci];
        if (op === '=') return v == lit;
        if (op === '!=' || op === '<>') return v != lit;
        if (op === '>') return v > lit;
        if (op === '<') return v < lit;
        if (op === '>=') return v >= lit;
        if (op === '<=') return v <= lit;
        const re = new RegExp('^' + String(lit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
        return re.test(String(v ?? ''));
      });
    }
    if (/^count\s*\(\s*\*\s*\)$/i.test(colsRaw.trim())) return done({ columns: ['COUNT(*)'], rows: [[rows.length]] });
    let idx;
    let columns;
    if (colsRaw.trim() === '*') {
      columns = t.columns;
      idx = columns.map((_, i) => i);
    } else {
      columns = colsRaw.split(',').map((c) => c.trim());
      idx = columns.map((c) => t.columns.indexOf(c));
      const bad = columns.find((_, i) => idx[i] < 0);
      if (bad) return done({ error: `no such column: ${bad}` });
    }
    if (orderBy) {
      const oi = t.columns.indexOf(orderBy);
      if (oi < 0) return done({ error: `no such column: ${orderBy}` });
      rows.sort((a, b) => cmp(a[oi], b[oi]) * (dir?.toLowerCase() === 'desc' ? -1 : 1));
    }
    const off = Number(offset ?? 0);
    const lim = Math.min(Number(limit ?? 500), 500);
    const truncated = !limit && rows.length > 500;
    return done({ columns, rows: rows.slice(off, off + lim).map((r) => idx.map((i) => r[i])), truncated });
  }
  const dml = /^(insert\s+into|update|delete\s+from)\s+['"`]?(\w+)/i.exec(q);
  if (dml) {
    if (!db.tables[dml[2]]) return done({ error: `no such table: ${dml[2]}` });
    return done({ affectedRows: /^insert/i.test(dml[1]) ? 1 : between(0, 3) });
  }
  const first = q.split(/\s+/)[0];
  return done({ error: `near "${first}": syntax error` });
}
function cmp(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}

// ------------------------------------------------------------ bootstrap --

const STACK_VPA = `java.lang.IllegalStateException: VPA handle missing for payee in PIN step (txnRef=SWG260924QK4XK8P2ZM)
\tat com.swag.pay.pay.PayFlowViewModel.requirePayeeHandle(PayFlowViewModel.kt:212)
\tat com.swag.pay.pay.PayFlowViewModel.onPinSubmitted(PayFlowViewModel.kt:168)
\tat com.swag.pay.pay.ui.PinScreenKt$PinScreen$3$1.invoke(PinScreen.kt:94)
\tat com.swag.pay.pay.ui.PinScreenKt$PinScreen$3$1.invoke(PinScreen.kt:92)
\tat com.swag.pay.designsystem.PinPadKt$PinPad$1$2$1.invoke(PinPad.kt:141)
\tat androidx.compose.foundation.ClickablePointerInputNode$pointerInput$3.invoke-k-4lQ0M(Clickable.kt:1015)
\tat androidx.compose.foundation.gestures.TapGestureDetectorKt$detectTapAndPress$2$1.invokeSuspend(TapGestureDetector.kt:255)
\tat kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:33)
\tat kotlinx.coroutines.DispatchedTask.run(DispatchedTask.kt:104)
\tat androidx.compose.ui.platform.AndroidUiDispatcher.performTrampolineDispatch(AndroidUiDispatcher.android.kt:81)
\tat androidx.compose.ui.platform.AndroidUiDispatcher.access$performTrampolineDispatch(AndroidUiDispatcher.android.kt:41)
\tat androidx.compose.ui.platform.AndroidUiDispatcher$dispatchCallback$1.run(AndroidUiDispatcher.android.kt:57)
\tat android.os.Handler.handleCallback(Handler.java:959)
\tat android.os.Handler.dispatchMessage(Handler.java:100)
\tat android.os.Looper.loopOnce(Looper.java:232)
\tat android.os.Looper.loop(Looper.java:317)
\tat android.app.ActivityThread.main(ActivityThread.java:8699)
\tat java.lang.reflect.Method.invoke(Native Method)
\tat com.android.internal.os.RuntimeInit$MethodAndArgsCaller.run(RuntimeInit.java:580)
\tat com.android.internal.os.ZygoteInit.main(ZygoteInit.java:886)
Caused by: java.lang.NullPointerException: payee.vpa must not be null
\tat com.swag.pay.pay.data.PayeeMapper.toDomain(PayeeMapper.kt:37)
\tat com.swag.pay.pay.PayFlowViewModel.requirePayeeHandle(PayFlowViewModel.kt:209)
\t... 19 more`;

const STACK_TIMEOUT = `java.net.SocketTimeoutException: timeout
\tat okhttp3.internal.http2.Http2Stream$StreamTimeout.newTimeoutException(Http2Stream.kt:675)
\tat okhttp3.internal.http2.Http2Stream$StreamTimeout.exitAndThrowIfTimedOut(Http2Stream.kt:684)
\tat okhttp3.internal.http2.Http2Stream.takeHeaders(Http2Stream.kt:143)
\tat okhttp3.internal.http2.Http2ExchangeCodec.readResponseHeaders(Http2ExchangeCodec.kt:97)
\tat okhttp3.internal.connection.Exchange.readResponseHeaders(Exchange.kt:110)
\tat okhttp3.internal.http.CallServerInterceptor.intercept(CallServerInterceptor.kt:93)
\tat okhttp3.internal.http.RealInterceptorChain.proceed(RealInterceptorChain.kt:109)
\tat com.krafton.killcam.okhttp.KillcamInterceptor.intercept(KillcamInterceptor.kt:58)
\tat okhttp3.internal.http.RealInterceptorChain.proceed(RealInterceptorChain.kt:109)
\tat com.swag.pay.network.AuthInterceptor.intercept(AuthInterceptor.kt:41)
\tat okhttp3.internal.connection.RealCall.getResponseWithInterceptorChain$okhttp(RealCall.kt:201)
\tat okhttp3.internal.connection.RealCall.execute(RealCall.kt:154)
\tat retrofit2.OkHttpCall.execute(OkHttpCall.java:209)
\tat com.swag.pay.contacts.ContactsRepository.syncPage(ContactsRepository.kt:88)
\tat com.swag.pay.contacts.ContactsRepository$sync$2.invokeSuspend(ContactsRepository.kt:61)
\tat kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:33)
\tat kotlinx.coroutines.DispatchedTask.run(DispatchedTask.kt:104)
\tat kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.run(CoroutineScheduler.kt:820)`;

const STACK_TEST = (id) => `java.lang.RuntimeException: Killcam test crash (${id})
\tat com.krafton.killcam.actions.BuiltInActions$testCrash$1.invoke(BuiltInActions.kt:77)
\tat com.krafton.killcam.actions.ActionRegistry.run(ActionRegistry.kt:34)
\tat com.krafton.killcam.server.routes.ActionsRoutesKt$actionsRoutes$2.invokeSuspend(ActionsRoutes.kt:29)
\tat kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:33)
\tat android.os.Handler.handleCallback(Handler.java:959)
\tat android.os.Handler.dispatchMessage(Handler.java:100)
\tat android.os.Looper.loopOnce(Looper.java:232)
\tat android.os.Looper.loop(Looper.java:317)
\tat android.app.ActivityThread.main(ActivityThread.java:8699)`;

async function buildPreviousCrashSession() {
  const start = Date.now() - 3 * 3_600_000 - 17 * 60_000;
  const s = newSession(start, { live: false, reason: 'crash' });
  const sim = new Sim(s, { live: false, t: start });
  await beatAppStart(sim);
  await sim.wait(1500);
  await beatHome(sim);
  await sim.wait(4200);
  sim.cycle = 1;
  await beatScan(sim);
  await sim.wait(1200);
  await beatEnterAmount(sim);
  await sim.wait(900);
  sim.cycle = 2;
  await beatContacts(sim);
  await sim.wait(3000);
  sim.cycle = 0;
  await beatScan(sim);
  await sim.wait(1100);
  await beatEnterAmount(sim);
  await sim.wait(800);
  sim.screen('PayFlow.Pin', { amount: PAYEES[0].amount, payee: PAYEES[0].name });
  sim.event('payment_initiated', { amount_paise: String(PAYEES[0].amount), payee_vpa: '', method: 'upi', bank: 'HDFC', flow: 'scan' });
  sim.log('W', 'PayFlow', 'Payee handle empty after process restore; continuing with cached PayeeState');
  sim.mark('Rahul: pressed back then forward on amount screen');
  await sim.wait(2400);
  sim.tap('PinPad.Submit', 0.83, 0.935);
  await sim.wait(90);
  sim.logcat('E', 'AndroidRuntime', 'FATAL EXCEPTION: main\nProcess: com.swag.pay, PID: 18421', { throwable: STACK_VPA, thread: 'main' });
  sim.crash({ fatal: true, exception: 'java.lang.IllegalStateException', message: 'VPA handle missing for payee in PIN step (txnRef=SWG260924QK4XK8P2ZM)', stackTrace: STACK_VPA });
  s.endMs = sim.t;
  return s;
}

async function buildManualSession() {
  const start = Date.now() - 26 * 3_600_000;
  const s = newSession(start, { live: false, reason: 'manual', label: 'Offers carousel overlaps balance card' });
  const sim = new Sim(s, { live: false, t: start });
  await beatAppStart(sim);
  await sim.wait(1200);
  await beatHome(sim);
  await sim.wait(2500);
  sim.tap('OffersCarousel', 0.5, 0.52);
  sim.mark('Carousel covers the balance card on font scale 1.3');
  await sim.wait(1800);
  sim.screenshot({});
  await sim.wait(3000);
  s.endMs = sim.t;
  return s;
}

async function buildLiveSession(startMs, { withHistory }) {
  const s = newSession(startMs);
  const sim = new Sim(s, { live: false, t: startMs });
  await beatAppStart(sim);
  await sim.wait(1100);
  if (withHistory) {
    const flow = [beatHome, beatNoise, beatContacts, beatScan, beatEnterAmount, beatPin, beatPay, beatTxnDetail, beatNoise];
    const cycles = [0, 2, 5]; // pay outcomes: 200, 402, 500
    for (let k = 0; k < cycles.length; k++) {
      for (let i = 0; i < flow.length; i++) {
        sim.cycle = cycles[k];
        sim.mockOffers = k === 1 && i === 0;
        await flow[i](sim);
        sim.mockOffers = false;
        await sim.wait(between(1500, 5000));
        if (k === 0 && i === 2) {
          // Non-fatal from the contact sync in this session.
          sim.call({ method: 'GET', url: `${API}/contacts?page=3`, error: 'java.net.SocketTimeoutException: timeout', duration: 15000 });
          sim.log('E', 'ContactsRepository', 'Contact sync page 3 failed, will retry in 30s', { throwable: STACK_TIMEOUT, thread: 'DefaultDispatcher-worker-3' });
          sim.crash({ fatal: false, exception: 'java.net.SocketTimeoutException', message: 'timeout', thread: 'DefaultDispatcher-worker-3', stackTrace: STACK_TIMEOUT });
        }
        if (k === 0 && i === 4) {
          sim.call({ method: 'GET', url: 'https://cdn.swag.gg/rn/manifest.json?channel=stable', error: 'java.net.UnknownHostException: Unable to resolve host "cdn.swag.gg": No address associated with hostname', duration: 38 });
          sim.logcat('W', 'ReactNativeJS', 'Bundle manifest fetch failed, using embedded bundle', { thread: 'mqt_js' });
        }
        if (k === 1 && i === 8) {
          sim.call({ method: 'GET', url: `${API}/transactions?limit=200&cursor=`, resBody: { items: genTransactions(200).map((r) => ({ id: r[0], txnId: r[1], payeeVpa: r[2], payeeName: r[3], amountPaise: r[4], status: r[5], note: r[6], createdAt: r[7] })) }, truncated: true, fullSize: 262_144, duration: 740 });
          sim.mark('Pay button stayed disabled for ~2s');
        }
      }
    }
  } else {
    await beatHome(sim);
  }
  // A long-poll that is still in flight.
  sim.call({ method: 'GET', url: `${API}/rewards/scratch-cards/stream?since=${sim.t - 60000}`, pendingForever: true });
  shiftSession(s, Date.now() - 1500 - sim.t);
  return s;
}

/** Moves every timestamp of a simulated session so its history ends "now". */
function shiftSession(s, delta) {
  s.startMs += delta;
  s.app.sessionStartMs = s.startMs;
  for (const c of s.network) c.startMs += delta;
  for (const l of s.logs) l.ts += delta;
  for (const c of s.crashes) c.ts += delta;
  for (const t of s.timeline) t.ts += delta;
  for (const m of s.screenshots.values()) m.ts += delta;
}

// ---------------------------------------------------------------- live loop --

let liveSim = null;
async function startLiveLoop() {
  const mySession = state.live;
  liveSim = new Sim(mySession, { live: true });
  let i = 0;
  while (state.live === mySession) {
    await sleep(between(2000, 4000));
    if (state.live !== mySession || state.down) break;
    liveSim.cycle = Math.floor(i / LIVE_SCRIPT.length);
    try {
      await LIVE_SCRIPT[i % LIVE_SCRIPT.length](liveSim);
    } catch (e) {
      console.error('live beat failed', e);
    }
    i++;
  }
}

// -------------------------------------------------------------------- mocks --

function globToRegex(glob) {
  let re = '';
  for (const ch of glob) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
function urlMatches(rule, url) {
  try {
    switch (rule.matchType) {
      case 'exact':
        return url === rule.urlPattern;
      case 'contains':
        return url.includes(rule.urlPattern);
      case 'glob':
        return globToRegex(rule.urlPattern).test(url);
      case 'regex':
        return new RegExp(rule.urlPattern).test(url);
    }
  } catch {
    return false;
  }
  return false;
}
function matchMock(method, url) {
  return state.mocks.find((r) => r.enabled && (r.method == null || r.method === method) && urlMatches(r, url)) ?? null;
}
function scheduleMocksBroadcast() {
  clearTimeout(state.mocksTimer);
  state.mocksTimer = setTimeout(() => broadcast('mocks', state.mocks), 150);
}
function validateMockInput(b) {
  if (!b || typeof b !== 'object') return 'body must be a MockRuleInput';
  if (typeof b.urlPattern !== 'string' || !b.urlPattern.trim()) return 'urlPattern is required';
  if (!['contains', 'exact', 'glob', 'regex'].includes(b.matchType)) return 'bad matchType';
  if (!['respond', 'delay', 'fail'].includes(b.action)) return 'bad action';
  if (b.matchType === 'regex') {
    try {
      new RegExp(b.urlPattern);
    } catch (e) {
      return 'invalid regex: ' + e.message;
    }
  }
  return null;
}
function mockFromInput(b, base) {
  return {
    id: base?.id ?? uid('mock'),
    name: String(b.name ?? '').trim() || `${b.method ?? 'ANY'} ${b.urlPattern}`,
    enabled: b.enabled !== false,
    method: b.method || null,
    urlPattern: b.urlPattern,
    matchType: b.matchType,
    action: b.action,
    status: Number(b.status) || 200,
    headers: Array.isArray(b.headers) ? b.headers.filter((h) => h && h.name).map((h) => ({ name: String(h.name), value: String(h.value ?? '') })) : [],
    body: String(b.body ?? ''),
    delayMs: Number(b.delayMs) || 0,
    failure: ['timeout', 'no_network', 'connection_reset'].includes(b.failure) ? b.failure : 'timeout',
    hits: base?.hits ?? 0,
    createdMs: base?.createdMs ?? Date.now(),
  };
}

// ---------------------------------------------------------------------- SSE --

const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}
setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 15_000).unref();

// ---------------------------------------------------------------- exports --

function toHar(calls) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Killcam', version: KILLCAM_VERSION },
      entries: calls
        .filter((c) => c.state !== 'pending')
        .map((c) => {
          let qs = [];
          try {
            qs = [...new URL(c.url).searchParams].map(([name, value]) => ({ name, value }));
          } catch {}
          return {
            startedDateTime: new Date(c.startMs).toISOString(),
            time: c.durationMs ?? 0,
            request: {
              method: c.method,
              url: c.url,
              httpVersion: c.protocol ?? 'HTTP/1.1',
              cookies: [],
              headers: c.requestHeaders,
              queryString: qs,
              ...(c.requestBody ? { postData: { mimeType: c.requestBody.contentType ?? 'application/octet-stream', text: c.requestBody.text ?? '' } } : {}),
              headersSize: -1,
              bodySize: c.requestSize,
            },
            response: {
              status: c.status ?? 0,
              statusText: c.responseMessage ?? '',
              httpVersion: c.protocol ?? 'HTTP/1.1',
              cookies: [],
              headers: c.responseHeaders,
              content: {
                size: c.responseSize,
                mimeType: c.contentType ?? 'x-unknown',
                ...(c.responseBody?.text != null ? { text: c.responseBody.text } : {}),
                ...(c.responseBody?.base64 != null ? { text: c.responseBody.base64, encoding: 'base64' } : {}),
              },
              redirectURL: '',
              headersSize: -1,
              bodySize: c.responseSize,
              ...(c.error ? { _error: c.error } : {}),
            },
            cache: {},
            timings: { send: 0, wait: c.durationMs ?? 0, receive: 0 },
            _killcam: { id: c.id, screen: c.screen, mockRuleId: c.mockRuleId },
          };
        }),
    },
  };
}

function toCurl(c) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -X ${c.method} ${q(c.url)}`];
  for (const h of c.requestHeaders) {
    if (/^(accept-encoding|content-length|host)$/i.test(h.name)) continue;
    parts.push(`-H ${q(`${h.name}: ${h.value}`)}`);
  }
  if (c.requestBody?.text) parts.push(`--data-raw ${q(c.requestBody.text)}`);
  return parts.join(' \\\n  ');
}

// ------------------------------------------------------------- screenshots --

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function rupees(paise) {
  return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function screenshotSvg(meta) {
  const W = 360;
  const H = 780;
  const v = meta.variant ?? {};
  const time = new Date(meta.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const font = `font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"`;
  let bg = '#121318';
  let body = '';
  const title = (t, sub) => `<text x="56" y="84" fill="#F4F4F6" font-size="18" font-weight="600" ${font}>${esc(t)}</text>${sub ? `<text x="56" y="104" fill="#8A8D98" font-size="12" ${font}>${esc(sub)}</text>` : ''}<path d="M22 78 l8 -8 M22 78 l8 8" stroke="#F4F4F6" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  const button = (y, label, color = '#F2A900', fg = '#111') => `<rect x="20" y="${y}" width="320" height="50" rx="14" fill="${color}"/><text x="180" y="${y + 31}" text-anchor="middle" fill="${fg}" font-size="15" font-weight="700" ${font}>${esc(label)}</text>`;
  switch (meta.screen) {
    case 'Home': {
      body += `<text x="20" y="84" fill="#F4F4F6" font-size="20" font-weight="700" ${font}>Hey Rahul, GG!</text><circle cx="326" cy="78" r="16" fill="#2A2C35"/><text x="326" y="83" text-anchor="middle" fill="#F2A900" font-size="12" font-weight="700" ${font}>RS</text>`;
      body += `<rect x="20" y="108" width="320" height="110" rx="18" fill="url(#g1)"/><text x="38" y="140" fill="#111" font-size="12" font-weight="600" ${font}>HDFC Bank ••4821</text><text x="38" y="178" fill="#111" font-size="24" font-weight="800" ${font}>Check balance</text><text x="38" y="202" fill="#3a2a00" font-size="12" ${font}>rahul@swag</text>`;
      const qa = ['Scan & Pay', 'To Contact', 'To Bank', 'Self'];
      qa.forEach((l, i) => {
        const cx = 50 + i * 87;
        body += `<circle cx="${cx}" cy="258" r="24" fill="#23252E" stroke="#34374A"/><rect x="${cx - 9}" y="249" width="18" height="18" rx="4" fill="none" stroke="#F2A900" stroke-width="2"/><text x="${cx}" y="302" text-anchor="middle" fill="#C9CBD3" font-size="11" ${font}>${esc(l)}</text>`;
      });
      body += `<rect x="20" y="330" width="320" height="96" rx="16" fill="#1D1F27" stroke="#2C2F3B"/><rect x="236" y="342" width="92" height="72" rx="10" fill="#F2A900" opacity="0.85"/><text x="36" y="366" fill="#F4F4F6" font-size="14" font-weight="700" ${font}>Top up BGMI UC</text><text x="36" y="388" fill="#8A8D98" font-size="12" ${font}>Get 5% back, up to ₹50</text>`;
      body += `<text x="20" y="462" fill="#8A8D98" font-size="12" font-weight="600" ${font}>RECENT</text>`;
      PAYEES.slice(0, 4).forEach((p, i) => {
        const y = 480 + i * 62;
        body += `<circle cx="42" cy="${y + 22}" r="20" fill="#2A2C35"/><text x="42" y="${y + 27}" text-anchor="middle" fill="#F4F4F6" font-size="13" font-weight="600" ${font}>${esc(p.name[0])}</text><text x="74" y="${y + 18}" fill="#F4F4F6" font-size="14" ${font}>${esc(p.name)}</text><text x="74" y="${y + 36}" fill="#8A8D98" font-size="11" ${font}>${esc(p.vpa)}</text>`;
      });
      break;
    }
    case 'Scan':
      bg = '#050506';
      body += `<rect x="0" y="40" width="360" height="740" fill="url(#cam)"/>${title('Scan any UPI QR')}`;
      body += `<rect x="70" y="220" width="220" height="220" rx="18" fill="none" stroke="#ffffff22"/>`;
      body += [[70, 220, 1, 1], [290, 220, -1, 1], [70, 440, 1, -1], [290, 440, -1, -1]].map(([x, y, dx, dy]) => `<path d="M${x} ${y + dy * 36} V${y} H${x + dx * 36}" stroke="#F2A900" stroke-width="5" fill="none" stroke-linecap="round"/>`).join('');
      body += `<rect x="86" y="${320}" width="188" height="3" fill="#FF3B3B" opacity="0.8"/>`;
      body += `<text x="180" y="490" text-anchor="middle" fill="#C9CBD3" font-size="13" ${font}>Align the QR code within the frame</text>`;
      body += `<rect x="112" y="660" width="136" height="44" rx="22" fill="#1D1F27"/><text x="180" y="687" text-anchor="middle" fill="#F4F4F6" font-size="13" ${font}>Upload from gallery</text>`;
      break;
    case 'Contacts':
      body += title('Pay contacts', '412 contacts · 287 on Swag Pay');
      body += `<rect x="20" y="124" width="320" height="42" rx="12" fill="#1D1F27"/><text x="38" y="150" fill="#6B6E7A" font-size="13" ${font}>Search name, number or UPI ID</text>`;
      CONTACT_NAMES.slice(0, 9).forEach((n, i) => {
        const y = 186 + i * 62;
        body += `<circle cx="42" cy="${y + 22}" r="20" fill="#2A2C35"/><text x="42" y="${y + 27}" text-anchor="middle" fill="#F4F4F6" font-size="13" ${font}>${esc(n[0])}</text><text x="74" y="${y + 18}" fill="#F4F4F6" font-size="14" ${font}>${esc(n)}</text><text x="74" y="${y + 36}" fill="#8A8D98" font-size="11" ${font}>${esc(n.split(' ')[0].toLowerCase())}@${BANKS[i % BANKS.length]}</text>`;
      });
      break;
    case 'PayFlow.EnterAmount':
      body += title('Paying ' + (v.payee ?? 'RAMESH KUMAR'), v.vpa ?? 'chaiwala.ramesh@ybl');
      body += `<circle cx="180" cy="190" r="38" fill="#2A2C35"/><text x="180" y="199" text-anchor="middle" fill="#F2A900" font-size="26" font-weight="700" ${font}>${esc((v.payee ?? 'R')[0])}</text>`;
      body += `<text x="180" y="300" text-anchor="middle" fill="${v.amount ? '#F4F4F6' : '#4A4D59'}" font-size="54" font-weight="700" ${font}>${v.amount ? esc(rupees(v.amount)) : '₹0'}</text>`;
      body += `<rect x="90" y="330" width="180" height="36" rx="18" fill="#1D1F27"/><text x="180" y="353" text-anchor="middle" fill="#8A8D98" font-size="12" ${font}>Add a note</text>`;
      body += `<text x="180" y="640" text-anchor="middle" fill="#8A8D98" font-size="12" ${font}>From HDFC Bank ••4821</text>`;
      body += button(690, 'Proceed', v.amount ? '#F2A900' : '#3A3620', v.amount ? '#111' : '#7d7550');
      break;
    case 'PayFlow.Pin': {
      bg = '#0B0C10';
      body += title('Enter 6-digit UPI PIN', `${v.payee ?? 'RAMESH KUMAR'} · ${v.amount ? rupees(v.amount) : '₹45'}`);
      for (let i = 0; i < 6; i++) body += `<circle cx="${95 + i * 34}" cy="210" r="8" fill="${i < 4 ? '#F2A900' : 'none'}" stroke="#F2A900" stroke-width="2"/>`;
      body += `<text x="180" y="260" text-anchor="middle" fill="#6B6E7A" font-size="11" ${font}>HDFC Bank ••4821 · secured by NPCI</text>`;
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
      keys.forEach((k, i) => {
        const x = 60 + (i % 3) * 120;
        const y = 480 + Math.floor(i / 3) * 70;
        body += `<text x="${x}" y="${y}" text-anchor="middle" fill="${k === '✓' ? '#F2A900' : '#F4F4F6'}" font-size="26" ${font}>${k}</text>`;
      });
      break;
    }
    case 'TransactionDetail': {
      const ok = v.ok !== false;
      body += title('Transaction', v.ref ?? '');
      body += `<circle cx="180" cy="210" r="46" fill="${ok ? '#1F9D55' : '#FF3B3B'}"/>`;
      body += ok ? `<path d="M158 210 l15 15 l29 -31" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M162 192 l36 36 M198 192 l-36 36" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`;
      body += `<text x="180" y="310" text-anchor="middle" fill="#F4F4F6" font-size="34" font-weight="700" ${font}>${esc(rupees(v.amount ?? 4500))}</text>`;
      body += `<text x="180" y="340" text-anchor="middle" fill="${ok ? '#4ADE80' : '#FF6B6B'}" font-size="14" font-weight="600" ${font}>${ok ? 'Paid to ' + esc(v.payee ?? '') : 'Payment failed · U30'}</text>`;
      body += `<rect x="20" y="380" width="320" height="130" rx="14" fill="#1D1F27"/>`;
      [['UPI Ref', String(between(426800000000, 426899999999))], ['From', 'HDFC Bank ••4821'], ['Time', time]].forEach(([k, val], i) => {
        body += `<text x="36" y="${416 + i * 36}" fill="#8A8D98" font-size="12" ${font}>${k}</text><text x="324" y="${416 + i * 36}" text-anchor="end" fill="#F4F4F6" font-size="12" ${font}>${esc(val)}</text>`;
      });
      body += button(680, 'Done');
      break;
    }
    default:
      body += title(meta.screen);
      body += `<rect x="20" y="130" width="320" height="140" rx="16" fill="#1D1F27"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="g1" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#F2A900"/><stop offset="1" stop-color="#FFCF4D"/></linearGradient>
<radialGradient id="cam" cx="0.5" cy="0.45" r="0.8"><stop offset="0" stop-color="#3b3f4a"/><stop offset="1" stop-color="#07080a"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="${bg}"/>
<text x="22" y="26" fill="#F4F4F6" font-size="13" font-weight="600" ${font}>${time}</text>
<rect x="306" y="16" width="24" height="12" rx="3" fill="none" stroke="#F4F4F6"/><rect x="308" y="18" width="14" height="8" rx="1.5" fill="#F4F4F6"/>
${body}
<rect x="130" y="764" width="100" height="4" rx="2" fill="#F4F4F6" opacity="0.5"/>
<text x="180" y="752" text-anchor="middle" fill="#ffffff30" font-size="9" ${font}>killcam mock · ${esc(meta.screen)} · ${new Date(meta.ts).toLocaleTimeString('en-IN', { hour12: false })}</text>
</svg>`;
}

// --------------------------------------------------------------- actions --

const ACTIONS = [
  { id: 'expire_session', label: 'Expire session', description: 'Invalidate the access token; the next API call gets 401 and must refresh.', group: 'Auth' },
  { id: 'logout', label: 'Log out', description: 'Clear tokens and return to the login screen.', group: 'Auth' },
  { id: 'reset_onboarding', label: 'Reset onboarding', description: 'Sets onboarding-complete=false; shown on next cold start.', group: 'Onboarding' },
  { id: 'show_whats_new', label: "Show What's New", description: null, group: 'Onboarding' },
  { id: 'force_remote_config', label: 'Force remote config fetch', description: 'Bypass the 15 min cache.', group: 'Config' },
  { id: 'clear_image_cache', label: 'Clear image cache', description: 'Coil memory + disk caches.', group: 'Storage' },
  { id: 'simulate_low_memory', label: 'Simulate low memory', description: 'Dispatch onTrimMemory(TRIM_MEMORY_RUNNING_CRITICAL).', group: 'System' },
  { id: 'log_nonfatal', label: 'Log test non-fatal', description: 'Records a handled exception.', group: 'Danger zone' },
  { id: 'trigger_test_crash', label: 'Trigger test crash', description: 'Throws on the main thread. The app restarts and a new session begins.', group: 'Danger zone' },
];

async function runAction(id) {
  const sim = liveSim ?? new Sim(state.live, { live: true });
  switch (id) {
    case 'expire_session':
      sim.log('W', 'AuthManager', 'Access token expired by Killcam action');
      sim.call({ method: 'POST', url: `${API}/auth/refresh`, reqBody: { refreshToken: '••••' }, status: 401, resBody: { error: { code: 'TOKEN_EXPIRED', message: 'Refresh token expired' } }, duration: 210 });
      return { ok: true, message: 'Access token expired. Next request will 401.' };
    case 'logout':
      sim.log('I', 'AuthManager', 'Logged out by Killcam action');
      sim.screen('Login');
      return { ok: true, message: 'Logged out.' };
    case 'reset_onboarding': {
      const e = state.prefs.get('swag-pay-startup').find((x) => x.key === 'onboarding-complete');
      e.value = 'false';
      sim.log('I', 'Onboarding', 'onboarding-complete reset to false');
      return { ok: true, message: 'onboarding-complete = false. Restart the app to see onboarding.' };
    }
    case 'show_whats_new':
      return { ok: false, message: "No What's New content for 3.14.0." };
    case 'force_remote_config':
      sim.call({ method: 'GET', url: `${API}/config?platform=android&v=31400&force=1`, resBody: { version: 119, ttlSec: 900 }, duration: 160 });
      state.flags = state.flags.map((f) => (f.key === 'home.layout_variant' ? withEffective({ ...f, remoteValue: 'stories' }) : f));
      broadcast('flags', state.flags);
      return { ok: true, message: 'Fetched remote config v119 (1 flag changed).' };
    case 'clear_image_cache':
      sim.log('I', 'ImageLoader', 'Memory and disk caches cleared (18.4 MB)');
      return { ok: true, message: 'Cleared 18.4 MB.' };
    case 'simulate_low_memory':
      sim.logcat('I', 'ActivityThread', 'onTrimMemory(TRIM_MEMORY_RUNNING_CRITICAL)');
      sim.log('W', 'AppCoordinator', 'Low memory: dropped RN image cache and screenshot buffer');
      return { ok: true, message: 'onTrimMemory(80) dispatched.' };
    case 'log_nonfatal':
      sim.log('E', 'Killcam', 'Test non-fatal', { throwable: STACK_TEST('non-fatal') });
      sim.crash({ fatal: false, exception: 'java.lang.RuntimeException', message: 'Killcam test crash (non-fatal)', stackTrace: STACK_TEST('non-fatal') });
      return { ok: true, message: 'Non-fatal recorded.' };
    case 'trigger_test_crash':
      setTimeout(simulateProcessDeath, 800);
      return { ok: true, message: 'Crashing in 1s. The dashboard will reconnect to the new session.' };
    default:
      return null;
  }
}

/** Fatal crash: save the session, drop every connection, come back as a new process. */
async function simulateProcessDeath() {
  const dead = state.live;
  const sim = new Sim(dead, { live: true });
  sim.logcat('E', 'AndroidRuntime', 'FATAL EXCEPTION: main\nProcess: com.swag.pay, PID: 18933', { throwable: STACK_TEST('fatal') });
  sim.crash({ fatal: true, exception: 'java.lang.RuntimeException', message: 'Killcam test crash (fatal)', stackTrace: STACK_TEST('fatal') });
  dead.live = false;
  dead.reason = 'crash';
  dead.endMs = Date.now();
  state.saved.unshift(dead);
  state.down = true;
  state.live = null;
  for (const res of sseClients) res.destroy();
  sseClients.clear();
  console.log('[mock] simulated process death; restarting in 3s');
  await sleep(3000);
  state.live = await buildLiveSession(Date.now(), { withHistory: false });
  state.down = false;
  startLiveLoop();
  console.log('[mock] new live session', state.live.id);
}

// ------------------------------------------------------------------- files --

function findNode(rootId, relPath) {
  const root = state.files[rootId];
  if (!root) return null;
  let node = root.tree;
  const parts = String(relPath ?? '').split('/').filter(Boolean);
  for (const p of parts) {
    if (!node.dir) return null;
    node = node.children.find((c) => c.name === p);
    if (!node) return null;
  }
  return node;
}
function nodeSize(n) {
  return n.dir ? n.children.reduce((a, c) => a + nodeSize(c), 0) : n.size;
}

// ------------------------------------------------------------------- http --

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((seg) => (seg.startsWith(':') ? (keys.push(seg.slice(1)), '([^/]+)') : seg.replace(/[.]/g, '\\.')))
        .join('/') +
      '$',
  );
  routes.push({ method, re, keys, handler });
};

const json = (res, status, body) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
};
const noContent = (res) => {
  res.writeHead(204);
  res.end();
};
const fail = (res, status, error) => json(res, status, { error });

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error('body too large');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  return JSON.parse(text);
}

function sessionById(id) {
  if (id === 'live' || id === state.live?.id) return state.live;
  return state.saved.find((s) => s.id === id) ?? null;
}
function status(req) {
  return {
    capturePaused: state.capturePaused,
    wifiEnabled: state.wifiEnabled || REQUIRE_PIN,
    wifiUrl: state.wifiEnabled || REQUIRE_PIN ? `http://192.168.1.23:${PORT}` : null,
    remote: REQUIRE_PIN,
    port: PORT,
  };
}
function allCrashes() {
  const out = [...state.live.crashes];
  for (const s of state.saved) if (s.reason === 'crash') out.push(...s.crashes.filter((c) => c.fatal));
  return out.sort((a, b) => b.ts - a.ts);
}

// Session and status
route('GET', '/api/info', (req, res) => json(res, 200, state.live.app));
route('GET', '/api/status', (req, res) => json(res, 200, status(req)));
route('POST', '/api/capture', async (req, res) => {
  const b = await readJson(req);
  state.capturePaused = !!b?.paused;
  const st = status(req);
  broadcast('status', st);
  json(res, 200, st);
});
route('DELETE', '/api/data', (req, res, { query }) => {
  const stream = query.get('stream') ?? 'all';
  const s = state.live;
  if (!['network', 'logs', 'crashes', 'timeline', 'all'].includes(stream)) return fail(res, 400, 'bad stream');
  if (stream === 'network' || stream === 'all') s.network.length = 0;
  if (stream === 'logs' || stream === 'all') s.logs.length = 0;
  if (stream === 'crashes' || stream === 'all') s.crashes.length = 0;
  if (stream === 'timeline' || stream === 'all') {
    s.timeline.length = 0;
    s.screenshots.clear();
  }
  broadcast('cleared', { stream });
  noContent(res);
});
route('GET', '/api/live', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ sessionId: state.live.id, seq: seqCounter })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Network
route('GET', '/api/network', (req, res) => json(res, 200, state.live.network.map(netSummary)));
route('GET', '/api/network.har', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="swag-pay-${state.live.id}.har"`,
  });
  res.end(JSON.stringify(toHar(state.live.network), null, 1));
});
route('GET', '/api/network/:id', (req, res, { id }) => {
  const c = state.live.network.find((x) => x.id === id);
  return c ? json(res, 200, c) : fail(res, 404, 'not_found');
});
route('GET', '/api/network/:id/curl', (req, res, { id }) => {
  const c = state.live.network.find((x) => x.id === id);
  if (!c) return fail(res, 404, 'not_found');
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(toCurl(c));
});

// Logs and crashes
route('GET', '/api/logs', (req, res) => json(res, 200, state.live.logs));
route('GET', '/api/crashes', (req, res) => json(res, 200, allCrashes().map(crashSummary)));
route('GET', '/api/crashes/:id', (req, res, { id }) => {
  const c = [state.live, ...state.saved].flatMap((s) => s.crashes).find((x) => x.id === id);
  return c ? json(res, 200, c) : fail(res, 404, 'not_found');
});

// Timeline, screenshots, sessions
route('GET', '/api/timeline', (req, res) => json(res, 200, state.live.timeline));
route('POST', '/api/timeline/mark', async (req, res) => {
  const b = await readJson(req);
  const sim = liveSim ?? new Sim(state.live, { live: true });
  const was = state.capturePaused;
  state.capturePaused = false;
  const ev = sim.mark(String(b?.label ?? '').trim() || 'Marked moment');
  state.capturePaused = was;
  json(res, 200, ev);
});
route('POST', '/api/screenshot', (req, res) => {
  if (!state.live.currentScreen) return noContent(res);
  const sim = liveSim ?? new Sim(state.live, { live: true });
  const was = state.capturePaused;
  state.capturePaused = false;
  const ev = sim.screenshot({});
  state.capturePaused = was;
  json(res, 200, ev);
});
route('GET', '/api/sessions', (req, res) => json(res, 200, [summaryOf(state.live), ...state.saved.map(summaryOf)]));
route('POST', '/api/sessions', async (req, res) => {
  const b = await readJson(req);
  const src = state.live;
  const copy = {
    ...clone({ ...src, screenshots: null }),
    screenshots: new Map(src.screenshots),
    id: src.id + '_s' + hexStr(4),
    live: false,
    reason: 'manual',
    label: String(b?.label ?? '').trim() || null,
    endMs: Date.now(),
  };
  copy.app = { ...copy.app, sessionId: copy.id };
  state.saved.unshift(copy);
  json(res, 200, summaryOf(copy));
});
route('GET', '/api/sessions/:id', (req, res, { id }) => {
  const s = sessionById(id);
  return s ? json(res, 200, bundleOf(s)) : fail(res, 404, 'not_found');
});
route('DELETE', '/api/sessions/:id', (req, res, { id }) => {
  const i = state.saved.findIndex((s) => s.id === id);
  if (i < 0) return fail(res, id === 'live' || id === state.live.id ? 400 : 404, id === 'live' ? 'cannot_delete_live' : 'not_found');
  state.saved.splice(i, 1);
  noContent(res);
});
route('GET', '/api/sessions/:id/screenshots/:sid', (req, res, { id, sid }) => {
  const s = sessionById(id);
  const meta = s?.screenshots.get(sid);
  if (!meta) return fail(res, 404, 'not_found');
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=86400, immutable' });
  res.end(screenshotSvg(meta));
});
route('GET', '/api/sessions/:id/export', (req, res, { id }) => {
  const s = sessionById(id);
  if (!s) return fail(res, 404, 'not_found');
  const files = [
    { name: 'session.json', data: JSON.stringify(bundleOf(s), null, 2) },
    { name: 'network.har', data: JSON.stringify(toHar(s.network), null, 1) },
    ...[...s.screenshots.entries()].map(([sid, meta]) => ({ name: `screenshots/${sid}.svg`, data: screenshotSvg(meta) })),
  ];
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="killcam-${s.id}.zip"`,
  });
  res.end(makeZip(files));
});

// Mocks
route('GET', '/api/mocks', (req, res) => json(res, 200, state.mocks));
route('POST', '/api/mocks', async (req, res) => {
  const b = await readJson(req);
  const err = validateMockInput(b);
  if (err) return fail(res, 400, err);
  const rule = mockFromInput(b);
  state.mocks.push(rule);
  broadcast('mocks', state.mocks);
  json(res, 200, rule);
});
route('PUT', '/api/mocks/:id', async (req, res, { id }) => {
  const i = state.mocks.findIndex((m) => m.id === id);
  if (i < 0) return fail(res, 404, 'not_found');
  const b = await readJson(req);
  const err = validateMockInput(b);
  if (err) return fail(res, 400, err);
  state.mocks[i] = mockFromInput(b, state.mocks[i]);
  broadcast('mocks', state.mocks);
  json(res, 200, state.mocks[i]);
});
route('PUT', '/api/mocks', async (req, res) => {
  const ids = await readJson(req);
  if (!Array.isArray(ids)) return fail(res, 400, 'expected an array of rule ids');
  const byId = new Map(state.mocks.map((m) => [m.id, m]));
  if (ids.length !== state.mocks.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id)))
    return fail(res, 400, 'ids must list every rule exactly once');
  state.mocks = ids.map((id) => byId.get(id));
  broadcast('mocks', state.mocks);
  json(res, 200, state.mocks);
});
route('DELETE', '/api/mocks/:id', (req, res, { id }) => {
  const i = state.mocks.findIndex((m) => m.id === id);
  if (i < 0) return fail(res, 404, 'not_found');
  state.mocks.splice(i, 1);
  broadcast('mocks', state.mocks);
  noContent(res);
});

// Flags
route('GET', '/api/flags', (req, res) => json(res, 200, state.flags));
route('PUT', '/api/flags', async (req, res) => {
  const b = await readJson(req);
  const i = state.flags.findIndex((f) => f.key === b?.key);
  if (i < 0) return fail(res, 404, 'unknown_flag');
  const f = state.flags[i];
  const v = String(b.value);
  if (f.type === 'boolean' && v !== 'true' && v !== 'false') return fail(res, 400, 'expected true or false');
  if (f.type === 'int' && !/^-?\d+$/.test(v)) return fail(res, 400, 'expected an integer');
  if (f.type === 'double' && Number.isNaN(Number(v))) return fail(res, 400, 'expected a number');
  if (f.type === 'json') {
    try {
      JSON.parse(v);
    } catch {
      return fail(res, 400, 'invalid JSON');
    }
  }
  if (f.options && !f.options.includes(v)) return fail(res, 400, 'value not in options');
  state.flags[i] = withEffective({ ...f, override: v });
  broadcast('flags', state.flags);
  (liveSim ?? new Sim(state.live, { live: true })).custom(`Flag override ${f.key} = ${v}`, { key: f.key, value: v });
  json(res, 200, state.flags[i]);
});
route('DELETE', '/api/flags', (req, res, { query }) => {
  const key = query.get('key');
  state.flags = state.flags.map((f) => (!key || f.key === key ? withEffective({ ...f, override: null }) : f));
  broadcast('flags', state.flags);
  noContent(res);
});

// Storage: prefs
route('GET', '/api/prefs', (req, res) =>
  json(
    res,
    200,
    [...state.prefs.entries()].map(([name, entries]) => ({
      name,
      entryCount: entries.length,
      sizeBytes: 60 + entries.reduce((a, e) => a + e.key.length + e.value.length + 24, 0),
    })),
  ),
);
route('GET', '/api/prefs/:file', (req, res, { file }) => {
  const entries = state.prefs.get(decodeURIComponent(file));
  return entries ? json(res, 200, entries) : fail(res, 404, 'not_found');
});
route('PUT', '/api/prefs/:file', async (req, res, { file }) => {
  const name = decodeURIComponent(file);
  const b = await readJson(req);
  if (!b?.key || !['string', 'boolean', 'int', 'long', 'float', 'string_set'].includes(b.type)) return fail(res, 400, 'bad entry');
  const v = String(b.value ?? '');
  if (b.type === 'boolean' && v !== 'true' && v !== 'false') return fail(res, 400, 'expected true or false');
  if ((b.type === 'int' || b.type === 'long') && !/^-?\d+$/.test(v)) return fail(res, 400, 'expected an integer');
  if (b.type === 'float' && Number.isNaN(Number(v))) return fail(res, 400, 'expected a number');
  if (b.type === 'string_set') {
    try {
      const a = JSON.parse(v);
      if (!Array.isArray(a) || a.some((x) => typeof x !== 'string')) throw 0;
    } catch {
      return fail(res, 400, 'string_set must be a JSON array of strings');
    }
  }
  if (!state.prefs.has(name)) state.prefs.set(name, []);
  const entries = state.prefs.get(name);
  const e = { key: String(b.key), type: b.type, value: v };
  const i = entries.findIndex((x) => x.key === e.key);
  if (i >= 0) entries[i] = e;
  else entries.push(e);
  json(res, 200, e);
});
route('DELETE', '/api/prefs/:file', (req, res, { file, query }) => {
  const entries = state.prefs.get(decodeURIComponent(file));
  if (!entries) return fail(res, 404, 'not_found');
  const i = entries.findIndex((x) => x.key === query.get('key'));
  if (i < 0) return fail(res, 404, 'not_found');
  entries.splice(i, 1);
  noContent(res);
});

// Storage: databases
route('GET', '/api/db', (req, res) => json(res, 200, DBS.map(dbInfo)));
route('GET', '/api/db/:name/tables/:table', (req, res, { name, table, query }) => {
  const db = DBS.find((d) => d.name === decodeURIComponent(name));
  const t = db?.tables[decodeURIComponent(table)];
  if (!t) return fail(res, 404, 'not_found');
  const t0 = performance.now();
  const offset = Math.max(0, Number(query.get('offset') ?? 0));
  const limit = Math.min(500, Math.max(1, Number(query.get('limit') ?? 50)));
  const orderBy = query.get('orderBy');
  const desc = query.get('desc') === 'true';
  let rows = t.rows.slice();
  if (orderBy) {
    const oi = t.columns.indexOf(orderBy);
    if (oi < 0) return fail(res, 400, `no such column: ${orderBy}`);
    rows.sort((a, b) => cmp(a[oi], b[oi]) * (desc ? -1 : 1));
  }
  json(res, 200, {
    columns: t.columns,
    rows: rows.slice(offset, offset + limit),
    totalRows: rows.length,
    affectedRows: null,
    truncated: false,
    elapsedMs: Math.max(1, Math.round(performance.now() - t0) + between(1, 4)),
    error: null,
  });
});
route('POST', '/api/db/:name/query', async (req, res, { name }) => {
  const db = DBS.find((d) => d.name === decodeURIComponent(name));
  if (!db) return fail(res, 404, 'not_found');
  const b = await readJson(req);
  json(res, 200, runSql(db, String(b?.sql ?? '')));
});

// Storage: files
route('GET', '/api/files/roots', (req, res) =>
  json(res, 200, Object.entries(state.files).map(([id, r]) => ({ id, label: r.label, path: r.path }))),
);
route('GET', '/api/files', (req, res, { query }) => {
  const rel = query.get('path') ?? '';
  const node = findNode(query.get('root'), rel);
  if (!node || !node.dir) return fail(res, 404, 'not_found');
  const prefix = rel.split('/').filter(Boolean).join('/');
  const list = node.children
    .map((c) => ({ name: c.name, path: prefix ? `${prefix}/${c.name}` : c.name, dir: c.dir, size: nodeSize(c), modifiedMs: c.modifiedMs }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  json(res, 200, list);
});
route('GET', '/api/files/content', (req, res, { query }) => {
  const node = findNode(query.get('root'), query.get('path'));
  if (!node || node.dir) return fail(res, 404, 'not_found');
  let data;
  let type = 'application/octet-stream';
  if (node.content != null) {
    data = Buffer.from(node.content, 'utf8');
    type = node.name.endsWith('.json') ? 'application/json; charset=utf-8' : node.name.endsWith('.xml') ? 'text/xml; charset=utf-8' : 'text/plain; charset=utf-8';
  } else {
    const r = mulberry32(node.size);
    data = Buffer.alloc(Math.min(node.size, 64 * 1024), 0).map(() => Math.floor(r() * 256));
    if (node.name.endsWith('.db')) Buffer.from('SQLite format 3\0').copy(data);
    if (node.name.endsWith('.pdf')) Buffer.from('%PDF-1.7\n').copy(data);
  }
  const headers = { 'Content-Type': type, 'Content-Length': data.length };
  if (query.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${node.name}"`;
  res.writeHead(200, headers);
  res.end(data);
});
route('DELETE', '/api/files', (req, res, { query }) => {
  const rel = String(query.get('path') ?? '');
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return fail(res, 400, 'cannot delete a root');
  const parent = findNode(query.get('root'), parts.slice(0, -1).join('/'));
  const i = parent?.dir ? parent.children.findIndex((c) => c.name === parts.at(-1)) : -1;
  if (i < 0) return fail(res, 404, 'not_found');
  parent.children.splice(i, 1);
  noContent(res);
});

// Storage: MMKV
route('GET', '/api/mmkv', (req, res) => json(res, 200, [...state.mmkv.entries()].map(([id, m]) => mmkvInstance(id, m))));
route('GET', '/api/mmkv/:id', (req, res, { id }) => {
  const m = state.mmkv.get(id);
  if (!m) return fail(res, 404, 'not_found');
  if (m.error) return fail(res, 400, m.error);
  json(res, 200, m.entries);
});
route('PUT', '/api/mmkv/:id', async (req, res, { id }) => {
  const m = state.mmkv.get(id);
  if (!m) return fail(res, 404, 'not_found');
  if (m.error) return fail(res, 400, m.error);
  const b = await readJson(req);
  if (!b?.key) return fail(res, 400, 'key is required');
  const err = validateMmkv(b.type, b.value);
  if (err) return fail(res, 400, err);
  const e = mmkvEntry(String(b.key), b.type, String(b.value));
  const i = m.entries.findIndex((x) => x.key === e.key);
  if (i >= 0) m.entries[i] = e;
  else m.entries.push(e);
  json(res, 200, e);
});
route('DELETE', '/api/mmkv/:id', (req, res, { id, query }) => {
  const m = state.mmkv.get(id);
  const i = m ? m.entries.findIndex((x) => x.key === query.get('key')) : -1;
  if (i < 0) return fail(res, 404, 'not_found');
  m.entries.splice(i, 1);
  noContent(res);
});

// Firebase Remote Config
route('GET', '/api/remote-config', (req, res) => json(res, 200, remoteConfigInfo()));
route('POST', '/api/remote-config/fetch', async (req, res) => {
  const rc = state.remoteConfig;
  await sleep(between(300, 900));
  rc.fetches++;
  rc.lastFetchMs = Date.now();
  rc.fetchStatus = 'success';
  // Each fetch flips the scratch-card cap so the change is visible.
  const cap = rc.values.find((x) => x.key === 'rewards_scratch_daily_cap');
  cap.value = rc.fetches % 2 ? '5' : '3';
  syncRcFlags();
  broadcast('flags', state.flags);
  (liveSim ?? new Sim(state.live, { live: true })).call({ method: 'POST', url: 'https://firebaseremoteconfig.googleapis.com/v1/projects/swag-pay-stage/namespaces/firebase:fetch', reqBody: { appInstanceId: hexStr(22), appId: '1:48213:android:9f1c', sdkVersion: '22.1.0' }, resBody: { state: 'UPDATE', entries: Object.fromEntries(rc.values.filter((x) => x.source === 'remote').map((x) => [x.key, x.value])) }, duration: 420 });
  json(res, 200, remoteConfigInfo());
});

// Actions
route('GET', '/api/actions', (req, res) => json(res, 200, ACTIONS));
route('POST', '/api/actions/:id', async (req, res, { id }) => {
  const r = await runAction(id);
  return r ? json(res, 200, r) : fail(res, 404, 'not_found');
});
route('POST', '/api/deeplink', async (req, res) => {
  const b = await readJson(req);
  const uri = String(b?.uri ?? '').trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(uri)) return json(res, 200, { ok: false, message: 'Not a URI: expected scheme:...' });
  const known = /^(swagpay:\/\/|upi:\/\/pay|https:\/\/(www\.)?swag\.gg\/)/i.test(uri);
  const sim = liveSim ?? new Sim(state.live, { live: true });
  sim.custom(`Deep link ${uri}`, { uri, handled: known });
  if (!known) return json(res, 200, { ok: false, message: `No activity found to handle ${uri}` });
  if (/scan/.test(uri)) sim.screen('Scan');
  else if (/^upi:\/\/pay/i.test(uri)) sim.screen('PayFlow.EnterAmount', {});
  return json(res, 200, { ok: true, message: `Opened ${uri}` });
});

// Auth
const tokens = new Set();
route('POST', '/api/auth', async (req, res) => {
  const b = await readJson(req);
  if (String(b?.pin ?? '') !== PIN) {
    await sleep(400);
    return fail(res, 401, 'bad_pin');
  }
  const t = crypto.randomBytes(18).toString('base64url');
  tokens.add(t);
  res.writeHead(204, { 'Set-Cookie': `killcam_token=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200` });
  res.end();
});
function hasToken(req) {
  const m = /(?:^|;\s*)killcam_token=([^;]+)/.exec(req.headers.cookie ?? '');
  return !!m && tokens.has(m[1]);
}

// ----------------------------------------------------------- static files --

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json' };
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(STATIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(STATIC_DIR)) return fail(res, 403, 'forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Killcam mock</title><body style="font:14px system-ui;background:#0f1012;color:#ddd;padding:40px"><h1 style="color:#F2A900">Killcam mock server</h1><p>The API is running on this port. No dashboard build found at<br><code>${esc(STATIC_DIR)}</code>.</p><p>Run <code>npm run build</code>, or use <code>npm run dev</code> (Vite on :5173 proxies /api here).</p>`);
    return;
  }
  const ext = path.extname(file);
  if (ext === '.html') {
    // Dev only: ?fakeNative=1 gets a stub window.KillcamNative (the script checks the query itself).
    const stub = fs.readFileSync(path.join(HERE, 'fake-native.js'), 'utf8');
    const html = fs.readFileSync(file, 'utf8').replace('<head>', `<head>\n<script>${stub}</script>`);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(html);
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

// ------------------------------------------------------------------ server --

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const t0 = Date.now();
  res.on('finish', () => {
    if (pathname !== '/api/live' && !pathname.includes('/screenshots/') && process.env.MOCK_QUIET !== '1')
      console.log(`${req.method} ${pathname}${url.search} → ${res.statusCode} (${Date.now() - t0}ms)`);
  });
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  if (state.down) return req.socket.destroy();
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-killcam'] !== '1') return fail(res, 403, 'missing X-Killcam header');
  if (REQUIRE_PIN && pathname !== '/api/auth' && !hasToken(req)) return fail(res, 401, 'pin_required');
  if (NO_STORAGE.has('prefs') && pathname.startsWith('/api/prefs')) return fail(res, 501, 'prefs_unavailable');
  if (NO_STORAGE.has('databases') && pathname.startsWith('/api/db')) return fail(res, 501, 'databases_unavailable');
  if (NO_STORAGE.has('files') && pathname.startsWith('/api/files')) return fail(res, 501, 'files_unavailable');
  if (NO_STORAGE.has('mmkv') && pathname.startsWith('/api/mmkv')) return fail(res, 501, 'mmkv_unavailable');
  if (NO_STORAGE.has('remote-config') && pathname.startsWith('/api/remote-config')) return fail(res, 501, 'remote_config_unavailable');
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = { query: url.searchParams };
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      await r.handler(req, res, params);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) fail(res, e instanceof SyntaxError ? 400 : 500, e instanceof SyntaxError ? 'invalid JSON body' : String(e.message ?? e));
    }
    return;
  }
  fail(res, 404, 'no_such_endpoint');
});

state.mocks = initialMocks();
state.flags = initialFlags();
state.prefs = initialPrefs();
state.files = initialFiles();
state.mmkv = initialMmkv();
state.remoteConfig = initialRemoteConfig();
syncRcFlags();
state.saved.push(await buildPreviousCrashSession());
state.saved.push(await buildManualSession());
state.saved.sort((a, b) => b.startMs - a.startMs);
state.live = await buildLiveSession(Date.now(), { withHistory: true });
startLiveLoop();

server.listen(PORT, () => {
  console.log(`Killcam mock server on http://localhost:${PORT}  (session ${state.live.id})`);
  if (REQUIRE_PIN) console.log(`PIN required for /api (PIN ${PIN})`);
  console.log(`Dashboard build: ${fs.existsSync(path.join(STATIC_DIR, 'index.html')) ? STATIC_DIR : 'not built yet (npm run build)'}`);
});
