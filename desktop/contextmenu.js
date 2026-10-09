'use strict';
// Builds the standard right-click menu for the PressGO window.
// Electron shows NO right-click menu on its own, so this recreates the normal Windows browser menu:
// text editing (Undo/Redo/Cut/Copy/Paste/Paste as plain text/Select all), links, images, and empty areas.
// It is a pure function of the click details, so it can be tested without Electron.

const SAFE_WEB = new Set(['http:', 'https:']);

function webUrl(u) {
  try {
    const x = new URL(u);
    return SAFE_WEB.has(x.protocol) ? x.href : null;
  } catch (e) {
    return null;
  }
}

// params: the 'context-menu' event details from Electron.
// ctx: { copyText(text), copyImageAt(x,y), openExternal(url), saveImage(url), replaceMisspelling(w),
//        addToDictionary(w), canGoBack, goBack(), reload(), isAppUrl(url) }
function buildTemplate(params, ctx) {
  const t = [];
  const sep = () => { if (t.length && t[t.length - 1].type !== 'separator') t.push({ type: 'separator' }); };
  const f = params.editFlags || {};

  if (params.isEditable) {
    if (params.misspelledWord) {
      (params.dictionarySuggestions || []).slice(0, 5).forEach((s) => t.push({ label: s, click: () => ctx.replaceMisspelling(s) }));
      t.push({ label: 'Add to dictionary', click: () => ctx.addToDictionary(params.misspelledWord) });
      sep();
    }
    t.push({ label: 'Undo', role: 'undo', enabled: !!f.canUndo });
    t.push({ label: 'Redo', role: 'redo', enabled: !!f.canRedo });
    sep();
    t.push({ label: 'Cut', role: 'cut', enabled: !!f.canCut });
    t.push({ label: 'Copy', role: 'copy', enabled: !!f.canCopy });
    t.push({ label: 'Paste', role: 'paste', enabled: !!f.canPaste });
    t.push({ label: 'Paste as plain text', role: 'pasteAndMatchStyle', enabled: !!f.canPaste });
    sep();
    t.push({ label: 'Select all', role: 'selectAll', enabled: !!f.canSelectAll });
  } else if (params.selectionText && params.selectionText.trim()) {
    t.push({ label: 'Copy', role: 'copy', enabled: true });
    sep();
    t.push({ label: 'Select all', role: 'selectAll' });
  }

  // Links
  if (params.linkURL) {
    sep();
    const ext = webUrl(params.linkURL);
    if (ext && !(ctx.isAppUrl && ctx.isAppUrl(ext))) {
      t.push({ label: 'Open link in browser', click: () => ctx.openExternal(ext) });
    }
    if (ext || params.linkURL.startsWith('mailto:')) {
      t.push({ label: 'Copy link address', click: () => ctx.copyText(params.linkURL) });
    }
  }

  // Images (chat pictures, artwork previews)
  if (params.mediaType === 'image' && params.srcURL) {
    sep();
    t.push({ label: 'Copy image', click: () => ctx.copyImageAt(params.x, params.y) });
    const src = webUrl(params.srcURL) || (/^data:image\//i.test(params.srcURL) ? params.srcURL : null);
    if (src) t.push({ label: 'Save image as…', click: () => ctx.saveImage(src) });
    const ext = webUrl(params.srcURL);
    if (ext) {
      t.push({ label: 'Open image in browser', click: () => ctx.openExternal(ext) });
      t.push({ label: 'Copy image address', click: () => ctx.copyText(ext) });
    }
  }

  // Empty page area: the usual page-level choices
  if (!t.length) {
    t.push({ label: 'Back', enabled: !!ctx.canGoBack, click: () => ctx.goBack() });
    t.push({ label: 'Reload', click: () => ctx.reload() });
    sep();
    t.push({ label: 'Select all', role: 'selectAll' });
  }

  while (t.length && t[t.length - 1].type === 'separator') t.pop();
  return t;
}

module.exports = { buildTemplate, webUrl };
