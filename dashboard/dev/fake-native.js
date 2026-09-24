/* Dev and mock only (never in the production build): a stand-in for the Android
 * in-app window's window.KillcamNative bridge, active with ?fakeNative=1.
 * Calls are recorded in window.__killcamNativeCalls for headless checks. */
(function () {
  if (new URLSearchParams(location.search).get('fakeNative') !== '1') return;
  var port = Number(location.port) || 80;
  var state = { wifiEnabled: false, pin: '482913', chrome: null };
  var calls = (window.__killcamNativeCalls = []);
  function log(name, args) {
    calls.push({ name: name, args: args, at: Date.now() });
    console.info('[fake KillcamNative] ' + name, args);
  }
  function toast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.setAttribute('data-fake-native-toast', '');
    el.style.cssText =
      'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:2147483647;background:#303030;color:#fff;' +
      'padding:10px 16px;border-radius:20px;font:14px/1.3 Roboto,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none';
    (document.body || document.documentElement).appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 2000);
  }
  window.KillcamNative = {
    close: function () {
      log('close', []);
      toast('close() — the window would close');
    },
    shareBundle: function () {
      log('shareBundle', []);
      toast('Preparing bug bundle…');
    },
    getConnection: function () {
      log('getConnection', []);
      return JSON.stringify({
        port: port,
        usbCommand: 'adb forward tcp:' + port + ' tcp:' + port,
        wifiEnabled: state.wifiEnabled,
        wifiUrl: state.wifiEnabled ? 'http://192.168.1.23:' + port : null,
        pin: state.wifiEnabled ? state.pin : null,
      });
    },
    setWifiSharing: function (enabled) {
      log('setWifiSharing', [enabled]);
      setTimeout(function () {
        state.wifiEnabled = !!enabled;
        window.dispatchEvent(new CustomEvent('killcam-native', { detail: { type: 'connection' } }));
      }, 700);
    },
    copy: function (text) {
      log('copy', [text]);
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      } catch (e) {}
      toast('Copied');
    },
    setChrome: function (background, light) {
      log('setChrome', [background, light]);
      state.chrome = { background: background, light: light };
      window.__killcamChrome = state.chrome;
    },
  };
})();
