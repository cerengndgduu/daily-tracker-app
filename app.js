/* ==========================================================
   RITUAL — habit tracker (vanilla JS, localStorage backed)
   ========================================================== */

// ------- Helpers -------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const todayKey = (d = new Date()) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const isoWeekKey = (d = new Date()) => {
  // ISO week: Monday-based. Returns YYYY-Www
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const fmtDayLong = d => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

// ------- Default state -------
const DEFAULTS = {
  version: 1,
  settings: {
    waterGoalMl: 2500,
    caffeineGoalMg: 400,
    morningSteps: ['Sunscreen', 'Hair serum', 'Vitamins', 'Biotin', 'Collagen', 'Daily photo'],
    eveningSteps: ['Skincare', 'Minoxidil', 'Scalp massage', 'Eye patches', 'Eye massage'],
    weeklyHabits: [
      { name: 'Hair oiling', target: 2 },
      { name: 'Microneedle head', target: 1 }
    ],
    monthlyHabits: [
      { name: 'Microneedle face', target: 1 }
    ]
  },
  // days: keyed YYYY-MM-DD
  days: {},
  // weeks: keyed YYYY-Www  -> { habitName: count }
  weeks: {},
  // months: keyed YYYY-MM   -> { habitName: count }
  months: {},
  // photos: keyed YYYY-MM-DD -> dataURL (small)
  photos: {}
};

const STORE_KEY = 'ritual.state.v1';

// ------- Load / Save -------
let state;
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    state = raw ? Object.assign({}, structuredClone(DEFAULTS), JSON.parse(raw)) : structuredClone(DEFAULTS);
    // Backfill missing top-level keys after schema additions
    for (const k of Object.keys(DEFAULTS)) if (!(k in state)) state[k] = structuredClone(DEFAULTS[k]);
    state.settings = Object.assign({}, DEFAULTS.settings, state.settings || {});
  } catch {
    state = structuredClone(DEFAULTS);
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
}

// Get/create the data record for a specific date.
function dayRec(key) {
  if (!state.days[key]) {
    state.days[key] = {
      morning: {},  // step name -> bool
      evening: {},
      water: 0,
      waterLog: [],          // { t: ms, ml: number }
      caffeine: 0,
      caffeineLog: [],       // { t: ms, mg: number, label: string }
      workout: '',           // 'trained' | 'rest' | ''
      workoutNote: '',
      sleepH: null,
      rhrBpm: null,
      hrvMs: null,
      stress: ''             // 'Low' | 'Medium' | 'High'
    };
  }
  return state.days[key];
}

// ------- App state -------
let currentDateKey = todayKey();
let currentView = 'today';

// ------- Theme -------
(function initTheme() {
  const root = document.documentElement;
  let pref = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', pref);
  const t = $('[data-theme-toggle]');
  const swapIcon = (mode) => {
    t.innerHTML = mode === 'dark'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  };
  swapIcon(pref);
  t.addEventListener('click', () => {
    pref = pref === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', pref);
    swapIcon(pref);
    if (currentView === 'insights') renderInsights();
  });
})();

// ------- Date strip -------
function renderDateStrip() {
  const bar = $('#datebar');
  bar.innerHTML = '';
  const today = new Date(); today.setHours(0,0,0,0);
  // Show last 14 days
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = todayKey(d);
    const pill = document.createElement('button');
    pill.className = 'day-pill';
    if (key === currentDateKey) pill.classList.add('active');
    if (key === todayKey()) pill.classList.add('today');
    pill.innerHTML = `<span class="dow">${d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,3)}</span><span class="num">${d.getDate()}</span>`;
    pill.addEventListener('click', () => { currentDateKey = key; renderDateStrip(); renderToday(); });
    bar.appendChild(pill);
  }
  // scroll to end (today)
  bar.scrollLeft = bar.scrollWidth;
}

