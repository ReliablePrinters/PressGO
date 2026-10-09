'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildTemplate } = require('../contextmenu');

const ctx = (calls = []) => ({
  copyText: (t) => calls.push(['copy', t]), copyImageAt: (x, y) => calls.push(['img', x, y]), openExternal: (u) => calls.push(['open', u]),
  saveImage: (u) => calls.push(['save', u]), replaceMisspelling: (w) => calls.push(['fix', w]), addToDictionary: (w) => calls.push(['dict', w]),
  canGoBack: false, goBack() {}, reload: () => calls.push(['reload']),
  isAppUrl: (u) => u.startsWith('https://reliableprinters.github.io/PressGO/')
});
const labels = (t) => t.filter((x) => x.type !== 'separator').map((x) => x.label);

test('text fields: Undo, Redo, Cut, Copy, Paste, Paste as plain text, Select all', () => {
  const t = buildTemplate({ isEditable: true, editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }, ctx());
  assert.deepEqual(labels(t), ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Paste as plain text', 'Select all']);
  assert.equal(t.find((x) => x.label === 'Redo').enabled, false);
  assert.equal(t.find((x) => x.label === 'Paste as plain text').role, 'pasteAndMatchStyle');
});

test('misspelled word in a text box offers suggestions first', () => {
  const calls = [];
  const t = buildTemplate({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], editFlags: {} }, ctx(calls));
  assert.deepEqual(labels(t).slice(0, 3), ['the', 'ten', 'Add to dictionary']);
  t[0].click();
  assert.deepEqual(calls[0], ['fix', 'the']);
});

test('selected page text: Copy and Select all', () => {
  const t = buildTemplate({ selectionText: 'Kingston Bakery', editFlags: {} }, ctx());
  assert.deepEqual(labels(t), ['Copy', 'Select all']);
});

test('external link: open in browser and copy address', () => {
  const calls = [];
  const t = buildTemplate({ linkURL: 'https://example.com/a?b=1', editFlags: {} }, ctx(calls));
  assert.deepEqual(labels(t), ['Open link in browser', 'Copy link address']);
  t[0].click(); t[1].click();
  assert.deepEqual(calls, [['open', 'https://example.com/a?b=1'], ['copy', 'https://example.com/a?b=1']]);
});

test('link inside PressGO: copy only (it already opens in the app)', () => {
  const t = buildTemplate({ linkURL: 'https://reliableprinters.github.io/PressGO/#/job/1', editFlags: {} }, ctx());
  assert.deepEqual(labels(t), ['Copy link address']);
});

test('dangerous link types are never opened', () => {
  for (const u of ['javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'data:text/html,<script>1</script>']) {
    const t = buildTemplate({ linkURL: u, editFlags: {} }, ctx());
    assert.ok(!labels(t).includes('Open link in browser'), u);
  }
});

test('chat/artwork image: copy, save as, open, copy address', () => {
  const calls = [];
  const t = buildTemplate({ mediaType: 'image', srcURL: 'https://x.supabase.co/storage/v1/object/sign/a/b.png?token=t', x: 10, y: 20, editFlags: {} }, ctx(calls));
  assert.deepEqual(labels(t), ['Copy image', 'Save image as\u2026', 'Open image in browser', 'Copy image address']);
  t.find((x) => x.label === 'Copy image').click();
  t.find((x) => x.label.startsWith('Save image')).click();
  assert.deepEqual(calls, [['img', 10, 20], ['save', 'https://x.supabase.co/storage/v1/object/sign/a/b.png?token=t']]);
});

test('pasted preview image (blob:) can be copied but not opened outside', () => {
  const t = buildTemplate({ mediaType: 'image', srcURL: 'blob:https://reliableprinters.github.io/abc', x: 1, y: 1, editFlags: {} }, ctx());
  assert.deepEqual(labels(t), ['Copy image']);
});

test('image that is also a link (chat pictures) shows both sets', () => {
  const t = buildTemplate({ mediaType: 'image', srcURL: 'https://x.co/p.png', linkURL: 'https://x.co/p.png', editFlags: {} }, ctx());
  assert.deepEqual(labels(t), ['Open link in browser', 'Copy link address', 'Copy image', 'Save image as\u2026', 'Open image in browser', 'Copy image address']);
});

test('empty page area: Back, Reload, Select all; no stray separators', () => {
  const t = buildTemplate({ editFlags: {} }, ctx());
  assert.deepEqual(labels(t), ['Back', 'Reload', 'Select all']);
  assert.equal(t[0].enabled, false);
  assert.notEqual(t.at(-1).type, 'separator');
});
