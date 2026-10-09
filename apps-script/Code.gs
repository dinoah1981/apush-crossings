/**
 * Crossings: Google Sheets backend for the APUSH practice app.
 *
 * Paste this whole file into Extensions > Apps Script on the results Google
 * Sheet, run setup() once, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). Put the /exec URL in config.js.
 *
 * Tabs:
 *   Roster       you import your roster CSV here (File > Import > Insert new sheet, rename to "Roster")
 *   Responses    one row per answer (main questions and parallel checks)
 *   Set Results  one row per completed set
 *   Students     one row per student per bank: running XP, level, saved progress
 *   Summary      best first-try % per set, per student (formula, no script needed)
 *
 * Students never see OSIS numbers. The app sends a name, the script matches it
 * against the Roster tab and hands back an opaque key (an HMAC of the OSIS).
 */

var TABS = {
  responses: ['Timestamp', 'OSIS', 'Last Name', 'First Name', 'Bank', 'Set', 'Phase', 'Question', 'Topic', 'Chosen', 'Correct Answer', 'Correct?', 'Attempt'],
  sets: ['Timestamp', 'OSIS', 'Last Name', 'First Name', 'Bank', 'Set', 'Set Title', 'Score', 'Out Of', 'Percent', 'Missed', 'Check Attempts', 'XP Earned', 'Total XP', 'Replay'],
  students: ['OSIS', 'Last Name', 'First Name', 'Bank', 'XP', 'Level', 'Sets Done', 'Last Active', 'Progress (app data)'],
};
var TAB_NAMES = { responses: 'Responses', sets: 'Set Results', students: 'Students' };

/* ---------- one-time setup ---------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (k) {
    var sh = ss.getSheetByName(TAB_NAMES[k]) || ss.insertSheet(TAB_NAMES[k]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(TABS[k]);
      sh.getRange(1, 1, 1, TABS[k].length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  ss.getSheetByName('Responses').getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('Set Results').getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('Set Results').getRange('J:J').setNumberFormat('0%');
  ss.getSheetByName('Students').getRange('A:A').setNumberFormat('@');

  var sum = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  sum.clear();
  sum.getRange('A1').setValue('Best first-try score per set (practice replays excluded). Columns are set numbers.');
  sum.getRange('A3').setFormula(
    "=IFERROR(QUERY('Set Results'!B:O, \"select B, C, D, max(J) where O = FALSE group by B, C, D pivot F label B 'OSIS', C 'Last Name', D 'First Name'\", 1), \"No results yet\")");
  sum.getRange('D:Z').setNumberFormat('0%');

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid());

  var roster = ss.getSheetByName('Roster');
  var msg = roster ? ('Roster tab found: ' + readRoster_().length + ' students.') :
    'Setup done, but there is no "Roster" tab yet. Import your roster CSV as a new sheet named Roster.';
  Logger.log(msg);
  ss.toast(msg, 'Crossings setup', 10);  // non-blocking (an alert would hold the editor run open until OK)
}

/* ---------- web endpoints ---------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'lookup') return json_({ ok: true, matches: lookup_(p.name || '') });
    if (p.action === 'progress') return json_({ ok: true, progress: getProgress_(p.key, p.bank) });
    if (p.action === 'leaderboard') return json_({ ok: true, leaders: leaderboard_(p.bank) });
    return json_({ ok: true, service: 'crossings' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    lock.waitLock(20000);
    var events = body.action === 'batch' ? body.events : [body];
    var students = studentsByKey_();
    var done = [];
    events.forEach(function (ev) {
      var s = students[ev.key];
      if (!s) return;  // unknown key: ignore rather than write junk
      if (ev.action === 'answer') writeAnswer_(s, ev);
      else if (ev.action === 'set') writeSet_(s, ev);
      done.push(ev.id);
    });
    return json_({ ok: true, done: done });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ---------- roster + matching ---------- */

function readRoster_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster');
  if (!sh) throw new Error('No Roster tab');
  var values = sh.getDataRange().getDisplayValues();
  return parseRoster(values);
}

