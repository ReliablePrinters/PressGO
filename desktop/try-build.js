'use strict';
// LOCAL TEST BUILD ONLY. Builds a separate "PressGO Test" installer that:
//   - installs next to (never over) the real PressGO, with its own name, settings and uninstaller
//   - opens the local copy of the site (http://localhost:8081/) instead of the live site
//   - looks for updates in a local folder (http://localhost:8099/), never GitHub
// Usage:  node try-build.js 1.1.0     (then again with 1.1.1)
// Nothing here publishes anything or touches GitHub, Supabase or the real PressGO.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('Give a version, for example: node try-build.js 1.1.0'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const cfg = JSON.parse(JSON.stringify(pkg.build));
cfg.appId = 'com.reliableprinters.pressgo.test';
cfg.productName = 'PressGO Test';
cfg.extraMetadata = { version };
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

fs.writeFileSync(path.join(__dirname, 'test-override.json'), JSON.stringify({ url: 'http://localhost:8081/' }));
fs.writeFileSync(path.join(__dirname, '.test-config.json'), JSON.stringify(cfg, null, 2));
try {
  run('node', ['make-icon.js']);
  run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--config', '.test-config.json']);
} finally {
  fs.rmSync(path.join(__dirname, 'test-override.json'), { force: true });
  fs.rmSync(path.join(__dirname, '.test-config.json'), { force: true });
}
console.log('\nDone. Installer: dist-test/' + version + '/PressGO-Test-Setup.exe');
