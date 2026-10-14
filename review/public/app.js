// Review grid. Plain browser JS, no build step; Cropper.js is loaded as a global from /vendor.
const PAGE_SIZE = 60;

const state = {
  tab: 'crops',
  items: { crops: [], auto: [], rescue: [] },
  review: {},
  undecidedOnly: false,
  page: 0,
  focus: 0,
  selected: new Set(),
  anchor: null,
  thumbVersion: {},
};

const $ = (id) => document.getElementById(id);
const grid = $('grid');

async function load() {
  const res = await fetch('/api/items');
  const data = await res.json();
  state.items = { crops: data.crops, auto: data.auto, rescue: data.rescue };
  state.review = data.review;
  render();
}

const decisionOf = (item) => state.review[item.cropId]?.decision;

function visibleItems() {
  const items = state.items[state.tab];
  return state.undecidedOnly ? items.filter((i) => !decisionOf(i)) : items;
}

function pageItems() {
  return visibleItems().slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
}

function pageCount() {
  return Math.max(1, Math.ceil(visibleItems().length / PAGE_SIZE));
}

function render() {
  state.page = Math.min(state.page, pageCount() - 1);
  const items = pageItems();
  state.focus = Math.min(state.focus, Math.max(0, items.length - 1));

  grid.replaceChildren(
    ...items.map((item, i) => {
      const entry = state.review[item.cropId] ?? {};
      const tile = document.createElement('div');
      tile.className = 'tile';
      if (entry.decision) tile.classList.add(entry.decision);
      if (i === state.focus) tile.classList.add('focused');
      if (state.selected.has(item.cropId)) tile.classList.add('selected');
      tile.dataset.index = String(i);
      const v = state.thumbVersion[item.cropId] ?? 0;
      tile.innerHTML = `
        <img loading="lazy" src="/thumb/${encodeURIComponent(item.cropId)}?v=${v}" alt="">
        ${entry.decision ? `<span class="badge ${entry.decision}">${entry.decision}</span>` : state.tab === 'auto' ? '<span class="badge keep">auto</span>' : ''}
        ${entry.box ? '<span class="badge boxed">box</span>' : ''}
        <div class="cap"></div>`;
      tile.querySelector('.cap').textContent =
        `${item.catScore.toFixed(2)}${item.detScore != null ? ` · det ${item.detScore.toFixed(2)}` : ''}` +
        `${item.fallback ? ' · whole' : ''} · ${item.title}`;
      tile.addEventListener('click', (e) => onClick(e, i));
      tile.addEventListener('mouseenter', () => showPreview(item));
      tile.addEventListener('mouseleave', () => showPreview(items[state.focus]));
      return tile;
    }),
  );

  $('page').textContent = `Page ${state.page + 1} / ${pageCount()}`;
  $('count-crops').textContent = `(${state.items.crops.length})`;
  $('count-auto').textContent = `(${state.items.auto.length})`;
  $('count-rescue').textContent = `(${state.items.rescue.length})`;
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab));

  const all = state.items[state.tab];
  const counts = { keep: 0, star: 0, reject: 0 };
  for (const i of all) {
    const d = decisionOf(i);
    if (d) counts[d]++;
  }
  const decided = counts.keep + counts.star + counts.reject;
  $('progress').textContent =
    state.tab === 'auto'
      ? `${all.length - counts.reject} kept · ${counts.reject} rejected by you · ${all.length - decided} not checked (they stay kept)`
      : `${decided} / ${all.length} decided · ${counts.keep} kept · ${counts.star} starred · ${counts.reject} rejected · ` +
        `${all.length - decided} undecided`;
  showPreview(items[state.focus]);
  grid.children[state.focus]?.scrollIntoView({ block: 'nearest' });
}

function showPreview(item) {
  const box = $('preview');
  if (!item) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('preview-img').src = `/images/${encodeURIComponent(item.artworkId)}.jpg`;
  const parts = [item.title, item.artist, item.date].filter(Boolean);
  $('preview-text').textContent = parts.join(' — ');
}

function onClick(e, i) {
  const items = pageItems();
  const id = items[i].cropId;
  if (e.shiftKey && state.anchor != null) {
    const [a, b] = [Math.min(state.anchor, i), Math.max(state.anchor, i)];
    for (let j = a; j <= b; j++) state.selected.add(items[j].cropId);
  } else if (e.metaKey || e.ctrlKey) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    state.anchor = i;
  } else {
    state.selected.clear();
    state.anchor = i;
  }
  state.focus = i;
  render();
}

/** Ids the next action applies to: the selection if there is one, else the focused tile. */
function targets() {
  if (state.selected.size) return [...state.selected];
  const item = pageItems()[state.focus];
  return item ? [item.cropId] : [];
}

// Saves go out in order; local state changes immediately so fast typing never lands on a stale tile.
let saving = Promise.resolve();

