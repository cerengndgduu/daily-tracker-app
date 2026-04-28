/* ==========================================================
   RITUAL — Apple Health import + interpretation engine
   ==========================================================
   Parses an Apple Health "Export All Health Data" zip:
     - sleep stages from HKCategoryTypeIdentifierSleepAnalysis
     - HRV (SDNN), resting HR, walking HR, heart rate samples
     - respiratory rate, sleeping wrist temperature
   Produces per-day records normalized to YYYY-MM-DD using the
   "wake date" (record endDate) for sleep so a single sleep session
   that spans midnight is attributed to the wake-up day.
   ========================================================== */

const HEALTH_RECORD_TYPES = new Set([
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierWalkingHeartRateAverage',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRespiratoryRate',
  'HKQuantityTypeIdentifierAppleSleepingWristTemperature',
  'HKQuantityTypeIdentifierBodyTemperature'
]);

const SLEEP_STAGE_MAP = {
  'HKCategoryValueSleepAnalysisInBed': 'inBed',
  'HKCategoryValueSleepAnalysisAsleep': 'asleep',         // pre-watchOS 9
  'HKCategoryValueSleepAnalysisAsleepUnspecified': 'asleep',
  'HKCategoryValueSleepAnalysisAsleepCore': 'core',
  'HKCategoryValueSleepAnalysisAsleepDeep': 'deep',
  'HKCategoryValueSleepAnalysisAsleepREM': 'rem',
  'HKCategoryValueSleepAnalysisAwake': 'awake'
};

