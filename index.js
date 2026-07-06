const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const APP_DOC = admin.firestore().collection('apps').doc('vfb-westhofen');

function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function fmtDeadline(d) {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Muss exakt der Logik von deadline() in index.html entsprechen
function computeDeadline(e) {
  if (e.type === 'training') {
    return new Date(e.date + 'T12:00:00');
  }
  const d = new Date(e.date + 'T00:00:00');
  d.setDate(d.getDate() - 2);
  d.setHours(23, 59, 0, 0);
  return d;
}

// Muss der Logik von allEvents() in index.html entsprechen (Serien + Einzeltermine)
function buildEvents(data, daysAhead = 5, daysBack = 1) {
  const events = [...(data.events || [])];
  const now = new Date();
  (data.series || []).forEach(s => {
    for (let i = -daysBack; i <= daysAhead; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      if (d.getDay() === s.weekday) {
        const x = iso(d);
        if (!(s.skip || []).includes(x)) {
          events.push({ id: 'ser:' + s.id + ':' + x, type: 'training', date: x, time: s.time, end: s.end, place: s.place, note: s.note, opp: null });
        }
      }
    }
  });
  return events;
}

async function sendPush(data, tokensAll, title, body) {
  const tokens = [...new Set(tokensAll)].filter(Boolean);
  if (!tokens.length) return;
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    try {
      const res = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body }
      });
      // Ungültige/abgelaufene Tokens aus den Nutzerprofilen entfernen
      res.responses.forEach((r, idx) => {
        if (!r.success) {
          const badToken = chunk[idx];
          (data.users || []).forEach(u => {
            if (u.fcmTokens && u.fcmTokens.includes(badToken)) {
              u.fcmTokens = u.fcmTokens.filter(t => t !== badToken);
            }
          });
        }
      });
    } catch (err) {
      console.error('Push-Fehler', err);
    }
  }
}

function openUsersFor(data, e) {
  const rsvps = (data.rsvps && data.rsvps[e.id]) || {};
  return (data.users || []).filter(u => !rsvps[u.id]);
}

async function reminder24h(data, e) {
  const open = openUsersFor(data, e);
  if (!open.length) return;
  const tokens = [];
  open.forEach(u => (u.fcmTokens || []).forEach(t => tokens.push(t)));
  const label = e.type === 'spiel' ? '⚽ Spiel' + (e.opp ? ' vs. ' + e.opp : '') : '⚽ Training';
  const dl = computeDeadline(e);
  await sendPush(data, tokens, label, `Bitte bis ${fmtDeadline(dl)} Uhr in der App an-/abmelden.`);
}

async function reminder2h(data, e) {
  const open = openUsersFor(data, e);
  if (!open.length) return;
  const tokens = [];
  open.forEach(u => (u.fcmTokens || []).forEach(t => tokens.push(t)));
  const label = e.type === 'spiel' ? '⚽ Spiel' + (e.opp ? ' vs. ' + e.opp : '') : '⚽ Training';
  const dl = computeDeadline(e);
  await sendPush(data, tokens, label, `Letzte Chance! Anmeldeschluss ist um ${fmtDeadline(dl)} Uhr.`);
}

function applyAutoPenalty(data, e) {
  const open = openUsersFor(data, e);
  if (!open.length) return;
  data.charges = data.charges || [];
  const catName = e.type === 'spiel' ? 'Keine Rückmeldung in App Spiel' : 'Keine Rückmeldung in App Training';
  const cat = (data.catalog || []).find(c => c.name === catName);
  const amount = cat ? Number(cat.amount) : (e.type === 'spiel' ? 6 : 3);
  open.forEach(u => {
    const credit = Math.min(Number(u.creditFine || 0), amount);
    u.creditFine = Number(u.creditFine || 0) - credit;
    data.charges.push({
      id: uid(),
      user: u.id,
      reason: catName + ' (automatisch, Deadline verpasst)',
      amount,
      creditUsed: credit,
      open: Math.max(0, amount - credit),
      date: iso(new Date())
    });
  });
}

async function notifyDeadlineClosed(data, e) {
  // Kurze Info-Push an alle, die nicht rechtzeitig geantwortet haben
  const open = openUsersFor(data, e);
  const tokens = [];
  open.forEach(u => (u.fcmTokens || []).forEach(t => tokens.push(t)));
  if (!tokens.length) return;
  const label = e.type === 'spiel' ? 'Spiel' : 'Training';
  await sendPush(data, tokens, '⛔ Anmeldung geschlossen', `Du hast dich nicht rechtzeitig zum ${label} gemeldet. Es wurde automatisch eine Strafe eingetragen.`);
}

exports.checkTeamDeadlines = functions
  .region('europe-west1')
  .pubsub.schedule('every 15 minutes')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    const snap = await APP_DOC.get();
    if (!snap.exists) return null;
    const stored = snap.data();
    const data = stored.db;
    if (!data) return null;

    data.eventMeta = data.eventMeta || {};
    let changed = false;
    const now = new Date();
    const events = buildEvents(data);

    for (const e of events) {
      const start = new Date(`${e.date}T${e.time || '19:00'}:00`);
      const dl = computeDeadline(e);
      data.eventMeta[e.id] = data.eventMeta[e.id] || {};
      const meta = data.eventMeta[e.id];

      // 24h-Erinnerung
      if (!meta.notified24 && start > now && (start - now) <= 24 * 3600 * 1000) {
        await reminder24h(data, e);
        meta.notified24 = true;
        changed = true;
      }
      // 2h-Erinnerung
      if (!meta.notified2 && start > now && (start - now) <= 2 * 3600 * 1000) {
        await reminder2h(data, e);
        meta.notified2 = true;
        changed = true;
      }
      // Deadline überschritten -> automatische Strafe + Sperr-Info
      if (!meta.deadlineProcessed && now > dl) {
        applyAutoPenalty(data, e);
        await notifyDeadlineClosed(data, e);
        meta.deadlineProcessed = true;
        changed = true;
      }
    }

    // alte eventMeta-Einträge (>30 Tage) aufräumen, damit das Dokument nicht endlos wächst
    Object.keys(data.eventMeta).forEach(id => {
      const dateMatch = id.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const d = new Date(dateMatch[1] + 'T00:00:00');
        if ((now - d) / 86400000 > 30) {
          delete data.eventMeta[id];
          changed = true;
        }
      }
    });

    if (changed) {
      await APP_DOC.set({ db: data, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    return null;
  });
