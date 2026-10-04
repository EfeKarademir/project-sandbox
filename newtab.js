// TabNest dashboard: sidebar nav, collection sections, card rows, search, import/export.
const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');

const state = { collections: [], items: [], showArchived: false };

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch (_) { return ''; } };
const faviconUrl = (url) => chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32');

// --- Data access ---

function itemsOf(id) {
  return state.items.filter((i) => i.collectionId === id).sort((a, b) => a.position - b.position);
}

async function refresh() {
  state.collections = state.showArchived
    ? await listCollections('only')
    : await listCollections(false);
  state.items = await listItems();
  render();
}

// --- Rendering ---

function render() {
  grid.textContent = '';
  // View already decides the set (Dashboard: non-archived; Archived: archived only).
  const cols = state.collections.sort((a, b) => a.position - b.position);
  $('#empty').hidden = cols.length > 0;
  for (const c of cols) grid.append(sectionEl(c));
  renderResults($('#search').value.trim());
}

function sectionEl(c) {
  const section = el('section', 'section');
  section.draggable = true;
  section.dataset.id = c.id;
  if (c.archivedAt) section.classList.add('archived');

  const head = el('div', 'section-head');

  const badge = el('span', 'badge');
  badge.textContent = c.name;
  badge.title = 'Double-click to rename';
  badge.ondblclick = () => renameCollection(c);

  const n = itemsOf(c.id).length;
  const meta = el('span', 'meta');
  meta.textContent = n === 1 ? '1 tab' : `${n} tabs`;

  const actions = el('div', 'actions');
  const openAll = el('button');
  openAll.textContent = 'Open all';
  openAll.title = 'Open every tab — pick new window or current window';
  openAll.onclick = () => {
    const items = itemsOf(c.id);
    if (!items.length) return;
    openTargetBar(c.name, items.length, (choice) => openCollection(c, choice));
  };

  const archive = el('button');
  archive.textContent = c.archivedAt ? 'Unarchive' : 'Archive';
  archive.onclick = async () => {
    c.archivedAt = c.archivedAt ? undefined : Date.now();
    await putCollection(c);
    refresh();
  };

  const del = el('button');
  del.textContent = 'Delete';
  del.onclick = () => {
    const cnt = itemsOf(c.id).length;
    askBar({
      msg: `Delete "${c.name}" and its ${cnt} tab${cnt === 1 ? '' : 's'}? This cannot be undone.`,
      buttons: [
        { label: 'Cancel' },
        { label: 'Delete', cls: 'ask-danger' },
      ],
      onResult: async (yes) => {
        if (!yes) return;
        await deleteCollectionDeep(c.id);
        refresh();
      },
    });
  };

  actions.append(openAll, archive, del);
  head.append(badge, meta, actions);
  section.append(head);

  const row = el('div', 'row');
  for (const item of itemsOf(c.id)) row.append(tabCardEl(item));
  section.append(row);

  // Drag: reorder collections; drop: external URL saves into this collection.
  section.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-tabnest-col', c.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  section.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-tabnest-col') || externalUrlTypes(e)) {
      e.preventDefault();
      section.classList.add('drop-into');
    }
  });
  section.addEventListener('dragleave', () => section.classList.remove('drop-into'));
  section.addEventListener('drop', async (e) => {
    e.preventDefault();
    section.classList.remove('drop-into');
    const draggedCol = e.dataTransfer.getData('application/x-tabnest-col');
    if (draggedCol && draggedCol !== c.id) {
      await reorderCollections(draggedCol, c.id);
      return;
    }
    const url = externalUrl(e);
    if (url) {
      await makeItem(c.id, { title: hostOf(url), url });
      refresh();
    }
  });

  return section;
}

