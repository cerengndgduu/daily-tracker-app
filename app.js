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
  photos: {},
  // health: keyed YYYY-MM-DD -> { sleepH, sleepStages{coreH,deepH,remH,awakeH,inBedH}, bedTime, wakeTime, hrvMs, rhrBpm, walkingHrBpm, respRate, wristTempC, daytimeHrAvg }
  health: {},
  healthMeta: { lastImport: null, recordsScanned: 0, dayCount: 0 }
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
    if (currentView === 'sleep') renderSleep();
    if (currentView === 'recovery') renderRecovery();
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
    if (currentView === 'sleep') renderSleep();
    if (currentView === 'recovery') renderRecovery();
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

/* ==========================================================
   HEALTH DATA — merging Apple Health into per-day records
   ========================================================== */

// Combined health view: prefer imported Apple Health values, fall back to
// whatever the user typed manually in `state.days[key]`.
function healthFor(key) {
  const ah = state.health?.[key] || {};
  const manual = state.days?.[key] || {};
  return {
    sleepH:        ah.sleepH       ?? manual.sleepH       ?? null,
    sleepStages:   ah.sleepStages  ?? null,
    bedTime:       ah.bedTime      ?? null,
    wakeTime:      ah.wakeTime     ?? null,
    hrvMs:         ah.hrvMs        ?? manual.hrvMs        ?? null,
    rhrBpm:        ah.rhrBpm       ?? manual.rhrBpm       ?? null,
    walkingHrBpm:  ah.walkingHrBpm ?? null,
    respRate:      ah.respRate     ?? null,
    wristTempC:    ah.wristTempC   ?? null,
    daytimeHrAvg:  ah.daytimeHrAvg ?? null
  };
}

// Build a {key: combined} map for the helper functions in health.js.
function buildCombinedHealth() {
  const out = {};
  const keys = new Set([...Object.keys(state.health || {}), ...Object.keys(state.days || {})]);
  for (const k of keys) out[k] = healthFor(k);
  return out;
}

