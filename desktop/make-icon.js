'use strict';
// Makes build/icon.png from the PressGO manifest (same step the GitHub build does).
const fs = require('fs');
const path = require('path');
const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'manifest.webmanifest'), 'utf8'));
const i = m.icons.find((x) => x.sizes === '512x512');
if (!i || !i.src.startsWith('data:image/png;base64,')) throw new Error('512px PNG icon not found');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'build', 'icon.png'), Buffer.from(i.src.split(',')[1], 'base64'));
console.log('icon written');