// ------- Hero copy -------
function renderHero() {
  const d = new Date(currentDateKey + 'T00:00:00');
  $('#todayEyebrow').textContent = currentDateKey === todayKey() ? 'Today' : fmtDayLong(d);
  const hour = new Date().getHours();
  let greeting = 'Good morning.';
  if (hour >= 12 && hour < 18) greeting = 'Good afternoon.';
  else if (hour >= 18 || hour < 5) greeting = 'Good evening.';
  $('#todayTitle').textContent = currentDateKey === todayKey() ? greeting : fmtDayLong(d);
  // summary line
  const rec = dayRec(currentDateKey);
  const parts = [];
  const total = state.settings.morningSteps.length + state.settings.eveningSteps.length;
  let done = 0;
  state.settings.morningSteps.forEach(s => rec.morning[s] && done++);
  state.settings.eveningSteps.forEach(s => rec.evening[s] && done++);
  parts.push(`${done}/${total} routines`);
  parts.push(`${rec.water} ml water`);
  parts.push(`${rec.caffeine} mg caffeine`);
  $('#todaySummary').textContent = parts.join(' · ');
}

// ------- Rings -------
const RING_C = 2 * Math.PI * 34; // 213.6
function setRing(el, pct) { el.style.strokeDashoffset = String(RING_C * (1 - Math.min(1, pct))); }

function renderRings() {
  const rec = dayRec(currentDateKey);
  const total = state.settings.morningSteps.length + state.settings.eveningSteps.length;
  let done = 0;
  state.settings.morningSteps.forEach(s => rec.morning[s] && done++);
  state.settings.eveningSteps.forEach(s => rec.evening[s] && done++);
  const routinePct = total ? done / total : 0;
  setRing($('#ringRoutines'), routinePct);
  $('#ringRoutinesText').textContent = Math.round(routinePct * 100) + '%';

  const waterPct = Math.min(1, rec.water / state.settings.waterGoalMl);
  setRing($('#ringWater'), waterPct);
  $('#ringWaterText').textContent = Math.round(waterPct * 100) + '%';

  const caffPct = Math.min(1, rec.caffeine / state.settings.caffeineGoalMg);
  setRing($('#ringCaffeine'), caffPct);
  $('#ringCaffeineText').textContent = Math.round(caffPct * 100) + '%';
}

// ------- Loggers -------
function renderLoggers() {
  const rec = dayRec(currentDateKey);
  // Water
  $('#waterAmount').textContent = rec.water;
  $('#waterGoal').textContent = state.settings.waterGoalMl;
  const wPct = Math.min(1, rec.water / state.settings.waterGoalMl);
  $('#waterBar').style.width = (wPct * 100) + '%';
  const wb = $('#waterBadge');
  if (rec.water >= state.settings.waterGoalMl) { wb.textContent = 'Excellent'; wb.className = 'badge good'; }
  else if (rec.water >= state.settings.waterGoalMl * 0.5) { wb.textContent = 'On track'; wb.className = 'badge warn'; }
  else { wb.textContent = 'Insufficient'; wb.className = 'badge bad'; }

  // Caffeine
  $('#caffeineAmount').textContent = rec.caffeine;
  $('#caffeineGoal').textContent = state.settings.caffeineGoalMg;
  const cPct = Math.min(1, rec.caffeine / state.settings.caffeineGoalMg);
  $('#caffeineBar').style.width = (cPct * 100) + '%';
  const cb = $('#caffeineBadge');
  if (rec.caffeine === 0) { cb.textContent = 'None'; cb.className = 'badge'; }
  else if (rec.caffeine <= state.settings.caffeineGoalMg) { cb.textContent = 'Within cap'; cb.className = 'badge good'; }
  else { cb.textContent = 'Over cap'; cb.className = 'badge bad'; }
}