function hasAnyHealth() {
  if (!state.health) return false;
  return Object.keys(state.health).length > 0 ||
    Object.values(state.days || {}).some(d => d?.sleepH != null || d?.hrvMs != null || d?.rhrBpm != null);
}

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}
function hM(h) {
  if (h == null || !isFinite(h)) return '—';
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}
function signed(n, decimals = 1) {
  if (n == null || !isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return s + n.toFixed(decimals);
}

/* ===== SLEEP VIEW ===== */
function renderSleep() {
  const combined = buildCombinedHealth();
  const RH = window.RitualHealth;
  const empty = $('#sleepEmpty');
  const summary = $('#sleepSummaryCard');
  const trends = $('#sleepTrendsCard');
  const hrvCard = $('#sleepHrvCard');
  const tipsCard = $('#sleepTipsCard');

  if (!hasAnyHealth() || !RH) {
    empty.hidden = false;
    [summary, trends, hrvCard, tipsCard].forEach(c => c.hidden = true);
    return;
  }

  // Pick the most recent day with sleep data.
  let key = currentDateKey;
  if (!combined[key]?.sleepH) {
    const candidates = Object.keys(combined).filter(k => combined[k].sleepH != null).sort();
    if (candidates.length) key = candidates[candidates.length - 1];
  }
  const data = combined[key] || {};
  if (data.sleepH == null) {
    empty.hidden = false;
    [summary, trends, hrvCard, tipsCard].forEach(c => c.hidden = true);
    return;
  }

  empty.hidden = true;
  summary.hidden = false; trends.hidden = false; hrvCard.hidden = false; tipsCard.hidden = false;

  // Headline
  const dateObj = new Date(key + 'T12:00:00');
  $('#sleepEyebrow').textContent = key === todayKey() ? 'Last night' : fmtDayLong(dateObj);
  $('#sleepTitle').textContent = hM(data.sleepH);
  $('#sleepSub').textContent = `Recorded by Apple Health · attributed to ${dateObj.toLocaleDateString(undefined, { weekday: 'long' })}`;
  $('#sleepDateTag').textContent = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  $('#sleepDur').textContent = data.sleepH.toFixed(1);
  $('#sleepBed').textContent = fmtTime(data.bedTime);
  $('#sleepWake').textContent = fmtTime(data.wakeTime);

  const base = RH.rollingBaseline(combined, key, 30, d => d?.sleepH);
  const deltaEl = $('#sleepDelta');
  if (base) {
    const d = data.sleepH - base.mean;
    deltaEl.textContent = signed(d, 1) + ' h';
    deltaEl.style.color = Math.abs(d) > 0.75 ? (d > 0 ? 'var(--success)' : 'var(--danger)') : 'var(--text)';
  } else {
    deltaEl.textContent = '—';
  }

  // Stage bar + legend
  const bar = $('#stageBar'); bar.innerHTML = '';
  const legend = $('#stageLegend'); legend.innerHTML = '';
  if (data.sleepStages) {
    const s = data.sleepStages;
    const total = (s.coreH || 0) + (s.deepH || 0) + (s.remH || 0) + (s.awakeH || 0);
    const stages = [
      { cls: 'stg-deep',  lbl: 'Deep',  h: s.deepH  || 0 },
      { cls: 'stg-rem',   lbl: 'REM',   h: s.remH   || 0 },
      { cls: 'stg-core',  lbl: 'Core',  h: s.coreH  || 0 },
      { cls: 'stg-awake', lbl: 'Awake', h: s.awakeH || 0 }
    ];
    stages.forEach(st => {
      if (st.h <= 0) return;
      const seg = document.createElement('span');
      seg.className = st.cls;
      seg.style.flex = `${st.h} 1 0`;
      seg.title = `${st.lbl}: ${hM(st.h)}`;
      bar.appendChild(seg);
    });
    stages.forEach(st => {
      const li = document.createElement('li');
      const pct = total > 0 ? (st.h / total) * 100 : 0;
      li.innerHTML = `<span class="lbl"><span class="swatch" style="background:var(--stage-${st.lbl.toLowerCase()})"></span>${st.lbl}</span><span class="val">${hM(st.h)} <span style="color:var(--text-faint);font-weight:400">· ${pct.toFixed(0)}%</span></span>`;
      legend.appendChild(li);
    });
  } else {
    bar.innerHTML = '<span style="flex:1;background:var(--surface-3)"></span>';
    legend.innerHTML = '<li class="card-meta" style="grid-column:1/-1">Stage breakdown not available for this night.</li>';
  }

  // Coaching tips
  const summaryRes = RH.sleepSummary(combined, key);
  const tips = $('#sleepTips'); tips.innerHTML = '';
  summaryRes.tips.forEach(t => {
    const li = document.createElement('li');
    li.className = t.kind || 'info';
    li.textContent = t.text;
    tips.appendChild(li);
  });
  if (!summaryRes.tips.length) {
    tips.innerHTML = '<li class="info">No notable patterns yet — keep importing your Health data so the engine can build personalized baselines.</li>';
  }

  renderSleepCharts(combined, key);
}

function renderSleepCharts(combined, refKey) {
  ['sleep14', 'sleepHrv'].forEach(k => charts[k]?.destroy?.());

  const colorPrimary = getCSSVar('--primary');
  const colorWater = getCSSVar('--water');
  const colorText = getCSSVar('--text-muted');
  const colorGrid = getCSSVar('--divider');

  // 14-day sleep duration vs baseline line
  const days14 = lastNDays(14);
  const labels14 = days14.map(d => d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const sleepArr = days14.map(d => combined[d.key]?.sleepH ?? null);
  const RH = window.RitualHealth;
  const base = RH.rollingBaseline(combined, refKey, 30, d => d?.sleepH);
  const baseLine = base ? days14.map(() => +base.mean.toFixed(2)) : [];
  const datasets14 = [
    { label: 'Sleep (h)', data: sleepArr, borderColor: colorPrimary, backgroundColor: 'transparent', tension: 0.35, pointRadius: 3, pointBackgroundColor: colorPrimary, borderWidth: 2, spanGaps: true }
  ];
  if (base) datasets14.push({ label: 'Baseline', data: baseLine, borderColor: colorText, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false });

  charts.sleep14 = new Chart($('#chartSleep14'), {
    type: 'line',
    data: { labels: labels14, datasets: datasets14 },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: false, suggestedMin: 4, suggestedMax: 10, grid: { color: colorGrid }, title: { display: true, text: 'h', color: colorText } },
        x: { grid: { display: false } }
      }
    }
  });
  const sleepValid = sleepArr.filter(v => typeof v === 'number');
  $('#sleepAvgTag').textContent = sleepValid.length
    ? `${(sleepValid.reduce((a,b)=>a+b,0)/sleepValid.length).toFixed(1)} h avg`
    : 'no data';

  // 30-day sleeping HR + HRV
  const days30 = lastNDays(30);
  const labels30 = days30.map(d => d.date.getDate());
  const hrv = days30.map(d => combined[d.key]?.hrvMs ?? null);
  const rhr = days30.map(d => combined[d.key]?.rhrBpm ?? null);
  charts.sleepHrv = new Chart($('#chartSleepHrv'), {
    type: 'line',
    data: {
      labels: labels30,
      datasets: [
        { label: 'HRV (ms)', data: hrv, borderColor: colorPrimary, yAxisID: 'y', tension: 0.35, pointRadius: 2, pointBackgroundColor: colorPrimary, borderWidth: 2, spanGaps: true },
        { label: 'RHR (bpm)', data: rhr, borderColor: colorWater, yAxisID: 'y1', tension: 0.35, pointRadius: 2, pointBackgroundColor: colorWater, borderWidth: 2, spanGaps: true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        y:  { position: 'left', grid: { color: colorGrid }, title: { display: true, text: 'ms', color: colorText } },
        y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'bpm', color: colorText } },
        x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 10 } }
      }
    }
  });
}

