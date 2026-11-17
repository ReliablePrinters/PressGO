'use strict';
// LOCAL TEST BUILD ONLY. Builds a separate "PressGO Test" installer that:
//   - installs next to (never over) the real PressGO, with its own name, settings and uninstaller
//   - opens the local copy of the site (http://localhost:8081/) instead of the live site
//   - looks for updates in a local folder (http://localhost:8099/), never GitHub
// Usage:  node try-build.js 1.1.0     (then again with 1.1.1)
//         node try-build.js 1.2.0 --url=http://127.0.0.1:8082/    (point the test app at another LOCAL site)
// IMPORTANT: the default address (http://localhost:8081/, served by try-serve.js from ../docs) uses docs/config.js, which is the LIVE
// database. Signing in with such a build talks to LIVE data. To test against an isolated test project, serve a copy of the site
// whose config.js points at the test project and pass its local address with --url (only http://localhost or 127.0.0.1 is accepted).
// Nothing here publishes anything or touches GitHub, Supabase or the real PressGO.
// SEPARATION (see build-identity.js): the test build also has its own app name and product name, so it uses its OWN profile folder
// (%APPDATA%\PressGO Test) and its OWN update cache (%LOCALAPPDATA%\pressgo-desktop-test-updater), never the real PressGO's
// (%APPDATA%\PressGO and %LOCALAPPDATA%\pressgo-desktop-updater). The build stops if the two could ever match, and re-checks what it packed.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { TEST_IDENTITY, assertSeparate, verifyBuilt } = require('./build-identity');

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('Give a version, for example: node try-build.js 1.1.0'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const cfg = JSON.parse(JSON.stringify(pkg.build));
cfg.appId = 'com.reliableprinters.pressgo.test';
cfg.productName = 'PressGO Test';
cfg.extraMetadata = { version, pgAppId: 'com.reliableprinters.pressgo.test', ...TEST_IDENTITY };   // name + productName: own profile folder and update cache
const prodIdentity = { name: pkg.name, productName: pkg.productName, appId: pkg.build.appId };
assertSeparate(prodIdentity, { ...TEST_IDENTITY, appId: cfg.appId });                              // throws (and the build stops) if they could collide
cfg.directories = { output: 'dist-test/' + version, buildResources: 'build' };
cfg.files = [...cfg.files, 'test-override.json'];
cfg.publish = [{ provider: 'generic', url: 'http://localhost:8099/' }];
cfg.win = { icon: 'build/icon.png', target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'PressGO-Test-Setup.${ext}' };
cfg.nsis = { ...cfg.nsis, artifactName: 'PressGO-Test-Setup.${ext}' };

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: __dirname, stdio: 'inherit', shell: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (r.status !== 0) { console.error('Step failed: ' + cmd + ' ' + args.join(' ')); process.exit(r.status || 1); }
};

if (process.argv.includes('--config-only')) { console.log(JSON.stringify(cfg, null, 2)); process.exit(0); }

const urlArg = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6) || 'http://localhost:8081/';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(urlArg)) { console.error('--url must look like http://127.0.0.1:8082/ (a local address only)'); process.exit(1); }
console.log('The test app will open: ' + urlArg);
fs.writeFileSync(path.join(__dirname, 'test-override.json'), JSON.stringify({ url: urlArg }));
fs.writeFileSync(path.join(__dirname, '.test-config.json'), JSON.stringify(cfg, null, 2));
try {
  run('node', ['make-icon.js']);
  run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--config', '.test-config.json']);
} finally {
  fs.rmSync(path.join(__dirname, 'test-override.json'), { force: true });
  fs.rmSync(path.join(__dirname, '.test-config.json'), { force: true });
}
// Re-check what was really packed (app.asar package.json and app-update.yml), not just the config.
const packed = verifyBuilt(path.join(__dirname, 'dist-test', version, 'win-unpacked'), prodIdentity);
console.log('\nSeparation check passed. The test build uses its own folders:');
console.log('  profile      %APPDATA%\\' + packed.test.userDataFolder + '        (real PressGO: %APPDATA%\\' + packed.production.userDataFolder + ')');
console.log('  update cache %LOCALAPPDATA%\\' + packed.updaterCacheDirName + '   (real PressGO: %LOCALAPPDATA%\\' + packed.production.updaterCacheFolder + ')');
console.log('\nDone. Installer: dist-test/' + version + '/PressGO-Test-Setup.exe');