// ------- Routines -------
function renderRoutines() {
  const rec = dayRec(currentDateKey);
  const renderList = (id, steps, kind) => {
    const ul = $(id); ul.innerHTML = '';
    steps.forEach((step, i) => {
      const li = document.createElement('li');
      li.className = 'check';
      const inputId = `${kind}-${i}`;
      const checked = !!rec[kind][step];
      li.innerHTML = `
        <input type="checkbox" id="${inputId}" ${checked ? 'checked' : ''} />
        <span class="check-box"></span>
        <span class="check-label">${escapeHtml(step)}</span>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const cb = li.querySelector('input'); cb.checked = !cb.checked;
        rec[kind][step] = cb.checked;
        save(); renderRings(); renderHero(); renderStreaks();
      });
      li.querySelector('input').addEventListener('change', (e) => {
        rec[kind][step] = e.target.checked;
        save(); renderRings(); renderHero(); renderStreaks();
      });
      ul.appendChild(li);
    });
  };
  renderList('#checklistMorning', state.settings.morningSteps, 'morning');
  renderList('#checklistEvening', state.settings.eveningSteps, 'evening');
  renderStreaks();
}

function streakFor(kind) {
  const steps = kind === 'morning' ? state.settings.morningSteps : state.settings.eveningSteps;
  if (steps.length === 0) return 0;
  let streak = 0;
  const d = new Date(); d.setHours(0,0,0,0);
  // If today is incomplete, don't break the streak — start counting from yesterday.
  let started = false;
  for (let i = 0; i < 365; i++) {
    const k = todayKey(d);
    const rec = state.days[k];
    const allDone = rec && steps.every(s => rec[kind][s]);
    if (allDone) { streak++; started = true; }
    else if (!started && i === 0) {
      // skip today
    } else {
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function renderStreaks() {
  $('#streakMorning').textContent = `🔥 ${streakFor('morning')}`;
  $('#streakEvening').textContent = `🌙 ${streakFor('evening')}`;
}

// ------- Body / workout / photo -------
function renderBody() {
  const rec = dayRec(currentDateKey);
  $$('.seg-btn[data-workout]').forEach(b => b.classList.toggle('active', (b.dataset.workout || '') === (rec.workout || '')));
  $('#workoutNote').value = rec.workoutNote || '';
  $('#metricSleep').value = rec.sleepH ?? '';
  $('#metricRhr').value = rec.rhrBpm ?? '';
  $('#metricHrv').value = rec.hrvMs ?? '';
  $('#metricStress').value = rec.stress || '';
  // photo
  const slot = $('#photoSlot');
  const photo = state.photos[currentDateKey];
  if (photo) {
    slot.innerHTML = `<img src="${photo}" alt="Daily photo" /><button class="photo-btn" id="photoBtn" style="position:absolute;inset:auto 0 0 0;background:rgba(0,0,0,.5);color:#fff;height:40px;">Replace</button><input type="file" accept="image/*" capture="user" id="photoInput" hidden />`;
  } else {
    slot.innerHTML = `<input type="file" accept="image/*" capture="user" id="photoInput" hidden /><button class="photo-btn" id="photoBtn">Add photo</button>`;
  }
  bindPhotoControls();
}

function bindPhotoControls() {
  const input = $('#photoInput');
  $('#photoBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const dataUrl = await downscaleImage(file, 800, 0.75);
    state.photos[currentDateKey] = dataUrl;
    save(); renderBody();
  });
}

function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ------- Cadence (weekly + monthly) -------
function renderCadence() {
  const wkKey = isoWeekKey(new Date(currentDateKey + 'T00:00:00'));
  const moKey = monthKey(new Date(currentDateKey + 'T00:00:00'));
  const wkRec = state.weeks[wkKey] || (state.weeks[wkKey] = {});
  const moRec = state.months[moKey] || (state.months[moKey] = {});

  $('#weekTag').textContent = wkKey;
  $('#monthTag').textContent = moKey;

  const renderCad = (sel, items, rec, isMonthly = false) => {
    const ul = $(sel); ul.innerHTML = '';
    items.forEach(item => {
      const target = item.target ?? 1;
      const count = rec[item.name] || 0;
      const li = document.createElement('li');
      li.className = 'check';
      const done = count >= target;
      li.innerHTML = `
        <input type="checkbox" ${done ? 'checked' : ''} />
        <span class="check-box"></span>
        <span class="check-label">
          <span>${escapeHtml(item.name)}</span>
          <span class="progress-mini">${count} / ${target}${isMonthly ? ' this month' : ' this week'}</span>
        </span>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        // tap toggles ONE increment until target, then resets
        if ((rec[item.name] || 0) < target) rec[item.name] = (rec[item.name] || 0) + 1;
        else rec[item.name] = 0;
        save(); renderCadence();
      });
      li.querySelector('input').addEventListener('change', (e) => {
        e.preventDefault();
        rec[item.name] = e.target.checked ? target : 0;
        save(); renderCadence();
      });
      ul.appendChild(li);
    });
  };

  renderCad('#checklistWeekly', state.settings.weeklyHabits, wkRec, false);
  renderCad('#checklistMonthly', state.settings.monthlyHabits, moRec, true);
}

