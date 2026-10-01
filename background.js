importScripts('db.js');

// --- Context menus: "Save tab to TabNest" with top collections + New collection ---

async function refreshMenus() {
  await chrome.contextMenus.removeAll();
  const cols = await listCollections(); // unarchived, position order
  const parent = chrome.contextMenus.create({
    id: 'tabnest-root',
    title: 'Save tab to TabNest',
    contexts: ['page', 'link'],
  });
  for (const c of cols.slice(0, 6)) {
    chrome.contextMenus.create({ id: 'col:' + c.id, parentId: parent, title: c.name, contexts: ['page', 'link'] });
  }
  chrome.contextMenus.create({ id: 'col:new', parentId: parent, title: 'New collection\u2026', contexts: ['page', 'link'] });
}

chrome.runtime.onInstalled.addListener(refreshMenus);
chrome.runtime.onStartup.addListener(refreshMenus);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'collections-changed') refreshMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || (tab && tab.url);
  if (!url || !/^https?:/.test(url)) return;
  const title = info.linkUrl
    ? (info.selectionText || new URL(url).hostname)
    : ((tab && tab.title) || url);
  let collectionId = info.menuItemId === 'col:new' ? null : String(info.menuItemId).slice(4);
  if (!collectionId) {
    const c = await makeCollection('New collection');
    collectionId = c.id;
  }
  await makeItem(collectionId, { title, url });
  flashBadge();
});

// --- Commands ---

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'open-dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
  }
  if (cmd === 'save-all-tabs') {
    await saveAllTabsInWindow();
  }
});

async function saveAllTabsInWindow() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const c = await makeCollection('Session ' + new Date().toLocaleString());
  for (const t of tabs) {
    if (!t.url || !/^https?:/.test(t.url)) continue;
    await makeItem(c.id, { title: t.title || t.url, url: t.url, favIconUrl: t.favIconUrl });
  }
  flashBadge();
}

function flashBadge() {
  chrome.action.setBadgeText({ text: '\u2713' });
  chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}