/* ===== RECOVERY VIEW ===== */
function renderRecovery() {
  const combined = buildCombinedHealth();
  const RH = window.RitualHealth;
  const empty = $('#recoveryEmpty');
  const card = $('#readinessCard');
  const strain = $('#strainCard');
  const illness = $('#illnessCard');
  const trend = $('#readinessTrendCard');

  // We need a baseline of 3+ days of HRV or RHR to score.
  const refKey = todayKey();
  const score = RH ? RH.readinessScore(combined, refKey) : null;
  const hasScore = score && score.parts.length > 0 && combinedDays(combined) >= 3;

  if (!hasScore) {
    empty.hidden = false;
    [card, strain, illness, trend].forEach(c => c.hidden = true);
    return;
  }
  empty.hidden = true;
  [card, strain, illness, trend].forEach(c => c.hidden = false);

  // Score dial
  $('#readinessScore').textContent = score.score;
  const ring = $('#readinessRing');
  ring.setAttribute('stroke-dasharray', `${score.score} 100`);
  // Band-color the ring + tag
  ring.classList.remove('band-High', 'band-Solid', 'band-Modest', 'band-Low');
  ring.classList.add('band-' + score.band);
  const bandTag = $('#readinessBand');
  bandTag.textContent = score.band;
  bandTag.className = 'meta-tag band-' + score.band;

  // Parts
  const partsEl = $('#readinessParts'); partsEl.innerHTML = '';
  score.parts.forEach(p => {
    const li = document.createElement('li');
    let dCls = 'flat', dTxt = '±0';
    if (typeof p.delta === 'number' && isFinite(p.delta)) {
      if (p.delta > 0.4) { dCls = 'up';   dTxt = '↑ ' + (p.label === 'Sleep' ? signed(p.delta) + 'h' : signed(p.delta) + 'σ'); }
      else if (p.delta < -0.4) { dCls = 'down'; dTxt = '↓ ' + (p.label === 'Sleep' ? signed(p.delta) + 'h' : signed(p.delta) + 'σ'); }
    }
    li.innerHTML = `<span class="pl">${p.label}</span><span class="pv">${p.value}</span><span class="delta ${dCls}">${dTxt}</span>`;
    partsEl.appendChild(li);
  });
  $('#readinessAdvice').textContent = score.advice;

  // Strain flag
  const strainFlag = RH.daytimeStrainFlag(combined, refKey);
  const strainEl = $('#strainContent');
  if (strainFlag) {
    strainEl.className = 'flag-content ' + strainFlag.kind;
    strainEl.textContent = strainFlag.text;
  } else {
    strainEl.className = 'flag-content idle';
    strainEl.textContent = combined[refKey]?.walkingHrBpm != null
      ? 'Walking HR is in your normal range today — nothing to flag.'
      : 'Need walking HR data from Apple Health to assess daytime strain.';
  }

  // Illness early-warning
  const illFlag = RH.illnessFlag(combined, refKey);
  const illEl = $('#illnessContent');
  if (illFlag) {
    illEl.className = 'flag-content ' + illFlag.kind;
    illEl.textContent = illFlag.text;
  } else {
    illEl.className = 'flag-content idle';
    illEl.textContent = 'No illness markers elevated. Respiratory rate, wrist temp, and resting HR are all in your usual range.';
  }

  // 30-day readiness trend
  charts.readiness?.destroy?.();
  const colorText = getCSSVar('--text-muted');
  const colorGrid = getCSSVar('--divider');
  const colors = { High: getCSSVar('--success'), Solid: getCSSVar('--water'), Modest: getCSSVar('--warning'), Low: getCSSVar('--danger') };
  const days30 = lastNDays(30);
  const labels = days30.map(d => d.date.getDate());
  const data = [], bar = [];
  let sum = 0, n = 0;
  days30.forEach(d => {
    const r = RH.readinessScore(combined, d.key);
    if (r && r.parts.length > 0 && combinedDays(combined, d.key) >= 3) {
      data.push(r.score); bar.push(colors[r.band]); sum += r.score; n++;
    } else { data.push(null); bar.push(getCSSVar('--surface-3')); }
  });
  charts.readiness = new Chart($('#chartReadiness'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: bar, borderRadius: 4, maxBarThickness: 14 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y == null ? 'no data' : c.parsed.y + ' / 100' } } },
      scales: { y: { beginAtZero: true, max: 100, grid: { color: colorGrid }, ticks: { stepSize: 25, color: colorText } }, x: { grid: { display: false } } }
    }
  });
  $('#readinessAvg').textContent = n > 0 ? `${Math.round(sum / n)} avg` : 'building baseline';
}

