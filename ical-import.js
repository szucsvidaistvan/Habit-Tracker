// Imported calendars (e.g. the iCloud "Family" calendar): read-only, kept on this device.
// Two ways in: an .ics file, or a calendar subscription link (fetched through the "ical-proxy"
// Edge Function, because iCloud / Google do not allow direct requests from a web page).
Object.assign(TaskCalendar, {
  SOURCES_KEY: 'ht_cal_sources',

  // ---------- storage ----------
  getSources() {
    try { return JSON.parse(localStorage.getItem(this.SOURCES_KEY)) || []; } catch (_) { return []; }
  },
  saveSources(list) {
    try { localStorage.setItem(this.SOURCES_KEY, JSON.stringify(list)); }
    catch (_) { this.setStatus('Calendar is too big to store on this device.', true); }
  },
  setStatus(text, isError = false) {
    this.status = { text, isError };
    const el = document.getElementById('cal-import-status');
    if (el) { el.textContent = text; el.classList.toggle('error', isError); }
  },

  // ---------- .ics parsing ----------
  unescapeText(v) { return String(v || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); },

  // "20261017" / "20261017T140000" / "...Z" -> { date, time|null, allDay }
  parseDT(value, params) {
    const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    if (!m[4] || /VALUE=DATE(?!-)/i.test(params)) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null, allDay: true };
    if (m[7]) { // UTC -> this device's local time
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
      return { date: UI.getLocalDateString(d), time: `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}`, allDay: false };
    }
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false }; // wall-clock time
  },

  parseRRule(text) {
    const r = {};
    text.split(';').forEach(p => { const [k, v] = p.split('='); if (k) r[k.toUpperCase()] = v; });
    const until = r.UNTIL ? this.parseDT(r.UNTIL, '') : null;
    return {
      freq: r.FREQ, interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
      count: r.COUNT ? parseInt(r.COUNT, 10) : null, until: until ? until.date : null,
      byday: r.BYDAY ? r.BYDAY.split(',') : [],
      bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : []
    };
  },

  parseICS(text) {
    const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
    const events = [], overrides = [];
    let cur = null;
    lines.forEach(line => {
      if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; return; }
      if (line === 'END:VEVENT') {
        if (cur && cur.start && !cur.cancelled) (cur.recurrenceId ? overrides : events).push(cur);
        cur = null; return;
      }
      if (!cur) return;
      const idx = line.indexOf(':');
      if (idx < 0) return;
      const [name, ...paramParts] = line.slice(0, idx).split(';');
      const params = paramParts.join(';'), value = line.slice(idx + 1);
      switch (name.toUpperCase()) {
        case 'UID': cur.uid = value; break;
        case 'SUMMARY': cur.title = this.unescapeText(value); break;
        case 'LOCATION': cur.location = this.unescapeText(value).split('\n')[0]; break;
        case 'STATUS': if (/CANCELLED/i.test(value)) cur.cancelled = true; break;
        case 'DTSTART': cur.start = this.parseDT(value, params); break;
        case 'DTEND': cur.end = this.parseDT(value, params); break;
        case 'RRULE': cur.rrule = this.parseRRule(value); break;
        case 'RECURRENCE-ID': { const r = this.parseDT(value, params); if (r) cur.recurrenceId = r.date; break; }
        case 'EXDATE': value.split(',').forEach(v => { const x = this.parseDT(v, params); if (x) cur.exdates.push(x.date); }); break;
      }
    });

    // a moved / edited single occurrence replaces the original one on that day
    overrides.forEach(o => {
      const master = events.find(e => e.uid === o.uid && e.rrule);
      if (master) master.exdates.push(o.recurrenceId);
    });

    return [...events, ...overrides].map(e => {
      const allDay = e.start.allDay;
      let endDate = e.start.date, toM = null;
      if (e.end) {
        if (allDay) endDate = this.addDays(e.end.date, -1); // all-day DTEND is exclusive
        else { endDate = e.end.date; toM = this.toMin(e.end.time); }
      }
      if (endDate < e.start.date) endDate = e.start.date;
      return {
        title: e.title || '(no title)', location: e.location || '', allDay,
        startDate: e.start.date, endDate, fromM: allDay ? 0 : this.toMin(e.start.time),
        toM: allDay ? 1440 : (toM != null ? toM : this.toMin(e.start.time) + 60),
        rrule: e.recurrenceId ? null : (e.rrule || null), exdates: e.exdates
      };
    });
  },

  // ---------- recurrence: does event `ev` start an occurrence on `day`? ----------
  startsOn(ev, day, ignoreCount = false) {
    if (day < ev.startDate || ev.exdates.includes(day)) return false;
    const r = ev.rrule;
    if (!r) return day === ev.startDate;
    if (r.until && day > r.until) return false;

    const d = new Date(day + 'T12:00:00'), s = new Date(ev.startDate + 'T12:00:00');
    const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    let ok = false;
    if (r.freq === 'DAILY') {
      ok = (this.dn(day) - this.dn(ev.startDate)) % r.interval === 0;
    } else if (r.freq === 'WEEKLY') {
      const wk = x => Math.floor((this.dn(x) + 3) / 7); // Monday-based week number
      const days = r.byday.length ? r.byday.map(b => b.slice(-2)) : [codes[s.getDay()]];
      ok = days.includes(codes[d.getDay()]) && (wk(day) - wk(ev.startDate)) % r.interval === 0;
    } else if (r.freq === 'MONTHLY') {
      const months = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
      const dim = this.daysInMonth(d.getFullYear(), d.getMonth() + 1);
      if (months % r.interval === 0) {
        if (r.byday.length) {
          ok = r.byday.some(b => {
            const m = b.match(/^(-?\d+)?([A-Z]{2})$/);
            if (!m || m[2] !== codes[d.getDay()]) return false;
            if (!m[1]) return true;
            const n = Number(m[1]);
            return n > 0 ? Math.ceil(d.getDate() / 7) === n : d.getDate() + 7 > dim && n === -1;
          });
        } else if (r.bymonthday.length) {
          ok = r.bymonthday.some(v => (v > 0 ? v : dim + 1 + v) === d.getDate());
        } else ok = d.getDate() === s.getDate();
      }
    } else if (r.freq === 'YEARLY') {
      ok = d.getMonth() === s.getMonth() && d.getDate() === s.getDate()
        && (d.getFullYear() - s.getFullYear()) % r.interval === 0;
    }
    if (!ok) return false;

    if (r.count && !ignoreCount) { // COUNT: only the first N occurrences exist
      let n = 0;
      for (let x = ev.startDate, guard = 0; x <= day && guard < 5000; x = this.addDays(x, 1), guard++) {
        if (this.startsOn({ ...ev, exdates: [] }, x, true)) n++;
      }
      return n <= r.count;
    }
    return true;
  },

  externalItemsOn(dateStr) {
    const out = [];
    this.getSources().forEach((src, i) => {
      const color = this.SOURCE_COLORS[i % this.SOURCE_COLORS.length];
      (src.events || []).forEach(ev => {
        const span = this.dn(ev.endDate) - this.dn(ev.startDate);
        for (let k = 0; k <= span; k++) { // an occurrence that started k days ago still runs today
          const start = this.addDays(dateStr, -k);
          if (!this.startsOn(ev, start)) continue;
          const end = this.addDays(start, span);
          out.push({
            title: ev.title, location: ev.location, allDay: ev.allDay, source: color, sourceName: src.name,
            ...this.segment({ allDay: ev.allDay, fromM: ev.fromM, toM: ev.toM }, dateStr, start, end)
          });
          break;
        }
      });
    });
    return out;
  },

  // ---------- import actions ----------
  addSource(source) {
    const list = this.getSources().filter(s => !(source.url && s.url === source.url));
    list.push({ id: String(Date.now()), ...source });
    this.saveSources(list);
    this.afterSourcesChanged();
  },

  async importFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const events = this.parseICS(await file.text());
      if (!events.length) { this.setStatus('No events found in that file.', true); return; }
      this.addSource({ name: file.name.replace(/\.ics$/i, ''), url: null, events, updated: Date.now() });
      this.setStatus(`Imported ${events.length} events.`);
    } catch (e) {
      console.error('[TaskCalendar.importFile]', e);
      this.setStatus('Could not read that file.', true);
    }
  },

  async fetchFeed(url) {
    const clean = url.trim().replace(/^webcal:\/\//i, 'https://');
    const { data, error } = await supabase.functions.invoke('ical-proxy', { body: { url: clean } });
    if (error || !data || typeof data.ics !== 'string') throw new Error((data && data.error) || (error && error.message) || 'Fetch failed');
    return this.parseICS(data.ics);
  },

  async subscribeUrl() {
    const input = document.getElementById('cal-import-url');
    const nameInput = document.getElementById('cal-import-name');
    const url = input ? input.value.trim() : '';
    if (!url) return;
    this.setStatus('Fetching…');
    try {
      const events = await this.fetchFeed(url);
      if (!events.length) { this.setStatus('The link worked, but it has no events.', true); return; }
      this.addSource({ name: (nameInput && nameInput.value.trim()) || 'Family', url: url.replace(/^webcal:\/\//i, 'https://'), events, updated: Date.now() });
      this.setStatus(`Subscribed – ${events.length} events.`);
    } catch (e) {
      console.error('[TaskCalendar.subscribeUrl]', e);
      this.setStatus('Could not fetch that link. Is the calendar shared publicly, and is the ical-proxy function deployed?', true);
    }
  },

  async refreshSource(id, quiet = false) {
    const list = this.getSources();
    const src = list.find(s => s.id === id);
    if (!src || !src.url) return;
    if (!quiet) this.setStatus('Refreshing…');
    try {
      src.events = await this.fetchFeed(src.url);
      src.updated = Date.now();
      this.saveSources(list);
      this.afterSourcesChanged();
      if (!quiet) this.setStatus('Updated.');
    } catch (e) {
      if (!quiet) this.setStatus('Could not refresh (offline?). Showing the saved copy.', true);
    }
  },

  // Subscribed calendars refresh themselves when the calendar opens (at most once an hour).
  autoRefreshSources() {
    if (!navigator.onLine) return;
    this.getSources().forEach(s => { if (s.url && Date.now() - (s.updated || 0) > 3600000) this.refreshSource(s.id, true); });
  },

  removeSource(id) {
    this.saveSources(this.getSources().filter(s => s.id !== id));
    this.afterSourcesChanged();
  },

  // The panel lives in the Profile tab; the calendar view only needs a redraw when it is open.
  afterSourcesChanged() {
    this.renderImportPanel();
    this.refresh();
    App.adjustSliderHeight();
  },

  renderImportPanel() {
    const box = document.getElementById('cal-import-container');
    if (!box) return;
    const wasOpen = box.querySelector('details') ? box.querySelector('details').open : null;
    box.innerHTML = this.importHtml();
    const d = box.querySelector('details');
    if (d && wasOpen !== null) d.open = wasOpen;
  },

  // ---------- UI panel ----------
  importHtml() {
    const sources = this.getSources();
    const rows = sources.map((s, i) => `<div class="cal-src-row">
        <span class="cal-src-dot" style="background:${this.SOURCE_COLORS[i % this.SOURCE_COLORS.length]}"></span>
        <div class="cal-src-info"><b>${UI.escapeHtml(s.name)}</b><small>${s.events.length} events${s.url ? ' • link' : ' • file'} • ${new Date(s.updated).toLocaleDateString()}</small></div>
        ${s.url ? `<button type="button" class="cal-src-btn" onclick="TaskCalendar.refreshSource('${s.id}')">Refresh</button>` : ''}
        <button type="button" class="cal-src-btn danger" onclick="TaskCalendar.removeSource('${s.id}')">Remove</button>
      </div>`).join('');
    const st = this.status || { text: '', isError: false };
    return `<details class="card cal-import">
      <summary>Imported calendars${sources.length ? ` (${sources.length})` : ''}</summary>
      ${rows}
      <p class="cal-import-hint">Imported events are read-only and stay on this device.</p>
      <label class="cal-import-label">Subscription link (webcal:// or https://)</label>
      <input id="cal-import-url" class="cal-import-input" type="url" placeholder="webcal://p12-caldav.icloud.com/published/…">
      <input id="cal-import-name" class="cal-import-input" type="text" placeholder="Name (e.g. Family)" maxlength="30">
      <button type="button" class="btn-primary cal-import-btn" onclick="TaskCalendar.subscribeUrl()">Subscribe</button>
      <label class="cal-import-label">…or import an .ics file</label>
      <input type="file" accept=".ics,text/calendar" class="cal-import-file" onchange="TaskCalendar.importFile(this)">
      <div id="cal-import-status" class="cal-import-status ${st.isError ? 'error' : ''}">${UI.escapeHtml(st.text)}</div>
    </details>`;
  }
});


TaskCalendar.renderImportPanel();