// ------- Today (composite) -------
function renderToday() {
  renderHero();
  renderRings();
  renderLoggers();
  renderRoutines();
  renderBody();
  renderCadence();
}

// ------- Bind quick add / loggers -------
function bindLoggers() {
  $$('.chip[data-water]').forEach(b => b.addEventListener('click', () => {
    const ml = +b.dataset.water;
    const rec = dayRec(currentDateKey);
    rec.water += ml;
    rec.waterLog.push({ t: Date.now(), ml });
    save(); renderRings(); renderLoggers(); renderHero();
    toast(`+${ml} ml water`);
  }));
  $('[data-water-undo]').addEventListener('click', () => {
    const rec = dayRec(currentDateKey);
    const last = rec.waterLog.pop();
    if (last) { rec.water = Math.max(0, rec.water - last.ml); save(); renderRings(); renderLoggers(); renderHero(); toast('Undid water'); }
  });

  $$('.chip[data-caffeine]').forEach(b => b.addEventListener('click', () => {
    const mg = +b.dataset.caffeine;
    const rec = dayRec(currentDateKey);
    rec.caffeine += mg;
    rec.caffeineLog.push({ t: Date.now(), mg, label: b.dataset.label });
    save(); renderRings(); renderLoggers(); renderHero();
    toast(`+${mg} mg ${b.dataset.label.toLowerCase()}`);
  }));
  $('[data-caffeine-undo]').addEventListener('click', () => {
    const rec = dayRec(currentDateKey);
    const last = rec.caffeineLog.pop();
    if (last) { rec.caffeine = Math.max(0, rec.caffeine - last.mg); save(); renderRings(); renderLoggers(); renderHero(); toast('Undid caffeine'); }
  });

  // Workout segment
  $$('.seg-btn[data-workout]').forEach(b => b.addEventListener('click', () => {
    const rec = dayRec(currentDateKey);
    rec.workout = b.dataset.workout || '';
    save(); renderBody();
  }));
  $('#workoutNote').addEventListener('input', e => { dayRec(currentDateKey).workoutNote = e.target.value; save(); });

  // Body metrics
  $('#metricSleep').addEventListener('change', e => { dayRec(currentDateKey).sleepH = e.target.value === '' ? null : +e.target.value; save(); });
  $('#metricRhr').addEventListener('change', e => { dayRec(currentDateKey).rhrBpm = e.target.value === '' ? null : +e.target.value; save(); });
  $('#metricHrv').addEventListener('change', e => { dayRec(currentDateKey).hrvMs = e.target.value === '' ? null : +e.target.value; save(); });
  $('#metricStress').addEventListener('change', e => { dayRec(currentDateKey).stress = e.target.value; save(); });
}

// ------- Tabs -------
function bindTabs() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    currentView = t.dataset.tab;
    $$('.tab').forEach(x => x.removeAttribute('aria-current'));
    t.setAttribute('aria-current', 'page');
    $$('[data-view-content]').forEach(v => v.hidden = v.dataset.viewContent !== currentView);
    if (currentView === 'today') renderToday();
    if (currentView === 'insights') renderInsights();
    if (currentView === 'settings') renderSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

// ------- Settings -------
function renderSettings() {
  $('#setWaterGoal').value = state.settings.waterGoalMl;
  $('#setCaffeineGoal').value = state.settings.caffeineGoalMg;

  const renderEdit = (sel, items, kind) => {
    const ul = $(sel); ul.innerHTML = '';
    items.forEach((it, idx) => {
      const li = document.createElement('li');
      const isCadence = kind === 'weekly' || kind === 'monthly';
      const name = isCadence ? it.name : it;
      const target = isCadence ? it.target : null;
      li.innerHTML = `
        <input value="${escapeAttr(name)}" data-idx="${idx}" data-kind="${kind}" />
        ${kind === 'weekly' ? `<input class="target" type="number" min="1" value="${target}" data-target-idx="${idx}" />` : ''}
        <button class="del" data-del="${idx}" data-kind="${kind}" aria-label="Delete">✕</button>
      `;
      ul.appendChild(li);
    });
  };
  renderEdit('#editMorning', state.settings.morningSteps, 'morning');
  renderEdit('#editEvening', state.settings.eveningSteps, 'evening');
  renderEdit('#editWeekly', state.settings.weeklyHabits, 'weekly');
  renderEdit('#editMonthly', state.settings.monthlyHabits.map(m => ({ name: m.name, target: 1 })), 'monthly');
}