function combinedDays(combined, refKey = todayKey()) {
  // Count of distinct days in the trailing 30 with at least HRV or RHR.
  const ref = new Date(refKey + 'T12:00:00');
  let n = 0;
  for (let i = 1; i <= 30; i++) {
    const d = new Date(ref); d.setDate(ref.getDate() - i);
    const k = todayKey(d);
    const r = combined[k];
    if (r && (r.hrvMs != null || r.rhrBpm != null)) n++;
  }
  return n;
}

/* ===== HEALTH IMPORT UI (Settings) ===== */
function renderHealthStatus() {
  const meta = state.healthMeta || {};
  const hasData = state.health && Object.keys(state.health).length > 0;
  $('#btnHealthClear').hidden = !hasData;
  if (!hasData) {
    $('#healthStatus').textContent = 'No Apple Health data imported yet.';
    return;
  }
  const when = meta.lastImport ? new Date(meta.lastImport).toLocaleString() : '';
  $('#healthStatus').textContent = `Last import: ${when} · ${meta.dayCount || Object.keys(state.health).length} days · ${(meta.recordsScanned||0).toLocaleString()} records scanned.`;
}

function bindHealthImport() {
  const input = $('#healthInput');
  const triggerBtn = $('#btnHealthImport');
  const progress = $('#healthProgress');
  const progressBar = $('#healthProgressBar');
  const progressText = $('#healthProgressText');

  if (triggerBtn) {
    triggerBtn.addEventListener('click', () => input.click());
  }

  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!window.RitualHealth || typeof fflate === 'undefined') {
      toast('Health module not loaded'); return;
    }
    progress.hidden = false;
    progressBar.style.width = '0%';
    progressText.textContent = 'Reading export.zip…';
    try {
      const result = await window.RitualHealth.importHealthZip(file, (p) => {
        progressBar.style.width = Math.round((p.pct || 0) * 100) + '%';
        if (p.phase === 'unzipping') progressText.textContent = 'Unzipping export…';
        else if (p.phase === 'parsing') progressText.textContent = `Parsing records… ${p.records ? p.records.toLocaleString() : ''}`;
        else if (p.phase === 'aggregating') progressText.textContent = 'Aggregating per-day metrics…';
        else if (p.phase === 'done') progressText.textContent = `Done. ${p.days} days indexed.`;
      });
      // Merge: imported wins, but keep prior days that aren't in this export.
      state.health = Object.assign({}, state.health || {}, result.days);
      state.healthMeta = { lastImport: Date.now(), recordsScanned: result.recordsScanned, dayCount: Object.keys(state.health).length };
      save();
      renderHealthStatus();
      toast(`Imported ${Object.keys(result.days).length} days of Apple Health data`);
      setTimeout(() => { progress.hidden = true; }, 1500);
    } catch (err) {
      console.error(err);
      progressText.textContent = 'Import failed: ' + (err.message || 'unknown error');
      progressBar.style.width = '0%';
      toast('Import failed');
    } finally {
      input.value = ''; // allow re-uploading same file
    }
  });

  $('#btnHealthClear').addEventListener('click', () => {
    if (!confirm('Clear all imported Apple Health data? Your habit logs will not be touched.')) return;
    state.health = {};
    state.healthMeta = { lastImport: null, recordsScanned: 0, dayCount: 0 };
    save();
    renderHealthStatus();
    toast('Apple Health data cleared');
  });
}

