const grid = document.querySelector('#gameGrid');
const search = document.querySelector('#gameSearch');
const filter = document.querySelector('#gameFilter');
const sort = document.querySelector('#gameSort');
const count = document.querySelector('#gameCount');
const status = document.querySelector('#feedStatus');
const empty = document.querySelector('#emptyState');
const refresh = document.querySelector('#refresh');
const menu = document.querySelector('#mainNav');
const toggle = document.querySelector('#navToggle');
const header = document.querySelector('.site-header');
const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' });
const mechanics = {
  incremental: 'Инкрементал',
  physics: 'Физика и машины',
  party: 'Пати и PvP',
  simulator: 'Симулятор'
};
let games = [];
let loaded = false;
let lastCheck;

function element(tag, className, content) {
  const node = document.createElement(tag);
  node.className = className;
  if (content) node.textContent = content;
  return node;
}

function showStatus(state, message) {
  status.dataset.state = state;
  status.replaceChildren(element('span', 'status-dot'), message);
}

function showMenu(open) {
  header.classList.toggle('nav-open', open);
  toggle.setAttribute('aria-expanded', String(open));
}

toggle.addEventListener('click', () => showMenu(toggle.getAttribute('aria-expanded') === 'false'));
menu.addEventListener('click', event => {
  if (event.target.closest('a')) showMenu(false);
});
header.addEventListener('keydown', event => {
  if (event.key === 'Escape' && header.classList.contains('nav-open')) {
    showMenu(false);
    toggle.focus();
  }
});

function card(game) {
  const link = element('a', 'game-card');
  link.href = `https://store.steampowered.com/app/${game.id}/`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${game.name} — открыть в Steam`);

  const media = element('div', 'game-card-media');
  const image = element('img', 'game-card-image');
  image.alt = '';
  image.loading = 'lazy';
  image.src = game.image || '/assets/game-placeholder.svg';
  image.addEventListener('error', () => { image.src = '/assets/game-placeholder.svg'; }, { once: true });
  const arrow = element('span', 'game-card-play');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M9 6h9v9"/></svg>';
  media.append(image, arrow);

  const caption = element('div', 'game-card-overlay');
  const description = element('p', 'game-card-description', game.description);
  description.lang = 'en';
  description.title = game.description;
  const meta = element('div', 'game-card-stats');
  const date = element('time', 'game-date', `Замечено ${dateFormat.format(new Date(game.firstSeen))}`);
  date.dateTime = game.firstSeen;
  date.title = 'Дата первого обнаружения страницы';
  meta.append(element('span', 'game-chip', mechanics[game.mechanic]), element('span', '', 'Скоро выйдет'), date);
  caption.append(element('h2', 'game-card-title', game.name), description, meta);
  link.append(media, caption);
  return link;
}

function render() {
  if (!loaded) return;
  const query = search.value.trim().toLowerCase();
  const newestFirst = (a, b) => b.firstSeen.localeCompare(a.firstSeen) || b.id - a.id;
  const visible = games
    .filter(game => (!filter.value || game.mechanic === filter.value) &&
      `${game.name} ${game.description} ${mechanics[game.mechanic]}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (sort.value === 'name') return a.name.localeCompare(b.name);
      if (sort.value === 'fit') return b.score - a.score || newestFirst(a, b);
      return newestFirst(a, b);
    });
  grid.replaceChildren(...visible.map(card));
  count.textContent = visible.length === games.length ? `Игр: ${games.length}` : `${visible.length} из ${games.length}`;
  empty.hidden = visible.length > 0;
  empty.textContent = query || filter.value
    ? 'По этому запросу игр нет.'
    : 'Пока нет новых страниц, которые подошли под фильтр.';
}

async function load() {
  if (refresh.disabled) return;
  refresh.disabled = true;
  grid.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/games', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.games)) throw new Error('Invalid feed');
    if (!loaded || data.checkedAt !== lastCheck) {
      games = data.games;
      lastCheck = data.checkedAt;
      loaded = true;
      render();
    }
    if (data.checkedAt) {
      const timestamp = new Date(data.checkedAt);
      const stale = Date.now() - timestamp.getTime() > 90 * 60 * 1000;
      showStatus(stale ? 'error' : 'ready', stale
        ? `Обновление задерживается · ${timeFormat.format(timestamp)}`
        : `Steam проверен ${timeFormat.format(timestamp)}`);
    } else {
      showStatus('loading', 'Ждём первую проверку Steam');
    }
  } catch {
    showStatus('error', loaded ? 'Не удалось обновить. Показана последняя подборка.' : 'Не удалось подключиться к ленте.');
    if (!loaded) {
      grid.replaceChildren();
      empty.textContent = 'Попробуй обновить ленту через минуту.';
      empty.hidden = false;
    }
  } finally {
    refresh.disabled = false;
    grid.setAttribute('aria-busy', 'false');
  }
}

for (const input of [search, filter, sort]) input.addEventListener('input', render);
refresh.addEventListener('click', load);
for (let index = 0; index < 3; index += 1) {
  const skeleton = element('div', 'game-card is-loading');
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.append(element('div', 'game-card-media'), element('div', 'game-card-overlay'));
  grid.append(skeleton);
}
load();
setInterval(() => { if (!document.hidden) load(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