function bindSettings() {
  $('#setWaterGoal').addEventListener('change', e => { state.settings.waterGoalMl = +e.target.value || 2500; save(); });
  $('#setCaffeineGoal').addEventListener('change', e => { state.settings.caffeineGoalMg = +e.target.value || 400; save(); });

  // Edit list events
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('.edit-list input[data-kind]')) {
      const kind = t.dataset.kind, idx = +t.dataset.idx;
      if (kind === 'morning') state.settings.morningSteps[idx] = t.value;
      else if (kind === 'evening') state.settings.eveningSteps[idx] = t.value;
      else if (kind === 'weekly') state.settings.weeklyHabits[idx].name = t.value;
      else if (kind === 'monthly') state.settings.monthlyHabits[idx].name = t.value;
      save();
    } else if (t.matches('.edit-list input.target')) {
      const idx = +t.dataset.targetIdx;
      state.settings.weeklyHabits[idx].target = Math.max(1, +t.value || 1);
      save();
    }
  });
  document.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const kind = del.dataset.kind, idx = +del.dataset.del;
      if (kind === 'morning') state.settings.morningSteps.splice(idx, 1);
      else if (kind === 'evening') state.settings.eveningSteps.splice(idx, 1);
      else if (kind === 'weekly') state.settings.weeklyHabits.splice(idx, 1);
      else if (kind === 'monthly') state.settings.monthlyHabits.splice(idx, 1);
      save(); renderSettings();
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const kind = add.dataset.add;
      if (kind === 'morning') {
        const v = $('#addMorning').value.trim(); if (!v) return;
        state.settings.morningSteps.push(v); $('#addMorning').value = '';
      } else if (kind === 'evening') {
        const v = $('#addEvening').value.trim(); if (!v) return;
        state.settings.eveningSteps.push(v); $('#addEvening').value = '';
      } else if (kind === 'weekly') {
        const v = $('#addWeekly').value.trim(); if (!v) return;
        const tgt = Math.max(1, +$('#addWeeklyTarget').value || 1);
        state.settings.weeklyHabits.push({ name: v, target: tgt }); $('#addWeekly').value = '';
      } else if (kind === 'monthly') {
        const v = $('#addMonthly').value.trim(); if (!v) return;
        state.settings.monthlyHabits.push({ name: v, target: 1 }); $('#addMonthly').value = '';
      }
      save(); renderSettings();
    }
  });

  // Export/Import/Reset
  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ritual-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    try {
      const incoming = JSON.parse(text);
      if (!incoming.version) throw new Error('Not a Ritual backup');
      state = Object.assign({}, structuredClone(DEFAULTS), incoming);
      state.settings = Object.assign({}, DEFAULTS.settings, incoming.settings || {});
      save(); renderSettings(); renderToday();
      toast('Backup imported');
    } catch (err) { toast('Invalid file'); }
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('Reset all data? This cannot be undone.')) return;
    state = structuredClone(DEFAULTS);
    save(); renderSettings(); renderToday();
    toast('All data reset');
  });
}

// ------- Insights / charts -------
let charts = {};
function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function lastNDays(n) {
  const out = [];
  const d = new Date(); d.setHours(0,0,0,0);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d); dd.setDate(d.getDate() - i);
    out.push({ date: dd, key: todayKey(dd) });
  }
  return out;
}

function adherencePct(rec) {
  const total = state.settings.morningSteps.length + state.settings.eveningSteps.length;
  if (total === 0 || !rec) return 0;
  let done = 0;
  state.settings.morningSteps.forEach(s => rec.morning?.[s] && done++);
  state.settings.eveningSteps.forEach(s => rec.evening?.[s] && done++);
  return Math.round((done / total) * 100);
}

