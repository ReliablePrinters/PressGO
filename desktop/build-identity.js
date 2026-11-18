'use strict';
// BUILD-TIME helper for the local PressGO Test build (try-build.js) and its tests. It is NOT part of the real app or the real installer
// (it is not in package.json build.files). It keeps the test build from ever sharing a profile folder, an update cache or an install
// identity with the real PressGO.
//
// How the real app picks its folders (so this file can check them without starting the app):
//   - Electron's user-data folder is  %APPDATA%\<app name>,  and the app name is package.json "productName" (else "name").
//   - electron-updater's cache is  %LOCALAPPDATA%\<updaterCacheDirName>,  and electron-builder sets that to  <name, lower case>-updater
//     (appInfo.js: sanitizedName.toLowerCase() + "-updater"), written into resources/app-update.yml.
//   - The uninstall entry and install folder come from appId and productName.

const TEST_IDENTITY = Object.freeze({ name: 'pressgo-desktop-test', productName: 'PressGO Test' });

// What Windows shows for the test installer: its "File description", the Add/Remove Programs "Comments" and the shortcut comments.
// (electron-builder takes all three from package.json "description"; production keeps its own text because only the test builder sets this.)
// Plain ASCII and no quote marks on purpose: electron-builder rewrites straight quotes and the text passes through the installer script.
const TEST_DESCRIPTION = 'PressGO Test - connects to the local test environment (not the live site) and uses a separate test update feed.';

const sanitize = (s) => String(s).replace(/[\\/:*?"<>|]/g, '-');

// The two folder names a build with this package.json identity will use on Windows.
function derivePaths(meta) {
  const name = meta && meta.name, productName = meta && meta.productName;
  const appName = productName || name;
  if (!appName) throw new Error('derivePaths: a build needs a productName or a name');
  if (!name) throw new Error('derivePaths: a build needs a name (it decides the update cache folder)');
  return { userDataFolder: appName, updaterCacheFolder: sanitize(name).toLowerCase() + '-updater' };
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();   // Windows paths ignore case

// prod / test: { name, productName, appId }. Throws a plain-English error when the two could collide.
function assertSeparate(prod, test) {
  if (!test || !test.productName) throw new Error('The test build needs its own productName (it decides the profile folder).');
  if (!test.name) throw new Error('The test build needs its own name (it decides the update cache folder).');
  const p = derivePaths(prod), t = derivePaths(test);
  const problems = [];
  if (same(p.userDataFolder, t.userDataFolder)) problems.push('profile folder: both would use %APPDATA%\\' + t.userDataFolder);
  if (same(p.updaterCacheFolder, t.updaterCacheFolder)) problems.push('update cache: both would use %LOCALAPPDATA%\\' + t.updaterCacheFolder);
  if (prod.appId && test.appId && same(prod.appId, test.appId)) problems.push('install identity: both use appId ' + test.appId);
  if (problems.length) throw new Error('The test build is not separate from the real PressGO:\n  - ' + problems.join('\n  - '));
  return { production: p, test: t };
}

// The test description must say it is the test build and must not repeat the production text (live site / official GitHub Releases).
function assertTestDescription(prodDescription, testDescription) {
  if (!testDescription || !/PressGO Test/.test(testDescription)) throw new Error('The test build needs its own description that names "PressGO Test".');
  if (prodDescription && testDescription.trim().toLowerCase() === String(prodDescription).trim().toLowerCase()) throw new Error('The test build description is the same as the production one.');
  if (/live PressGO site|official GitHub Releases/i.test(testDescription)) throw new Error('The test build description must not claim to use the live site or the official GitHub Releases.');
}

// After a build: read what was really packed (package.json inside app.asar and resources/app-update.yml) and re-check, so a wrong
// build is caught even if the config was fine. unpackedDir = dist-test/<version>/win-unpacked
function verifyBuilt(unpackedDir, prodMeta) {
  const fs = require('fs'), path = require('path');
  const asar = require('@electron/asar');
  const inAsar = JSON.parse(asar.extractFile(path.join(unpackedDir, 'resources', 'app.asar'), 'package.json').toString());
  const yml = fs.readFileSync(path.join(unpackedDir, 'resources', 'app-update.yml'), 'utf8');
  const cache = (/^updaterCacheDirName:\s*(\S+)/m.exec(yml) || [])[1];
  if (!cache) throw new Error('The built app-update.yml has no updaterCacheDirName.');
  const built = { name: inAsar.name, productName: inAsar.productName, appId: inAsar.pgAppId ? String(inAsar.pgAppId) : undefined };
  const prod = { name: prodMeta.name, productName: prodMeta.productName, appId: prodMeta.appId };
  assertTestDescription(prodMeta.description, inAsar.description);                     // broad checks first: names the test build, not production's, no live-site claims
  // ...and what was really packed must be EXACTLY the approved text, not merely something that passes the broad checks above
  if (inAsar.description !== TEST_DESCRIPTION) throw new Error('The built app description is not the approved test description. Expected exactly: "' + TEST_DESCRIPTION + '" but found: "' + inAsar.description + '".');
  const sep = assertSeparate({ ...prod, appId: prod.appId }, { ...built, appId: built.appId });
  if (!same(cache, sep.test.updaterCacheFolder)) throw new Error('The built update cache folder (' + cache + ') is not the one derived from the build name (' + sep.test.updaterCacheFolder + ').');
  if (same(cache, sep.production.updaterCacheFolder)) throw new Error('The built app would use the real update cache: ' + cache);
  return { built, updaterCacheDirName: cache, ...sep };
}

module.exports = { TEST_IDENTITY, TEST_DESCRIPTION, derivePaths, assertSeparate, assertTestDescription, verifyBuilt };
