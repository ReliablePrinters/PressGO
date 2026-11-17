'use strict';
// The local PressGO Test build must never share a user-data folder, an updater cache or an installation identity with the real PressGO.
// These tests read the REAL test builder (try-build.js --config-only), the real production package.json and the real main.js, and they
// fail if the two builds could ever end up on the same profile folder or the same update cache.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const id = require('../build-identity');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

function testBuilderConfig() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'try-build.js'), '9.9.9', '--config-only'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, 'try-build.js --config-only must succeed: ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('production identity is pinned: appId, name, productName and the GitHub update feed do not change', () => {
  assert.equal(pkg.name, 'pressgo-desktop');
  assert.equal(pkg.productName, 'PressGO');
  assert.equal(pkg.build.appId, 'com.reliableprinters.pressgo');
  assert.equal(pkg.build.productName, 'PressGO');
  assert.deepEqual(pkg.build.publish, [{ provider: 'github', owner: 'ReliablePrinters', repo: 'PressGO', releaseType: 'release' }]);
  assert.equal(pkg.build.nsis.artifactName, 'PressGO-Setup.${ext}');
  // nothing test-only may be packed into the real installer
  assert.ok(!pkg.build.files.includes('test-override.json'));
  assert.ok(!pkg.build.files.some((f) => /build-identity|try-build/.test(f)));
});

test('the production profile folder and update cache are the ones the shipped app has always used', () => {
  const p = id.derivePaths({ name: pkg.name, productName: pkg.productName });
  assert.equal(p.userDataFolder, 'PressGO');
  assert.equal(p.updaterCacheFolder, 'pressgo-desktop-updater');
});

test('the test builder gives the test build its own name, product name, profile folder and update cache', () => {
  const cfg = testBuilderConfig();
  assert.equal(cfg.extraMetadata.name, 'pressgo-desktop-test');
  assert.equal(cfg.extraMetadata.productName, 'PressGO Test');
  const t = id.derivePaths(cfg.extraMetadata);
  const p = id.derivePaths({ name: pkg.name, productName: pkg.productName });
  assert.equal(t.userDataFolder, 'PressGO Test');
  assert.equal(t.updaterCacheFolder, 'pressgo-desktop-test-updater');
  assert.notEqual(t.userDataFolder.toLowerCase(), p.userDataFolder.toLowerCase());
  assert.notEqual(t.updaterCacheFolder.toLowerCase(), p.updaterCacheFolder.toLowerCase());
});

test('the test build also keeps its own install identity and update feed, and never uses the production ones', () => {
  const cfg = testBuilderConfig();
  assert.notEqual(cfg.appId, pkg.build.appId);
  assert.equal(cfg.appId, 'com.reliableprinters.pressgo.test');
  assert.equal(cfg.extraMetadata.pgAppId, 'com.reliableprinters.pressgo.test');
  assert.equal(cfg.productName, 'PressGO Test');
  assert.deepEqual(cfg.publish, [{ provider: 'generic', url: 'http://localhost:8099/' }]);
  assert.ok(cfg.files.includes('test-override.json'));
  assert.equal(cfg.directories.output.startsWith('dist-test/'), true);
});

test('assertSeparate refuses any test identity that could share the real profile, cache or install identity', () => {
  const prod = { name: pkg.name, productName: pkg.productName, appId: pkg.build.appId };
  const good = { name: 'pressgo-desktop-test', productName: 'PressGO Test', appId: 'com.reliableprinters.pressgo.test' };
  assert.doesNotThrow(() => id.assertSeparate(prod, good));
  assert.throws(() => id.assertSeparate(prod, { ...good, productName: 'PressGO' }), /profile folder/);
  assert.throws(() => id.assertSeparate(prod, { ...good, productName: 'pressgo' }), /profile folder/);     // Windows paths ignore case
  assert.throws(() => id.assertSeparate(prod, { ...good, name: 'pressgo-desktop' }), /update cache/);
  assert.throws(() => id.assertSeparate(prod, { ...good, name: 'PressGO-Desktop' }), /update cache/);
  assert.throws(() => id.assertSeparate(prod, { ...good, appId: prod.appId }), /install identity|appId/);
  assert.throws(() => id.assertSeparate(prod, { ...good, productName: undefined, name: 'pressgo-desktop-test' }), /productName/);
});

test('electron-builder naming rules are mirrored: product name wins for the profile folder, name decides the cache folder', () => {
  assert.equal(id.derivePaths({ name: 'a-b', productName: 'X Y' }).userDataFolder, 'X Y');
  assert.equal(id.derivePaths({ name: 'A-B' }).userDataFolder, 'A-B');
  assert.equal(id.derivePaths({ name: 'A-B' }).updaterCacheFolder, 'a-b-updater');
});

test('the TEST window title is added only for the local test build (never for the real app)', () => {
  const idx = mainJs.indexOf("win.setTitle('TEST");
  assert.ok(idx > -1, "main.js must set a 'TEST' title");
  // every TEST-title statement sits inside an `if (TEST_BUILD) {` block
  const re = /setTitle\('\[?TEST/g; let m, n = 0;
  while ((m = re.exec(mainJs))) {
    n++;
    const before = mainJs.slice(Math.max(0, m.index - 400), m.index);
    assert.match(before, /if \(TEST_BUILD\) \{[^}]*$/s, 'TEST title code must be inside if (TEST_BUILD)');
  }
  assert.ok(n >= 2, 'initial title and title updates are both covered');
  assert.match(mainJs, /title: 'PressGO',/, 'the real window title is unchanged');
  assert.match(mainJs, /TEST_BUILD = true; \}/, 'TEST_BUILD is only set from test-override.json');
});