function tabCardEl(item) {
  const wrap = el('span', 'tab-wrap');
  wrap.draggable = true;
  wrap.dataset.id = item.id;
  wrap.title = `${item.title || item.url}\n${item.url}\nShift+click: open & remove \u00b7 Middle-click: background`;

  const card = el('a', 'tab-card');
  card.href = item.url;

  const ico = el('span', 'tab-ico');
  const img = document.createElement('img');
  img.alt = '';
  img.src = item.favIconUrl || faviconUrl(item.url);
  img.onerror = () => {
    const t = el('span', 'tab-letter');
    t.textContent = (item.title || hostOf(item.url) || '?').trim().charAt(0).toUpperCase() || '?';
    img.replaceWith(t);
  };
  ico.append(img);

  const title = el('span', 'tab-title');
  title.textContent = item.title || hostOf(item.url) || item.url;

  const desc = el('span', 'tab-desc');
  desc.textContent = hostOf(item.url);

  const meta = el('span', 'tab-meta');
  meta.textContent = new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  card.append(ico, title, desc, meta);
  card.addEventListener('click', () => putItem({ ...item, lastOpenedAt: Date.now() }));
  card.addEventListener('click', (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      openItem(item);
      deleteItem(item.id).then(refresh);
    }
  });

  const x = el('button', 'tab-x');
  x.textContent = '\u00d7';
  x.title = 'Remove from collection';
  x.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await deleteItem(item.id);
    refresh();
  };

  wrap.append(card, x);

  // Drag: reorder within the collection.
  wrap.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('application/x-tabnest-item', item.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  wrap.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-tabnest-item')) {
      e.stopPropagation();
      e.preventDefault();
    }
  });
  wrap.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('application/x-tabnest-item')) return;
    e.preventDefault();
    e.stopPropagation();
    reorderItems(e.dataTransfer.getData('application/x-tabnest-item'), item.id);
  });

  return wrap;
}

// --- Actions ---

// One floating bottom bar asks; Esc/outside/Cancel answers null. Replaces
// prompt()/confirm() everywhere — same component, no browser chrome dialogs.
function askBar({ msg, input = false, inputDefault = '', buttons, onResult }) {
  document.querySelector('.ask-bar')?.remove();
  const bar = el('div', 'ask-bar');
  const label = el('span', 'ask-msg');
  label.textContent = msg;
  bar.append(label);
  let field = null;
  if (input) {
    field = document.createElement('input');
    field.type = 'text';
    field.className = 'ask-input';
    field.value = inputDefault;
    field.placeholder = 'Collection name';
    bar.append(field);
  }
  const close = () => {
    bar.remove();
    document.removeEventListener('click', outside);
    document.removeEventListener('keydown', onKey);
  };
  const submit = (result) => { close(); onResult(result); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); submit(null); }
    else if (e.key === 'Enter' && field) { e.preventDefault(); submit(field.value.trim() || null); }
  };
  const outside = (e) => { if (!bar.contains(e.target)) submit(null); };
  for (const b of buttons) {
    const btn = el('button', b.cls);
    btn.textContent = b.label;
    btn.onclick = () => submit(field ? field.value.trim() || null : (b.value ?? null));
    bar.append(btn);
  }
  document.body.append(bar);
  document.addEventListener('click', outside);
  document.addEventListener('keydown', onKey);
  if (field) { field.focus(); field.select(); }
}

async function renameCollection(c) {
  askBar({
    msg: 'Rename collection',
    input: true,
    inputDefault: c.name,
    buttons: [
      { label: 'Cancel' },
      { label: 'Rename', cls: 'ask-primary' },
    ],
    onResult: async (name) => {
      if (!name || name === c.name) return;
      c.name = name;
      await putCollection(c);
      refresh();
    },
  });
}

// Ask where "Open all" should land: current window vs its own window.
function openTargetBar(name, n, onChoose) {
  askBar({
    msg: `Open ${n} tab${n === 1 ? '' : 's'} from "${name}"`,
    buttons: [
      { label: 'Cancel' },
      { label: 'Current window', value: 'current' },
      { label: 'New window', cls: 'ask-primary', value: 'window' },
    ],
    onResult: (choice) => { if (choice) onChoose(choice); },
  });
}

async function openCollection(c, target) {
  const items = itemsOf(c.id);
  if (!items.length) return;
  if (target === 'window') {
    await chrome.windows.create({ url: items.map((i) => i.url) });
  } else {
    for (const i of items) await chrome.tabs.create({ url: i.url });
  }
  const now = Date.now();
  for (const i of items) await putItem({ ...i, lastOpenedAt: now });
}

