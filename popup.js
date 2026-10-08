// Quick-save popup: current tab or whole window into a picked collection.
// Appearance: theme = System/Light/Dark; palette = accent color choice.
// No browser prompt()/confirm() — first collection is named inline.
const $ = (sel) => document.querySelector(sel);

let currentTab = null;

const PALETTES = ['classic', 'ocean', 'sepia', 'nocturne'];
const normalizePalette = (p) => (PALETTES.includes(p) ? p : 'classic');
const normalizeTheme = (t) => (['system', 'light', 'dark'].includes(t) ? t : 'system');

function applyTheme(theme, palette) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.palette = normalizePalette(palette);
}

async function init() {
  const { theme, palette, newtabDefault } = await chrome.storage.local.get(['theme', 'palette', 'newtabDefault']);
  applyTheme(theme, palette);
  $('#picker-theme').value = normalizeTheme(theme);
  $('#picker-palette').value = normalizePalette(palette);
  $('#newtab-default').checked = !!newtabDefault;

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

  // No collections yet: the name input IS the flow — no mystery dropdown.
  if (!cols.length) {
    sel.hidden = true;
    $('#new-collection-row').hidden = false;
    $('#new-collection-name').focus();
  }
}

// Picking "+ New collection…" swaps the dropdown for the name input.
// Escape brings the dropdown back.
function wireNewCollectionInput() {
  const sel = $('#collection');
  const row = $('#new-collection-row');
  sel.addEventListener('change', () => {
    if (sel.value !== 'new') return;
    sel.hidden = true;
    row.hidden = false;
    $('#new-collection-name').focus();
  });
  $('#new-collection-name').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sel.hidden || !sel.options.length) return;
    row.hidden = true;
    sel.hidden = false;
    sel.value = sel.options[0].value;
  });
}

// Resolve where the save lands: picked collection, or the inline-named new one.
async function chosenCollection() {
  const row = $('#new-collection-row');
  if (!row.hidden) {
    const name = $('#new-collection-name').value.trim();
    if (!name) {
      $('#status').textContent = 'Name the collection first.';
      return null;
    }
    return makeCollection(name);
  }
  const sel = $('#collection');
  if (sel.value !== 'new') {
    return { id: sel.value, name: sel.options[sel.selectedIndex].textContent };
  }
  sel.hidden = true;
  row.hidden = false;
  $('#new-collection-name').focus();
  $('#status').textContent = 'Type a collection name above, then save.';
  return null;
}

$('#open-dashboard').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html?direct=1') });
};

// Theme/palette writes here drive the popup and every open dashboard tab.
$('#picker-theme').onchange = async (e) => {
  const theme = e.target.value;
  await chrome.storage.local.set({ theme });
  applyTheme(theme, $('#picker-palette').value);
};

$('#picker-palette').onchange = async (e) => {
  const palette = e.target.value;
  await chrome.storage.local.set({ palette });
  document.documentElement.dataset.palette = palette;
};

// Opt-in: dashboard as the new tab page. Off (default) = Chrome's default NTP.
$('#newtab-default').onchange = async (e) => {
  await chrome.storage.local.set({ newtabDefault: e.target.checked });
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
wireNewCollectionInput();