/* ===== Extended Patterns charts (sleep, HRV, stages, resp/temp, correlations) ===== */
function renderHealthPatterns() {
  const combined = buildCombinedHealth();
  const colorPrimary = getCSSVar('--primary');
  const colorWater = getCSSVar('--water');
  const colorCaffeine = getCSSVar('--caffeine');
  const colorText = getCSSVar('--text-muted');
  const colorGrid = getCSSVar('--divider');

  ['sleepHabit', 'hrvRhr', 'stages', 'respTemp', 'sleepHrv2', 'routineReady', 'waterHrv'].forEach(k => charts[k]?.destroy?.());

  const days30 = lastNDays(30);
  const labels30 = days30.map(d => d.date.getDate());
  const days14 = lastNDays(14);
  const labels14 = days14.map(d => d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

  // Sleep duration bar (30d)
  const sleepArr = days30.map(d => combined[d.key]?.sleepH ?? null);
  charts.sleepHabit = new Chart($('#chartSleepHabit'), {
    type: 'bar',
    data: { labels: labels30, datasets: [{ data: sleepArr, backgroundColor: colorPrimary, borderRadius: 4, maxBarThickness: 14 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y == null ? 'no data' : c.parsed.y.toFixed(1) + ' h' } } },
      scales: { y: { beginAtZero: false, suggestedMin: 4, suggestedMax: 10, grid: { color: colorGrid } }, x: { grid: { display: false } } }
    }
  });
  const sleepValid = sleepArr.filter(v => typeof v === 'number');
  $('#sleepHabAvg').textContent = sleepValid.length
    ? `${(sleepValid.reduce((a,b)=>a+b,0)/sleepValid.length).toFixed(1)} h avg`
    : 'no data';

  // HRV + RHR dual line (30d)
  const hrv = days30.map(d => combined[d.key]?.hrvMs ?? null);
  const rhr = days30.map(d => combined[d.key]?.rhrBpm ?? null);
  charts.hrvRhr = new Chart($('#chartHrvRhr'), {
    type: 'line',
    data: { labels: labels30, datasets: [
      { label: 'HRV', data: hrv, borderColor: colorPrimary, yAxisID: 'y', tension: 0.35, pointRadius: 2, borderWidth: 2, spanGaps: true },
      { label: 'RHR', data: rhr, borderColor: colorWater, yAxisID: 'y1', tension: 0.35, pointRadius: 2, borderWidth: 2, spanGaps: true }
    ]},
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        y:  { position: 'left', grid: { color: colorGrid }, title: { display: true, text: 'ms', color: colorText } },
        y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'bpm', color: colorText } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }
      }
    }
  });

  // Stages stacked bar (14d)
  const stagesData = {
    deep:  days14.map(d => combined[d.key]?.sleepStages?.deepH  ?? 0),
    rem:   days14.map(d => combined[d.key]?.sleepStages?.remH   ?? 0),
    core:  days14.map(d => combined[d.key]?.sleepStages?.coreH  ?? 0),
    awake: days14.map(d => combined[d.key]?.sleepStages?.awakeH ?? 0)
  };
  charts.stages = new Chart($('#chartStages'), {
    type: 'bar',
    data: { labels: labels14, datasets: [
      { label: 'Deep',  data: stagesData.deep,  backgroundColor: getCSSVar('--stage-deep'),  stack: 's' },
      { label: 'REM',   data: stagesData.rem,   backgroundColor: getCSSVar('--stage-rem'),   stack: 's' },
      { label: 'Core',  data: stagesData.core,  backgroundColor: getCSSVar('--stage-core'),  stack: 's' },
      { label: 'Awake', data: stagesData.awake, backgroundColor: getCSSVar('--stage-awake'), stack: 's' }
    ]},
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(1)} h` } } },
      scales: { y: { stacked: true, beginAtZero: true, grid: { color: colorGrid }, title: { display: true, text: 'h', color: colorText } }, x: { stacked: true, grid: { display: false } } }
    }
  });

  // Respiratory rate + wrist temp (30d, dual axis)
  const resp = days30.map(d => combined[d.key]?.respRate ?? null);
  const temp = days30.map(d => combined[d.key]?.wristTempC ?? null);
  charts.respTemp = new Chart($('#chartRespTemp'), {
    type: 'line',
    data: { labels: labels30, datasets: [
      { label: 'Resp /min', data: resp, borderColor: colorPrimary, yAxisID: 'y', tension: 0.35, pointRadius: 2, borderWidth: 2, spanGaps: true },
      { label: 'Wrist temp', data: temp, borderColor: colorCaffeine, yAxisID: 'y1', tension: 0.35, pointRadius: 2, borderWidth: 2, spanGaps: true }
    ]},
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        y:  { position: 'left', grid: { color: colorGrid }, title: { display: true, text: '/min', color: colorText } },
        y1: { position: 'right', grid: { display: false }, title: { display: true, text: '°C', color: colorText } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }
      }
    }
  });

  // Correlations
  // Sleep -> next-day HRV: pair night-of-{key} sleep with the HRV recorded on the same key.
  const sleepHrvPts = [];
  Object.keys(combined).forEach(k => {
    const r = combined[k];
    if (r.sleepH != null && r.hrvMs != null) sleepHrvPts.push({ x: r.sleepH, y: r.hrvMs });
  });
  charts.sleepHrv2 = new Chart($('#chartSleepHrv2'), {
    type: 'scatter',
    data: { datasets: [{ data: sleepHrvPts, backgroundColor: colorPrimary, pointRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Sleep (h)', color: colorText }, grid: { color: colorGrid } },
        y: { title: { display: true, text: 'HRV (ms)', color: colorText }, grid: { color: colorGrid } }
      }
    }
  });
  $('#corrSleepHrvTag').textContent = sleepHrvPts.length >= 4
    ? `r = ${pearson(sleepHrvPts.map(p=>p.x), sleepHrvPts.map(p=>p.y)).toFixed(2)}`
    : `${sleepHrvPts.length} pts — log more`;

  // Routines vs readiness
  const RH = window.RitualHealth;
  const routineReadyPts = [];
  Object.keys(combined).forEach(k => {
    const adh = adherencePct(state.days[k]);
    const r = RH ? RH.readinessScore(combined, k) : null;
    if (adh > 0 && r && r.parts.length > 0 && combinedDays(combined, k) >= 3) routineReadyPts.push({ x: adh, y: r.score });
  });
  charts.routineReady = new Chart($('#chartRoutineReady'), {
    type: 'scatter',
    data: { datasets: [{ data: routineReadyPts, backgroundColor: colorWater, pointRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Routines (%)', color: colorText }, grid: { color: colorGrid }, min: 0, max: 100 },
        y: { title: { display: true, text: 'Readiness', color: colorText }, grid: { color: colorGrid }, min: 0, max: 100 }
      }
    }
  });
  $('#corrRoutineReadyTag').textContent = routineReadyPts.length >= 4
    ? `r = ${pearson(routineReadyPts.map(p=>p.x), routineReadyPts.map(p=>p.y)).toFixed(2)}`
    : `${routineReadyPts.length} pts — log more`;

  // Hydration vs HRV
  const waterHrvPts = [];
  Object.keys(combined).forEach(k => {
    const day = state.days[k];
    if (!day) return;
    if (day.water > 0 && combined[k].hrvMs != null) waterHrvPts.push({ x: day.water, y: combined[k].hrvMs });
  });
  charts.waterHrv = new Chart($('#chartWaterHrv'), {
    type: 'scatter',
    data: { datasets: [{ data: waterHrvPts, backgroundColor: colorCaffeine, pointRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Water (ml)', color: colorText }, grid: { color: colorGrid }, beginAtZero: true },
        y: { title: { display: true, text: 'HRV (ms)', color: colorText }, grid: { color: colorGrid } }
      }
    }
  });
  $('#corrWaterHrvTag').textContent = waterHrvPts.length >= 4
    ? `r = ${pearson(waterHrvPts.map(p=>p.x), waterHrvPts.map(p=>p.y)).toFixed(2)}`
    : `${waterHrvPts.length} pts — log more`;
}

// Patch renderInsights to also render the health patterns block.
const _origRenderInsights = renderInsights;
renderInsights = function() {
  _origRenderInsights();
  renderHealthPatterns();
};

// Patch renderSettings to also refresh health status.
const _origRenderSettings = renderSettings;
renderSettings = function() {
  _origRenderSettings();
  renderHealthStatus();
};

// ------- Boot -------
load();
renderDateStrip();
renderToday();
bindLoggers();
bindTabs();
bindSettings();
bindHealthImport();