function renderInsights() {
  // Destroy existing
  Object.values(charts).forEach(c => c?.destroy?.());
  charts = {};

  const days = lastNDays(14);
  const labels = days.map(d => d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const adherence = days.map(d => adherencePct(state.days[d.key]));
  const water = days.map(d => state.days[d.key]?.water || 0);
  const caffeine = days.map(d => state.days[d.key]?.caffeine || 0);

  const colorPrimary = getCSSVar('--primary');
  const colorWater = getCSSVar('--water');
  const colorCaffeine = getCSSVar('--caffeine');
  const colorText = getCSSVar('--text-muted');
  const colorGrid = getCSSVar('--divider');

  Chart.defaults.color = colorText;
  Chart.defaults.font.family = 'Satoshi, system-ui, sans-serif';
  Chart.defaults.borderColor = colorGrid;

  // Adherence (bar)
  charts.adherence = new Chart($('#chartAdherence'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Routines completed (%)', data: adherence, backgroundColor: colorPrimary, borderRadius: 6, maxBarThickness: 22 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y}%` } } },
      scales: { y: { beginAtZero: true, max: 100, ticks: { stepSize: 25, callback: v => v + '%' }, grid: { color: colorGrid } }, x: { grid: { display: false } } }
    }
  });
  const avg = Math.round(adherence.reduce((a,b)=>a+b,0) / adherence.length);
  $('#adherenceAvg').textContent = `${avg}% avg`;

  // Liquids (dual line)
  charts.liquids = new Chart($('#chartLiquids'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Water (ml)', data: water, borderColor: colorWater, backgroundColor: 'transparent', tension: 0.35, yAxisID: 'y', pointRadius: 3, pointBackgroundColor: colorWater, borderWidth: 2 },
        { label: 'Caffeine (mg)', data: caffeine, borderColor: colorCaffeine, backgroundColor: 'transparent', tension: 0.35, yAxisID: 'y1', pointRadius: 3, pointBackgroundColor: colorCaffeine, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { position: 'left', beginAtZero: true, grid: { color: colorGrid }, title: { display: true, text: 'ml', color: colorText } },
        y1: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'mg', color: colorText } },
        x: { grid: { display: false } }
      }
    }
  });

  // Sleep vs caffeine scatter — use last 30 days that have both values
  const scatter = [];
  lastNDays(30).forEach(d => {
    const r = state.days[d.key]; if (!r) return;
    if (r.sleepH != null && r.caffeine != null) scatter.push({ x: r.caffeine, y: r.sleepH });
  });
  charts.corr = new Chart($('#chartCorr'), {
    type: 'scatter',
    data: { datasets: [{ data: scatter, backgroundColor: colorPrimary, pointRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Caffeine (mg)', color: colorText }, grid: { color: colorGrid }, beginAtZero: true },
        y: { title: { display: true, text: 'Sleep (h)', color: colorText }, grid: { color: colorGrid }, beginAtZero: true, suggestedMax: 10 }
      }
    }
  });
  // Pearson correlation if enough points
  if (scatter.length >= 4) {
    const r = pearson(scatter.map(p=>p.x), scatter.map(p=>p.y));
    $('#corrTag').textContent = `r = ${r.toFixed(2)}`;
  } else {
    $('#corrTag').textContent = `${scatter.length} pts — log more`;
  }

  // Workout (28 days bar)
  const wDays = lastNDays(28);
  const wData = wDays.map(d => {
    const r = state.days[d.key]; if (!r) return 0;
    return r.workout === 'trained' ? 1 : (r.workout === 'rest' ? 0.4 : 0);
  });
  const wColors = wDays.map(d => {
    const r = state.days[d.key];
    if (r?.workout === 'trained') return colorPrimary;
    if (r?.workout === 'rest') return colorWater;
    return getCSSVar('--surface-3');
  });
  charts.workout = new Chart($('#chartWorkout'), {
    type: 'bar',
    data: { labels: wDays.map(d => d.date.getDate()), datasets: [{ data: wData, backgroundColor: wColors, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => {
        const r = state.days[wDays[c.dataIndex].key];
        return r?.workout ? r.workout : 'no log';
      } } } },
      scales: { y: { display: false, max: 1, beginAtZero: true }, x: { grid: { display: false } } }
    }
  });
  const trainedCount = wDays.filter(d => state.days[d.key]?.workout === 'trained').length;
  $('#workoutTag').textContent = `${trainedCount} / 28 trained`;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx*dy; dx2 += dx*dx; dy2 += dy*dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// ------- Toast -------
let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 1600);
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// ------- Boot -------
load();
renderDateStrip();
renderToday();
bindLoggers();
bindTabs();
bindSettings();