function openItem(item) {
  chrome.tabs.create({ url: item.url });
  putItem({ ...item, lastOpenedAt: Date.now() });
}

async function reorderCollections(draggedId, targetId) {
  const cols = state.collections.filter((c) => !c.archivedAt).sort((a, b) => a.position - b.position);
  const from = cols.findIndex((c) => c.id === draggedId);
  const to = cols.findIndex((c) => c.id === targetId);
  if (from < 0 || to < 0) return;
  cols.splice(to, 0, cols.splice(from, 1)[0]);
  for (let i = 0; i < cols.length; i++) {
    cols[i].position = i;
    await putCollection(cols[i]);
  }
  refresh();
}

async function reorderItems(draggedId, targetId) {
  const dragged = state.items.find((i) => i.id === draggedId);
  const target = state.items.find((i) => i.id === targetId);
  if (!dragged || !target || dragged.collectionId !== target.collectionId || draggedId === targetId) return;
  const list = itemsOf(dragged.collectionId);
  const from = list.findIndex((i) => i.id === draggedId);
  const to = list.findIndex((i) => i.id === targetId);
  list.splice(to, 0, list.splice(from, 1)[0]);
  for (let i = 0; i < list.length; i++) {
    list[i].position = i;
    await putItem(list[i]);
  }
  refresh();
}

// --- Drag helpers ---

function externalUrlTypes(e) {
  return e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain');
}

function externalUrl(e) {
  const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  return /^https?:\/\//.test(url || '') ? url : null;
}

// --- Search ---

function fuzzy(needle, hay) {
  needle = needle.toLowerCase();
  hay = (hay || '').toLowerCase();
  let i = 0;
  let score = 0;
  let last = -2;
  for (const ch of needle) {
    const idx = hay.indexOf(ch, i);
    if (idx < 0) return -1;
    score += idx === last + 1 ? 3 : 1;
    last = idx;
    i = idx + 1;
  }
  return score;
}

function scoredItems(query) {
  return state.items
    .map((item) => ({
      item,
      s: Math.max(
        fuzzy(query, item.title),
        fuzzy(query, item.url),
        fuzzy(query, (item.tags || []).join(' '))
      ),
    }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 10);
}

function renderResults(query) {
  const box = $('#results');
  box.textContent = '';
  if (!query) {
    box.hidden = true;
    return;
  }
  const hits = scoredItems(query);
  if (!hits.length) {
    const none = el('div', 'no-hits');
    none.textContent = 'No matches.';
    box.append(none);
    box.hidden = false;
    return;
  }
  for (const { item } of hits) {
    const col = state.collections.find((c) => c.id === item.collectionId);
    const row = el('div', 'result');

    const img = document.createElement('img');
    img.alt = '';
    img.src = item.favIconUrl || faviconUrl(item.url);
    img.onerror = () => img.remove();

    const title = el('span');
    title.textContent = item.title || item.url;

    const sub = el('small');
    sub.textContent = (col ? col.name + ' \u00b7 ' : '') + hostOf(item.url);

    row.append(img, title, sub);
    row.onclick = () => {
      openItem(item);
      $('#search').value = '';
      renderResults('');
    };
    box.append(row);
  }
  box.hidden = false;
}

$('#search').addEventListener('input', (e) => renderResults(e.target.value.trim()));
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const hits = scoredItems($('#search').value.trim());
    if (hits.length) {
      openItem(hits[0].item);
      $('#search').value = '';
      renderResults('');
    }
  } else if (e.key === 'Escape') {
    $('#search').value = '';
    renderResults('');
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
  }
});

// --- Topbar buttons ---

$('#btn-new').onclick = () => {
  askBar({
    msg: 'New collection',
    input: true,
    buttons: [
      { label: 'Cancel' },
      { label: 'Create', cls: 'ask-primary' },
    ],
    onResult: async (name) => {
      if (!name) return;
      await makeCollection(name);
      refresh();
    },
  });
};