function update(ids, body) {
  if (!ids.length) return;
  const rescue = state.tab === 'rescue';
  const auto = state.tab === 'auto';
  for (const id of ids) {
    const entry = (state.review[id] ??= {});
    if (body.decision === null) delete entry.decision;
    else if (body.decision) entry.decision = body.decision;
    if (body.box) entry.box = body.box;
    if (rescue) entry.rescue = true;
    if (auto) entry.auto = true;
  }
  const payload = JSON.stringify({ ids, ...body, rescue, auto });
  saving = saving
    .then(() => fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }))
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    })
    .catch((err) => {
      alert(`Saving failed (${err.message}). Is the review server still running?`);
    });
}

function decide(decision) {
  const ids = targets();
  const wasBulk = state.selected.size > 0;
  update(ids, { decision });
  state.selected.clear();
  // With "undecided only" the decided tile drops out, so the next one slides into the focus slot.
  if (!wasBulk && !(state.undecidedOnly && decision)) move(1);
  render();
}

function move(delta) {
  const n = pageItems().length;
  const next = state.focus + delta;
  if (next >= n && state.page < pageCount() - 1) {
    state.page++;
    state.focus = 0;
  } else if (next < 0 && state.page > 0) {
    state.page--;
    state.focus = PAGE_SIZE - 1;
  } else {
    state.focus = Math.max(0, Math.min(n - 1, next));
  }
}

function columns() {
  const tiles = grid.children;
  if (tiles.length < 2) return 1;
  const top = tiles[0].offsetTop;
  let c = 0;
  while (c < tiles.length && tiles[c].offsetTop === top) c++;
  return c;
}

function setPage(p) {
  state.page = Math.max(0, Math.min(pageCount() - 1, p));
  state.focus = 0;
  state.selected.clear();
  render();
  window.scrollTo(0, 0);
}

// ---------- Fix crop ----------
let cropper = null;
let fixing = null;

function openFix() {
  const item = pageItems()[state.focus];
  if (!item) return;
  fixing = item;
  const dialog = $('fix');
  const img = $('fix-img');
  dialog.showModal();
  img.onload = () => {
    cropper?.destroy();
    const box = state.review[item.cropId]?.box ?? item.cropBox ?? { x: 0, y: 0, w: 1, h: 1 };
    cropper = new Cropper(img, {
      viewMode: 1,
      autoCropArea: 1,
      zoomable: false,
      background: false,
      ready() {
        const { naturalWidth: w, naturalHeight: h } = img;
        cropper.setData({ x: box.x * w, y: box.y * h, width: box.w * w, height: box.h * h });
      },
    });
  };
  img.src = `/images/${encodeURIComponent(item.artworkId)}.jpg?fix=${Date.now()}`;
}

async function saveFix() {
  if (!cropper || !fixing) return;
  const img = $('fix-img');
  const d = cropper.getData(true);
  const box = {
    x: d.x / img.naturalWidth,
    y: d.y / img.naturalHeight,
    w: d.width / img.naturalWidth,
    h: d.height / img.naturalHeight,
  };
  const decision = decisionOf(fixing) && decisionOf(fixing) !== 'reject' ? undefined : 'keep';
  update([fixing.cropId], { box, decision });
  state.thumbVersion[fixing.cropId] = Date.now();
  closeFix();
  render();
}

function closeFix() {
  cropper?.destroy();
  cropper = null;
  fixing = null;
  if ($('fix').open) $('fix').close();
}

$('fix-save').addEventListener('click', saveFix);
$('fix-cancel').addEventListener('click', closeFix);
$('fix').addEventListener('close', closeFix);

// ---------- Controls ----------
document.addEventListener('keydown', (e) => {
  if ($('fix').open) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveFix();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  const actions = {
    arrowright: () => (move(1), render()),
    arrowleft: () => (move(-1), render()),
    arrowdown: () => (move(columns()), render()),
    arrowup: () => (move(-columns()), render()),
    pagedown: () => setPage(state.page + 1),
    pageup: () => setPage(state.page - 1),
    k: () => decide('keep'),
    x: () => decide('reject'),
    s: () => decide('star'),
    u: () => decide(null),
    r: () => openFix(),
    escape: () => (state.selected.clear(), render()),
  };
  if (actions[key]) {
    e.preventDefault();
    actions[key]();
  }
});

for (const b of document.querySelectorAll('.tab')) {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    setPage(0);
  });
}
$('undecided').addEventListener('change', (e) => {
  state.undecidedOnly = e.target.checked;
  setPage(0);
});
$('prev').addEventListener('click', () => setPage(state.page - 1));
$('next').addEventListener('click', () => setPage(state.page + 1));
$('reject-rest').addEventListener('click', () => {
  const ids = pageItems()
    .filter((i) => !decisionOf(i))
    .map((i) => i.cropId);
  if (!ids.length || !confirm(`Reject the ${ids.length} undecided items on this page?`)) return;
  update(ids, { decision: 'reject' });
  render();
});

load();