// ----- Date helpers (local time) -----
function dateKeyLocal(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseAppleDate(s) {
  // Apple format: "2023-01-10 22:40:03 +0000" or "2023-01-10 22:40:03 -0500"
  // ISO-friendly: replace first space with 'T' and second space (before tz) with nothing-ish.
  // Easiest: insert T, fix tz to ±HH:MM
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (!m) return new Date(s);
  return new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
}

/* ----- Streaming reader: extract export.xml from zip and feed SAX parser -----
   Uses fflate (CDN) for unzipping and a tiny attribute-only XML scanner. */

async function importHealthZip(file, onProgress) {
  if (typeof fflate === 'undefined') throw new Error('fflate not loaded');

  const buf = new Uint8Array(await file.arrayBuffer());
  onProgress && onProgress({ phase: 'unzipping', pct: 0.05 });

  // Find export.xml inside the zip without inflating everything else.
  const unzipped = fflate.unzipSync(buf, {
    filter: (f) => f.name.endsWith('/export.xml') || f.name === 'export.xml'
  });
  const xmlKey = Object.keys(unzipped).find(k => k.endsWith('export.xml'));
  if (!xmlKey) throw new Error('No export.xml found in zip');

  onProgress && onProgress({ phase: 'parsing', pct: 0.15 });

  const xmlBytes = unzipped[xmlKey];
  // Use TextDecoder in chunks so we don't blow memory on huge strings.
  const decoder = new TextDecoder('utf-8');
  const chunkSize = 4 * 1024 * 1024; // 4 MB
  const totalLen = xmlBytes.length;

  // Per-day aggregates we'll build up.
  const days = new Map();   // dayKey -> { hrvSamples:[], rhr:[], walkingHR:[], hr:[], resp:[], temp:[] }
  const sleepSegments = []; // { wakeKey, stage, startMs, endMs, durMs }
  const dayHRSamples = new Map(); // dayKey -> [{tHour, bpm}]
  let recordsScanned = 0;

  let leftover = '';
  let cursor = 0;
  while (cursor < totalLen) {
    const end = Math.min(cursor + chunkSize, totalLen);
    const chunk = xmlBytes.subarray(cursor, end);
    const text = leftover + decoder.decode(chunk, { stream: end < totalLen });
    cursor = end;

    // Find complete <Record .../> tags. Records are self-closing in Apple's export
    // (or have nested MetadataEntry — rare). We scan for <Record ... />, falling back
    // to </Record> if needed.
    let pos = 0;
    while (true) {
      const open = text.indexOf('<Record', pos);
      if (open === -1) break;
      // find self-closing /> first
      const close = text.indexOf('/>', open);
      const closeFull = text.indexOf('</Record>', open);
      let recEnd = -1, blockEnd = -1;
      if (close !== -1 && (closeFull === -1 || close < closeFull)) {
        recEnd = close + 2; blockEnd = recEnd;
      } else if (closeFull !== -1) {
        recEnd = closeFull; blockEnd = closeFull + '</Record>'.length;
      } else {
        // incomplete tag, save leftover from open onwards for next chunk
        break;
      }
      const recXml = text.slice(open, recEnd);
      processRecord(recXml);
      recordsScanned++;
      pos = blockEnd;
    }
    leftover = text.slice(pos);

    if (recordsScanned % 50000 < 100) {
      onProgress && onProgress({ phase: 'parsing', pct: 0.15 + 0.7 * (cursor / totalLen), records: recordsScanned });
      // Yield to the event loop so UI stays responsive on giant files.
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress && onProgress({ phase: 'aggregating', pct: 0.9 });

  // Build per-day output.
  const out = {};
  // Sleep aggregation: group by wakeKey
  const sleepByDay = new Map();
  for (const seg of sleepSegments) {
    if (!sleepByDay.has(seg.wakeKey)) sleepByDay.set(seg.wakeKey, { stages: { core:0, deep:0, rem:0, awake:0, asleep:0, inBed:0 }, bedStart: Infinity, wakeEnd: -Infinity });
    const agg = sleepByDay.get(seg.wakeKey);
    agg.stages[seg.stage] = (agg.stages[seg.stage] || 0) + seg.durMs;
    if (seg.stage === 'inBed') {
      agg.bedStart = Math.min(agg.bedStart, seg.startMs);
      agg.wakeEnd = Math.max(agg.wakeEnd, seg.endMs);
    } else if (seg.stage !== 'awake') {
      agg.bedStart = Math.min(agg.bedStart, seg.startMs);
      agg.wakeEnd = Math.max(agg.wakeEnd, seg.endMs);
    }
  }

  // Compute walking HR / RHR / HRV / resp / temp per day from collected samples
  for (const [key, d] of days) {
    const rec = out[key] = out[key] || {};
    if (d.hrv.length) rec.hrvMs = round1(avg(d.hrv));
    if (d.rhr.length) rec.rhrBpm = Math.round(avg(d.rhr));
    if (d.walkingHR.length) rec.walkingHrBpm = Math.round(avg(d.walkingHR));
    if (d.resp.length) rec.respRate = round1(avg(d.resp));
    if (d.temp.length) rec.wristTempC = round2(avg(d.temp));
    if (d.hrSamples.length) rec.daytimeHrAvg = Math.round(avg(d.hrSamples));
  }
  // Merge sleep
  for (const [key, agg] of sleepByDay) {
    const rec = out[key] = out[key] || {};
    const stages = agg.stages;
    // Pick a sleep duration: prefer summed asleep stages, fall back to the legacy single "asleep" bucket
    const stageSum = stages.core + stages.deep + stages.rem;
    const totalAsleepMs = stageSum > 0 ? stageSum : stages.asleep;
    if (totalAsleepMs > 0) {
      rec.sleepH = round2(totalAsleepMs / 3600000);
      rec.sleepStages = {
        coreH: round2(stages.core / 3600000),
        deepH: round2(stages.deep / 3600000),
        remH: round2(stages.rem / 3600000),
        awakeH: round2(stages.awake / 3600000),
        inBedH: round2(stages.inBed / 3600000)
      };
      if (isFinite(agg.bedStart) && isFinite(agg.wakeEnd)) {
        rec.bedTime = new Date(agg.bedStart).toISOString();
        rec.wakeTime = new Date(agg.wakeEnd).toISOString();
      }
    }
  }

  onProgress && onProgress({ phase: 'done', pct: 1, days: Object.keys(out).length });
  return { days: out, recordsScanned };

  // ----- inner -----
  function processRecord(recXml) {
    const type = attr(recXml, 'type');
    if (!type || !HEALTH_RECORD_TYPES.has(type)) return;
    const start = attr(recXml, 'startDate');
    const end = attr(recXml, 'endDate');
    if (!start || !end) return;
    const sd = parseAppleDate(start);
    const ed = parseAppleDate(end);
    if (!sd || !ed) return;

    if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const v = attr(recXml, 'value');
      const stage = SLEEP_STAGE_MAP[v];
      if (!stage) return;
      const wakeKey = dateKeyLocal(ed); // attribute the night to its wake-up day
      sleepSegments.push({ wakeKey, stage, startMs: +sd, endMs: +ed, durMs: +ed - +sd });
      return;
    }

    const value = parseFloat(attr(recXml, 'value'));
    if (!isFinite(value)) return;
    const dayKey = dateKeyLocal(sd);
    if (!days.has(dayKey)) days.set(dayKey, { hrv:[], rhr:[], walkingHR:[], hr:[], hrSamples:[], resp:[], temp:[] });
    const bucket = days.get(dayKey);
    switch (type) {
      case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN': bucket.hrv.push(value); break;
      case 'HKQuantityTypeIdentifierRestingHeartRate':         bucket.rhr.push(value); break;
      case 'HKQuantityTypeIdentifierWalkingHeartRateAverage':  bucket.walkingHR.push(value); break;
      case 'HKQuantityTypeIdentifierHeartRate':                bucket.hrSamples.push(value); break;
      case 'HKQuantityTypeIdentifierRespiratoryRate':          bucket.resp.push(value); break;
      case 'HKQuantityTypeIdentifierAppleSleepingWristTemperature':
      case 'HKQuantityTypeIdentifierBodyTemperature':          bucket.temp.push(value); break;
    }
  }
}

function attr(s, name) {
  // Parses ` name="value"` from a tag string. Apple values don't contain quotes that would need escaping.
  const re = new RegExp('\\b' + name + '="([^"]*)"');
  const m = s.match(re);
  return m ? m[1] : null;
}
function avg(arr) { let s = 0; for (const x of arr) s += x; return s / arr.length; }
function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }

/* ==========================================================
   INTERPRETATION ENGINE
   ========================================================== */

// Compute personal baselines from `state.health` indexed by date key.
// Returns rolling mean + std-dev for the last `windowDays` days, for a metric extractor fn.
function rollingBaseline(healthDays, refKey, windowDays, getter) {
  const ref = new Date(refKey + 'T12:00:00');
  const vals = [];
  for (let i = 1; i <= windowDays; i++) {
    const d = new Date(ref); d.setDate(ref.getDate() - i);
    const k = dateKeyLocal(d);
    const v = getter(healthDays[k]);
    if (typeof v === 'number' && isFinite(v)) vals.push(v);
  }
  if (vals.length < 3) return null;
  const m = avg(vals);
  const s = Math.sqrt(vals.reduce((a, x) => a + (x - m) * (x - m), 0) / vals.length);
  return { mean: m, std: s, n: vals.length };
}

/** Build a sleep summary for a given day, comparing to baseline. */
function sleepSummary(healthDays, dayKey) {
  const today = healthDays[dayKey] || {};
  const sleep = today.sleepH ?? null;
  const stages = today.sleepStages ?? null;
  const base = rollingBaseline(healthDays, dayKey, 30, d => d?.sleepH);
  const tips = [];

  if (sleep == null) {
    tips.push({ kind: 'info', text: 'No sleep data for this night yet. Import your Apple Health export to see analysis.' });
    return { sleep, base, stages, tips, bedTime: today.bedTime, wakeTime: today.wakeTime };
  }

  // Duration vs baseline
  if (base) {
    const diffH = sleep - base.mean;
    if (diffH < -0.75) tips.push({ kind: 'warn', text: `You slept ${(-diffH).toFixed(1)} h less than your 30-day average (${base.mean.toFixed(1)} h). Aim to be in bed 60–90 min earlier tonight.` });
    else if (diffH > 0.75) tips.push({ kind: 'good', text: `You slept ${diffH.toFixed(1)} h more than your 30-day baseline. Nice catch-up.` });
    else tips.push({ kind: 'ok', text: `Sleep duration is in line with your 30-day baseline (${base.mean.toFixed(1)} h).` });
  }

  // Absolute floor
  if (sleep < 6) tips.push({ kind: 'warn', text: 'Under 6 h is restorative-debt territory. If this is a pattern, prioritize an earlier wind-down routine — dim lights, no caffeine after 14:00, screens off 30 min before bed.' });
  else if (sleep < 7) tips.push({ kind: 'ok', text: 'Just shy of 7 h. Most adults need 7–9 h to consolidate memory and recover.' });

  // Stages
  if (stages) {
    const totalAsleep = stages.coreH + stages.deepH + stages.remH;
    if (totalAsleep > 0) {
      const deepPct = (stages.deepH / totalAsleep) * 100;
      const remPct = (stages.remH / totalAsleep) * 100;
      if (deepPct < 10) tips.push({ kind: 'warn', text: `Deep sleep was only ${deepPct.toFixed(0)}% of total — typical is 13–23%. Late alcohol, late workouts, or warm bedrooms suppress deep sleep.` });
      else if (deepPct > 18) tips.push({ kind: 'good', text: `Strong deep sleep (${deepPct.toFixed(0)}%). Your body got a real recovery window.` });
      if (remPct < 18) tips.push({ kind: 'warn', text: `REM was only ${remPct.toFixed(0)}% — typical is 20–25%. Short sleep often clips REM (which is heavier in the second half of the night).` });
      if (stages.awakeH > 0.75) tips.push({ kind: 'ok', text: `${(stages.awakeH * 60).toFixed(0)} min awake during the night. Some interruption is normal; if it's a pattern, watch caffeine timing and bedroom temperature.` });
    }
  }

  // Sleeping HR
  if (today.rhrBpm != null) {
    const rhrBase = rollingBaseline(healthDays, dayKey, 30, d => d?.rhrBpm);
    if (rhrBase && rhrBase.std > 0) {
      const z = (today.rhrBpm - rhrBase.mean) / rhrBase.std;
      if (z > 1.2) tips.push({ kind: 'warn', text: `Resting HR (${today.rhrBpm} bpm) is elevated vs your 30-day baseline of ${rhrBase.mean.toFixed(0)} bpm. Possible signs: poor sleep, late alcohol, training stress, or oncoming illness.` });
      else if (z < -0.8) tips.push({ kind: 'good', text: `Resting HR (${today.rhrBpm} bpm) is below your baseline — typically a sign of good recovery.` });
    }
  }

  // HRV
  if (today.hrvMs != null) {
    const hrvBase = rollingBaseline(healthDays, dayKey, 30, d => d?.hrvMs);
    if (hrvBase && hrvBase.std > 0) {
      const z = (today.hrvMs - hrvBase.mean) / hrvBase.std;
      if (z < -1.0) tips.push({ kind: 'warn', text: `HRV (${today.hrvMs.toFixed(0)} ms) is below your baseline (${hrvBase.mean.toFixed(0)} ms). The autonomic system is favoring "fight" — keep training easy and lean into recovery today.` });
      else if (z > 0.8) tips.push({ kind: 'good', text: `HRV (${today.hrvMs.toFixed(0)} ms) is above baseline. Your body looks well-recovered.` });
    }
  }

  return { sleep, base, stages, tips, bedTime: today.bedTime, wakeTime: today.wakeTime };
}

/** Daily HRV-based readiness score (0-100). Higher = more recovered. */
function readinessScore(healthDays, dayKey) {
  const today = healthDays[dayKey] || {};
  const hrvBase = rollingBaseline(healthDays, dayKey, 30, d => d?.hrvMs);
  const rhrBase = rollingBaseline(healthDays, dayKey, 30, d => d?.rhrBpm);
  const sleepBase = rollingBaseline(healthDays, dayKey, 30, d => d?.sleepH);

  const parts = [];
  let score = 50;
  if (today.hrvMs != null && hrvBase && hrvBase.std > 0) {
    const z = (today.hrvMs - hrvBase.mean) / hrvBase.std;
    score += Math.max(-25, Math.min(25, z * 14));
    parts.push({ label: 'HRV', value: today.hrvMs.toFixed(0) + ' ms', delta: z });
  }
  if (today.rhrBpm != null && rhrBase && rhrBase.std > 0) {
    const z = (today.rhrBpm - rhrBase.mean) / rhrBase.std;
    score -= Math.max(-15, Math.min(15, z * 10));
    parts.push({ label: 'Resting HR', value: today.rhrBpm + ' bpm', delta: -z });
  }
  if (today.sleepH != null && sleepBase) {
    const diff = today.sleepH - sleepBase.mean;
    score += Math.max(-15, Math.min(15, diff * 8));
    parts.push({ label: 'Sleep', value: today.sleepH.toFixed(1) + ' h', delta: diff });
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let band, advice;
  if (score >= 78) { band = 'High'; advice = 'Body is well-recovered. Good day for hard training, intense focus work, or a hilly run.'; }
  else if (score >= 60) { band = 'Solid'; advice = 'Normal day — proceed with planned training and work, watch for late-day fatigue.'; }
  else if (score >= 42) { band = 'Modest'; advice = 'Take it easier. Aerobic base, mobility, or a long walk beats high-intensity today.'; }
  else { band = 'Low'; advice = 'Active recovery only — gentle walk, stretching, hydration, early bed. Skip caffeine after lunch.'; }

  return { score, band, advice, parts };
}

/** Walking/daytime HR elevation flag. */
function daytimeStrainFlag(healthDays, dayKey) {
  const today = healthDays[dayKey] || {};
  if (today.walkingHrBpm == null) return null;
  const base = rollingBaseline(healthDays, dayKey, 30, d => d?.walkingHrBpm);
  if (!base || base.std === 0) return null;
  const z = (today.walkingHrBpm - base.mean) / base.std;
  if (z > 1.0) return { kind: 'warn', text: `Walking HR averaged ${today.walkingHrBpm} bpm — ${(today.walkingHrBpm - base.mean).toFixed(0)} bpm above your baseline. The day taxed you more than usual (heat, stress, caffeine, or coming-down with something).` };
  if (z < -0.8) return { kind: 'good', text: `Walking HR averaged ${today.walkingHrBpm} bpm — calmer than your baseline of ${base.mean.toFixed(0)}.` };
  return null;
}

/** Illness early-warning: respiratory rate + wrist temp anomalies. */
function illnessFlag(healthDays, dayKey) {
  const today = healthDays[dayKey] || {};
  const flags = [];

  if (today.respRate != null) {
    const base = rollingBaseline(healthDays, dayKey, 30, d => d?.respRate);
    if (base && base.std > 0) {
      const z = (today.respRate - base.mean) / base.std;
      if (z > 1.5) flags.push(`respiratory rate ${today.respRate.toFixed(1)} /min (${(today.respRate - base.mean).toFixed(1)} above baseline)`);
    }
  }
  if (today.wristTempC != null) {
    const base = rollingBaseline(healthDays, dayKey, 30, d => d?.wristTempC);
    if (base && base.std > 0) {
      const z = (today.wristTempC - base.mean) / base.std;
      if (z > 1.5) flags.push(`wrist temp +${(today.wristTempC - base.mean).toFixed(2)}°C above baseline`);
    }
  }
  if (today.rhrBpm != null) {
    const base = rollingBaseline(healthDays, dayKey, 30, d => d?.rhrBpm);
    if (base && base.std > 0) {
      const z = (today.rhrBpm - base.mean) / base.std;
      if (z > 1.5) flags.push(`resting HR +${(today.rhrBpm - base.mean).toFixed(0)} bpm above baseline`);
    }
  }

  if (flags.length >= 2) {
    return { kind: 'warn', text: `Two or more illness markers are elevated: ${flags.join('; ')}. Don't push training, prioritize sleep and fluids.` };
  }
  if (flags.length === 1) {
    return { kind: 'ok', text: `One marker elevated (${flags[0]}). Watch how you feel; if a second flags tomorrow, treat it as an illness signal.` };
  }
  return null;
}

// Expose
window.RitualHealth = {
  importHealthZip,
  sleepSummary,
  readinessScore,
  daytimeStrainFlag,
  illnessFlag,
  rollingBaseline,
  dateKeyLocal
};