/** values: 2D array with a header row. Pure function (tested in Node). */
function parseRoster(values) {
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function col() {
    for (var i = 0; i < arguments.length; i++) {
      var j = head.indexOf(arguments[i]);
      if (j >= 0) return j;
    }
    return -1;
  }
  var cFirst = col('first name', 'first'), cPref = col('preferred name', 'preferred'),
      cLast = col('last name', 'last'), cId = col('school id', 'osis', 'state id', 'student id'),
      cEmail = col('email address', 'email');
  if (cFirst < 0 || cLast < 0 || cId < 0) throw new Error('Roster needs First Name, Last Name and School ID/OSIS columns');
  return values.slice(1).filter(function (r) { return String(r[cId]).trim(); }).map(function (r) {
    return {
      osis: String(r[cId]).trim(),
      first: String(r[cFirst]).trim(),
      preferred: cPref >= 0 ? String(r[cPref]).trim() : '',
      last: String(r[cLast]).trim(),
      email: cEmail >= 0 ? String(r[cEmail]).trim().toLowerCase() : '',
    };
  });
}

function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, ' ').split(/\s+/).filter(Boolean);
}

function lev(a, b) {
  var m = a.length, n = b.length, d = [], i, j;
  for (i = 0; i <= m; i++) d[i] = [i];
  for (j = 0; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function tokMatch(typed, real, fuzzy) {
  if (typed === real) return true;
  if (typed.length >= 3 && real.indexOf(typed) === 0) return true;  // "Chris" -> "christopher"
  return fuzzy && typed.length >= 4 && lev(typed, real) <= 1;        // one typo
}

/** Pure: returns roster entries whose first/preferred AND last name match what was typed. */
function matchName(typed, roster) {
  var t = norm(typed);
  if (t.length < 2) return [];
  function run(fuzzy) {
    return roster.filter(function (s) {
      var firsts = norm(s.first + ' ' + s.preferred), lasts = norm(s.last);
      var usedFirst = -1;
      var hasFirst = t.some(function (x, i) {
        var ok = firsts.some(function (f) { return tokMatch(x, f, fuzzy); });
        if (ok && usedFirst < 0) usedFirst = i;
        return ok;
      });
      var hasLast = t.some(function (x, i) {
        return i !== usedFirst && lasts.some(function (l) { return tokMatch(x, l, fuzzy); });
      });
      return hasFirst && hasLast;
    });
  }
  var exact = run(false);
  return exact.length ? exact : run(true);
}

function keyFor_(osis) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  var sig = Utilities.computeHmacSha256Signature(osis, secret);
  return sig.slice(0, 10).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function displayName_(s) { return (s.preferred || s.first) + ' ' + s.last; }

function lookup_(name) {
  return matchName(name, readRoster_()).slice(0, 5).map(function (s) {
    return { key: keyFor_(s.osis), name: displayName_(s), first: s.preferred || s.first };
  });
}

function studentsByKey_() {
  var out = {};
  readRoster_().forEach(function (s) { out[keyFor_(s.osis)] = s; });
  return out;
}

/* ---------- writes ---------- */

function sheet_(k) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAMES[k]); }

function writeAnswer_(s, ev) {
  sheet_('responses').appendRow([new Date(ev.ts || Date.now()), s.osis, s.last, s.first, ev.bank, ev.set,
    ev.phase === 'check' ? 'Check (parallel)' : 'Main', ev.num, ev.topic, ev.chosen, ev.correct, ev.isCorrect, ev.attempt || 1]);
}

function writeSet_(s, ev) {
  sheet_('sets').appendRow([new Date(ev.ts || Date.now()), s.osis, s.last, s.first, ev.bank, ev.set, ev.title,
    ev.score, ev.total, ev.total ? ev.score / ev.total : 0, (ev.missed || []).join(', '), ev.checkAttempts,
    ev.xpEarned, ev.totalXp, !!ev.replay]);
  upsertStudent_(s, ev);
}

function upsertStudent_(s, ev) {
  var sh = sheet_('students');
  var data = sh.getDataRange().getValues();
  var row = [s.osis, s.last, s.first, ev.bank, ev.totalXp, ev.level, ev.setsDone, new Date(), JSON.stringify(ev.progress || {})];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === s.osis && data[i][3] === ev.bank) {
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  sh.appendRow(row);
}

/* ---------- reads ---------- */

function getProgress_(key, bank) {
  var s = studentsByKey_()[key];
  if (!s) return null;
  var data = sheet_('students').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === s.osis && data[i][3] === bank) {
      try { return JSON.parse(data[i][8]); } catch (e) { return null; }
    }
  }
  return null;
}

function leaderboard_(bank) {
  var data = sheet_('students').getDataRange().getValues().slice(1);
  return data.filter(function (r) { return r[3] === bank && Number(r[4]) > 0; })
    .sort(function (a, b) { return Number(b[4]) - Number(a[4]); })
    .slice(0, 10)
    .map(function (r) { return { name: r[2] + ' ' + String(r[1]).charAt(0) + '.', xp: Number(r[4]), level: r[5] }; });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