$('#btn-export').onclick = async () => {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tabnest-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#btn-import').onclick = () => $('#file-import').click();

$('#file-import').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const fail = (msg) => askBar({ msg, buttons: [{ label: 'Close' }] });
  try {
    if (file.name.toLowerCase().endsWith('.json')) {
      askBar({
        msg: 'Import replaces ALL saved data with the file contents. Continue?',
        buttons: [
          { label: 'Cancel' },
          { label: 'Import', cls: 'ask-danger' },
        ],
        onResult: async (yes) => {
          if (!yes) return;
          try {
            await importAll(JSON.parse(await file.text()));
            refresh();
          } catch (err) { fail('Import failed: ' + err.message); }
        },
      });
    } else {
      // Bookmarks HTML (Netscape/Chrome export). Links only, flattened.
      const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
      const links = [...doc.querySelectorAll('a')].filter((a) => /^https?:/.test(a.href));
      if (!links.length) {
        fail('No bookmarks found in this file.');
        return;
      }
      const c = await makeCollection('Imported bookmarks ' + new Date().toLocaleDateString());
      for (const a of links) {
        await makeItem(c.id, { title: a.textContent.trim() || a.href, url: a.href });
      }
      refresh();
    }
  } catch (err) {
    fail('Import failed: ' + err.message);
  }
};

// --- Sidebar nav ---

function updateNav() {
  $('#nav-all').classList.toggle('active', !state.showArchived);
  $('#nav-archived').classList.toggle('active', state.showArchived);
}

async function setArchivedView(on) {
  state.showArchived = on;
  await chrome.storage.local.set({ showArchived: on });
  updateNav();
  render();
}

$('#nav-all').onclick = () => setArchivedView(false);
$('#nav-archived').onclick = () => setArchivedView(true);

// --- Theme & palette ---
// Palette pick is independent of theme (dark/light). `nocturne` ignores theme
// (same look either way); the others re-tint per theme.

const PALETTES = ['classic', 'ocean', 'sepia', 'nocturne'];
const normalizePalette = (p) => (PALETTES.includes(p) ? p : 'classic');

function systemDark() {
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(stored) {
  const dark = stored === 'dark' || ((stored === undefined || stored === 'system') && systemDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// The popup's Theme/Palette selectors write `theme`/`palette`; apply live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.theme) applyTheme(changes.theme.newValue);
  if (changes.palette) document.documentElement.dataset.palette = normalizePalette(changes.palette.newValue);
});

// --- New tab behavior ---
// Override stays in the manifest (static in MV3, no runtime toggle exists).
// Opt-in lives at page level: every new tab lands here first, and unless
// `newtabDefault` is on (or the load carries ?direct=1), the tab is handed to
// Chrome's real default NTP (chrome://new-tab-page) immediately. A sessionStorage
// guard breaks the loop if Chrome bounces chrome://new-tab-page back at us.
// ponytail: one redirect flash per new tab while opted out; swap to a
// declarative approach if Chrome ever ships a runtime chrome_url_overrides API.

function quietPage() {
  // Bounce-back fallback: never loop, never pretend to be the real NTP.
  const box = el('div', 'quiet');
  const h = el('h1');
  h.textContent = 'TabNest';
  const p = el('p');
  p.textContent = 'Alt+Shift+T (or the toolbar popup) opens your dashboard.';
  const b = el('button');
  b.textContent = 'Open dashboard';
  b.onclick = () => { location.href = chrome.runtime.getURL('newtab.html?direct=1'); };
  box.append(h, p, b);
  document.body.textContent = '';
  document.body.append(box);
}

async function newtabGate() {
  if (new URLSearchParams(location.search).has('direct')) return;
  const { newtabDefault } = await chrome.storage.local.get('newtabDefault');
  if (newtabDefault) return; // opted in: dashboard IS the new tab
  if (sessionStorage.getItem('tabnest-ntp-guard')) {
    quietPage();
    return;
  }
  sessionStorage.setItem('tabnest-ntp-guard', '1');
  chrome.runtime.sendMessage({ type: 'goto-default-ntp' });
}

// --- Init ---

window.addEventListener('focus', refresh);

(async function init() {
  await newtabGate();
  const { showArchived, theme, palette } = await chrome.storage.local.get(['showArchived', 'theme', 'palette']);
  state.showArchived = !!showArchived;
  applyTheme(theme);
  document.documentElement.dataset.palette = normalizePalette(palette);
  updateNav();
  await refresh();
})();
