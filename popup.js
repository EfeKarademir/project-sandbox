// Quick-save popup: current tab or whole window into a picked collection.
const $ = (sel) => document.querySelector(sel);

let currentTab = null;

async function init() {
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const cols = (await listCollections()).sort((a, b) => b.createdAt - a.createdAt); // recent first
  const sel = $('#collection');
  sel.textContent = '';
  for (const c of cols) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    sel.append(o);
  }
  const o = document.createElement('option');
  o.value = 'new';
  o.textContent = '+ New collection\u2026';
  sel.append(o);
  if (!cols.length) sel.value = 'new';
}

async function chosenCollection() {
  const sel = $('#collection');
  if (sel.value !== 'new') {
    return { id: sel.value, name: sel.options[sel.selectedIndex].textContent };
  }
  const name = prompt('New collection name');
  if (!name) return null;
  return makeCollection(name);
}

$('#open-dashboard').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
};

$('#save-tab').onclick = async () => {
  const c = await chosenCollection();
  if (!c) return;
  if (!currentTab || !/^https?:/.test(currentTab.url || '')) {
    $('#status').textContent = 'Cannot save this page.';
    return;
  }
  await makeItem(c.id, {
    title: currentTab.title || currentTab.url,
    url: currentTab.url,
    favIconUrl: currentTab.favIconUrl,
  });
  done();
};

$('#save-window').onclick = async () => {
  const c = await chosenCollection();
  if (!c) return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const t of tabs) {
    if (/^https?:/.test(t.url || '')) {
      await makeItem(c.id, { title: t.title || t.url, url: t.url, favIconUrl: t.favIconUrl });
    }
  }
  done();
};

function done() {
  $('#status').textContent = 'Saved \u2713';
  setTimeout(() => window.close(), 600);
}

init();
