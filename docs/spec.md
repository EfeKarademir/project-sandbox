# TabNest — Chrome Tab Manager Extension

**Status:** Draft v0.1 · **Type:** Product + technical spec · **Target:** Chrome (Manifest V3) only

## 1. Overview

Work lives and dies in browser tabs. Heavy users accumulate dozens of tabs, lose
context between tasks, and treat bookmarks as a junk drawer. TabNest replaces the
new tab page with a visual dashboard where open tabs are saved into named
collections and restored on demand — the Toby model, local-first.

## 2. Goals / Non-goals

**Goals**

- Save any open tab(s) into a collection in ≤ 2 clicks.
- Restore a single tab or a whole collection on demand.
- Find any saved tab in < 2 seconds via keyboard-driven search.
- All data stays local. No account, no server, no tracking.

**Non-goals (v1)**

- Cloud sync, accounts, team sharing (Phase 2/3 sketches only).
- Mobile. Cross-browser. AI auto-organization.

## 3. Users & journeys

Primary persona: knowledge worker or researcher with 20–100 tabs open.

- **Save session:** 15 research tabs open, task done. One click in the popup
  saves all of them into a new named collection. Window closes guilt-free.
  Next day: one click restores the set.
- **Park a tab:** Article in the way of the current task. Right-click →
  "Save to collection". Dashboard holds it.
- **Find:** Ctrl+K, type a few letters, Enter. Tab opens.

## 4. Functional requirements (MVP)

| ID | Requirement |
|----|-------------|
| FR-1 | **New Tab dashboard.** Override `chrome://newtab`. Grid of collections; each tab renders as a card with favicon, title, and domain. |
| FR-2 | **Collections.** Create, rename, delete, reorder via drag & drop, archive. |
| FR-3 | **Save tabs.** Save active tab, selected tabs, or all tabs in window. Entry points: popup button, context menu "Save tab to collection", drag a URL onto the dashboard. |
| FR-4 | **Restore.** Open single tab, open whole collection, or open collection in a new window. Modes: open-and-keep, open-and-remove. |
| FR-5 | **Search.** Ctrl+K palette. Fuzzy match over title, URL, and tags. Enter opens the top hit. |
| FR-6 | **Quick-access popup.** Browser action popup: save current tab, pick collection, recent collections listed first. |
| FR-7 | **Keyboard shortcuts.** Chrome extension commands: open dashboard, save all tabs, open search palette. |
| FR-8 | **Import / export.** Export all data to JSON. Import JSON. Import Chrome bookmarks HTML. |

## 5. Out of scope for v1

Sync (Phase 2), sharing (Phase 3), duplicate/dead-link cleanup, usage
statistics pages.

## 6. Non-functional requirements

- **Performance:** dashboard first paint < 500 ms with 5,000 saved tabs; search
  keystroke latency < 100 ms.
- **Privacy:** no third-party requests. Favicons come from tab data captured at
  save time. Data never leaves the device.
- **Accessibility:** WCAG 2.1 AA; the dashboard is fully keyboard-operable.
- **Data safety:** IndexedDB plus `navigator.storage.persist()`; export is the
  manual backup path.
- **Capacity:** designed for 10,000 saved tabs.

## 7. Architecture

Chrome only, Manifest V3.

**Components**

- New tab page (dashboard) — bundled SPA, no remote code (MV3 CSP).
- Action popup — quick save.
- Service worker — routes context-menu and command events only.
- Options page — import/export, data management.

**Permissions (minimal, justified)**

- `tabs` — read title/URL/favicon of tabs being saved.
- `storage` — settings.
- `contextMenus` — right-click save.
- `favicon` — display favicons without host permissions.
- `unlimitedStorage` — headroom above browser quota.

**Storage:** IndexedDB (one database, two object stores). `chrome.storage.local`
is awkward and quota-bound for 10k structured records; it holds settings only.

**Data model**

```ts
interface Collection {
  id: string;            // uuid
  name: string;
  position: number;      // order in dashboard
  createdAt: number;
  archivedAt?: number;   // present = archived
}

interface TabItem {
  id: string;            // uuid
  collectionId: string;
  title: string;
  url: string;
  favIconUrl?: string;   // captured at save time
  tags: string[];        // free-form, lowercase
  position: number;
  createdAt: number;
  lastOpenedAt?: number;
}
```

Tags are plain strings on items. No separate tag entity.

## 8. UI / UX

- Dashboard: header with search bar and quick actions, then a collection grid.
  Collection card shows name, tab count, and favicon + title chips.
- Drag & drop: chips reorder within a collection; collections reorder in the
  grid; a URL dragged from the browser onto a collection card saves it.
- Empty state: three-step hint (save your first tab → name the collection →
  restore it).
- Tab context menu: "Save to TabNest" submenu with top collections and
  "New collection".
- Middle-click a chip to open in a background tab.

## 9. Milestones

- **Phase 1 — MVP (this spec):** FR-1 through FR-8, fully local.
- **Phase 2 — Sync (sketch, not committed):** optional account, encrypted
  sync, per-collection merge with last-write-wins conflict resolution.
- **Phase 3 — Sharing (sketch):** share a collection via link, team
  workspaces.

## 10. Success metrics

- Activation: first collection created within the first session.
- Weekly saves per active user ≥ 5.
- Restore rate: ≥ 30% of saved tabs reopened within 30 days.
- Dashboard paint p95 < 500 ms.

## 11. Risks & open questions

| Risk | Mitigation |
|------|------------|
| IndexedDB eviction under storage pressure | `navigator.storage.persist()` plus periodic export reminder. |
| MV3 service worker lifetime | All writes originate in UI contexts; worker only routes events. |
| Favicon fetch privacy | Favicons captured from tab data at save time; no favicon service. |
| Bookmarks HTML parser scope | Support the Chrome export format only; skip unreadable rows. |
| Open: product name | Working title "TabNest". |
