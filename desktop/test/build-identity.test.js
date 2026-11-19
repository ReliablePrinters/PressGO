'use strict';
// The local PressGO Test build must never share a user-data folder, an updater cache or an installation identity with the real PressGO.
// These tests read the REAL test builder (try-build.js --config-only), the real production package.json and the real main.js, and they
// fail if the two builds could ever end up on the same profile folder or the same update cache.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const id = require('../build-identity');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
// package.json exactly as it was BEFORE any test runs the test builder (used to prove the builder never rewrites it)
const pkgBytesAtLoad = fs.readFileSync(path.join(ROOT, 'package.json'));

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
  // the production build must not carry an extraMetadata block: that is the way a build can override name, description or appId
  // WITHOUT changing the top-level package.json fields pinned here (only the test builder may do that, in try-build.js)
  assert.equal(pkg.build.extraMetadata, undefined, 'the production build config must not override package.json metadata');
  // the real installer's description (File description, Add/Remove Programs comments, shortcut comments) must stay exactly as it is
  assert.equal(pkg.description, 'PressGO desktop app for Windows. Opens the live PressGO site and updates itself from the official GitHub Releases.');
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

test('the test installer describes itself as the test build, and the production description is not reused', () => {
  const cfg = testBuilderConfig();
  assert.equal(Buffer.compare(pkgBytesAtLoad, fs.readFileSync(path.join(ROOT, 'package.json'))), 0, 'running the test builder must never rewrite the production package.json');
  assert.equal(cfg.extraMetadata.description, id.TEST_DESCRIPTION);
  assert.notEqual(cfg.extraMetadata.description, pkg.description);
  assert.match(cfg.extraMetadata.description, /PressGO Test/);
  assert.match(cfg.extraMetadata.description, /local test environment/);
  assert.match(cfg.extraMetadata.description, /separate test update feed/);
  assert.doesNotMatch(cfg.extraMetadata.description, /official GitHub Releases|live PressGO site/);
  assert.doesNotMatch(cfg.extraMetadata.description, /["'‘’“”]/, 'no quote marks: electron-builder rewrites them and the text goes through the installer script');
  assert.ok(/^[\x20-\x7e]+$/.test(cfg.extraMetadata.description), 'plain ASCII only');
  assert.doesNotThrow(() => id.assertTestDescription(pkg.description, cfg.extraMetadata.description));
});

test('assertTestDescription refuses a missing, copied or misleading test description', () => {
  const prod = pkg.description;
  assert.throws(() => id.assertTestDescription(prod, undefined), /own description/);
  assert.throws(() => id.assertTestDescription(prod, 'Some app'), /PressGO Test/);
  assert.throws(() => id.assertTestDescription(prod, prod), /same as the production|PressGO Test/);
  assert.throws(() => id.assertTestDescription(prod, 'PressGO Test. Opens the live PressGO site.'), /live site|official GitHub/);
  assert.throws(() => id.assertTestDescription(prod, 'PressGO Test updates itself from the official GitHub Releases.'), /live site|official GitHub/);
});

// Post-build verification reads what was REALLY packed (resources/app.asar and resources/app-update.yml). These tests create tiny fake
// "win-unpacked" folders with a real asar archive, so they exercise the same code path that checks the real installer build.
async function fakeBuild(description) {
  const asar = require('@electron/asar');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pressgo-verify-'));
  const src = path.join(dir, 'app-src');
  fs.mkdirSync(src); fs.mkdirSync(path.join(dir, 'resources'));
  const meta = { name: 'pressgo-desktop-test', productName: 'PressGO Test', version: '9.9.9', pgAppId: 'com.reliableprinters.pressgo.test', main: 'main.js' };
  if (description !== undefined) meta.description = description;
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(src, 'main.js'), '// fake app');
  await asar.createPackage(src, path.join(dir, 'resources', 'app.asar'));
  fs.writeFileSync(path.join(dir, 'resources', 'app-update.yml'), 'provider: generic\nurl: http://localhost:8099/\nupdaterCacheDirName: pressgo-desktop-test-updater\n');
  return dir;
}

test('post-build verification: ONLY the exact approved description passes', async () => {
  const prod = { name: pkg.name, productName: pkg.productName, appId: pkg.build.appId, description: pkg.description };
  const made = [];
  const verify = async (description) => { const dir = await fakeBuild(description); made.push(dir); return () => id.verifyBuilt(dir, prod); };
  try {
    // 1. the exact approved description passes
    const ok = (await verify(id.TEST_DESCRIPTION))();
    assert.equal(ok.built.name, 'pressgo-desktop-test');
    assert.equal(ok.updaterCacheDirName, 'pressgo-desktop-test-updater');
    // 2. a different description that still contains "PressGO Test" (and passes the broad checks) is refused after the build
    assert.doesNotThrow(() => id.assertTestDescription(prod.description, 'PressGO Test - a perfectly reasonable but different description.'));
    assert.throws(await verify('PressGO Test - a perfectly reasonable but different description.'), /not the approved test description/);
    assert.throws(await verify('PressGO Test - connects to the local test environment and uses a separate test update feed.'), /not the approved test description/);   // the approved text minus "(not the live site)"
    // 3. near misses of the approved text are refused too (exact match, not "similar")
    assert.throws(await verify(id.TEST_DESCRIPTION + ' '), /not the approved test description/);
    assert.throws(await verify(id.TEST_DESCRIPTION.replace('local', 'Local')), /not the approved test description/);
    assert.throws(await verify(id.TEST_DESCRIPTION.slice(0, -1)), /not the approved test description/);
    // 4. the previous (production) description is refused
    assert.throws(await verify(pkg.description), /names "PressGO Test"/);
    // 5. no description at all is refused
    assert.throws(await verify(undefined), /names "PressGO Test"/);
  } finally {
    for (const d of made) fs.rmSync(d, { recursive: true, force: true });   // only the temp folders this test created itself
  }
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
