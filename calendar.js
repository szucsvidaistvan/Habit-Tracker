// Tasks > Calendar view (month + day timeline), imported calendars and iCalendar (.ics) export.
// Reads App.allTasks, so it never touches the task database itself.
// Imported calendars (e.g. the iCloud "Family" calendar) are read-only and kept on this device.
const TaskCalendar = {
  active: false,
  mode: localStorage.getItem('ht_cal_mode') || 'days', // 'days' (timeline) | 'month'
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selected: UI.getLocalDateString(),
  HOUR_PX: 56,
  tlScroll: null,
  SOURCE_COLORS: ['#fb923c', '#38bdf8', '#c084fc', '#f472b6', '#facc15'],

  // ---------- view switching ----------
  toggle() {
    this.active = !this.active;
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    show('tasks-list-view', !this.active);
    show('tasks-calendar-view', this.active);
    show('tasks-view-icon-cal', !this.active);
    show('tasks-view-icon-list', this.active);
    const btn = document.getElementById('tasks-view-toggle');
    if (btn) btn.setAttribute('aria-label', this.active ? 'Switch to task list' : 'Switch to calendar');
    this.render();
    if (this.active) this.autoRefreshSources();
    App.adjustSliderHeight();
  },

  refresh() { if (this.active) { this.render(); App.adjustSliderHeight(); } },

  setMode(mode) {
    this.mode = mode;
    localStorage.setItem('ht_cal_mode', mode);
    this.tlScroll = null;
    this.refresh();
  },

  shiftMonth(delta) {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.refresh();
  },

  // Week arrows in the timeline view move the selected day by 7 days.
  shiftWeek(delta) {
    this.selected = this.addDays(this.selected, delta * 7);
    const d = new Date(this.selected + 'T12:00:00');
    this.year = d.getFullYear(); this.month = d.getMonth();
    this.refresh();
  },

  goToday() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.selected = UI.getLocalDateString(now);
    this.tlScroll = null;
    this.refresh();
  },

  selectDay(dateStr) {
    this.selected = dateStr;
    const d = new Date(dateStr + 'T12:00:00');
    this.year = d.getFullYear(); this.month = d.getMonth();
    this.refresh();
  },

  // ---------- small date helpers ----------
  pad(n) { return String(n).padStart(2, '0'); },
  dn(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); },
  toMin(t) { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); },
  fmtMin(m) { return `${this.pad(Math.floor(m / 60) % 24)}:${this.pad(m % 60)}`; },
  daysInMonth(y, m1) { return new Date(y, m1, 0).getDate(); },

  // ---------- everything that happens on a day (tasks + imported) ----------
  // Each item: { title, location, allDay, from, to (minutes), source: 'task' | color, ref }
  segment(item, dateStr, startDate, endDate) {
    if (item.allDay) return { allDay: true };
    const fromM = dateStr === startDate ? item.fromM : 0;
    let toM = dateStr === endDate ? item.toM : 1440;
    if (toM <= fromM) toM = Math.min(fromM + 60, 1440);
    return { allDay: false, from: fromM, to: toM };
  },

  taskItemsOn(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dim = this.daysInMonth(d.getFullYear(), d.getMonth() + 1);
    const out = [];
    (App.allTasks || []).forEach(t => {
      let hit = false, startDate = dateStr, endDate = dateStr;
      if (t.recurrence_type === 'weekly') {
        const days = Array.isArray(t.recurrence_days) ? t.recurrence_days : [];
        hit = (!t.due_date || t.due_date <= dateStr) && days.includes(d.getDay());
      } else if (t.recurrence_type === 'monthly') {
        hit = (!t.due_date || t.due_date <= dateStr) && d.getDate() === Math.min(t.recurrence_month_day || 1, dim);
      } else if (t.due_date) {
        startDate = t.due_date; endDate = t.end_date || t.due_date;
        hit = startDate <= dateStr && dateStr <= endDate;
      }
      if (!hit) return;
      const timed = !!(t.start_time || t.end_time);
      const fromM = this.toMin(t.start_time || t.end_time);
      const item = {
        title: t.title, location: '', allDay: !timed, source: 'task', ref: t,
        fromM, toM: t.start_time && t.end_time ? this.toMin(t.end_time) : (fromM || 0) + 60
      };
      out.push({ ...item, ...this.segment(item, dateStr, startDate, endDate) });
    });
    return out;
  },

  eventsOn(dateStr) {
    const items = [...this.taskItemsOn(dateStr), ...this.externalItemsOn(dateStr)];
    return items.sort((a, b) => (b.allDay - a.allDay) || ((a.from || 0) - (b.from || 0)));
  },

  // ---------- rendering: shared bits ----------
  headerHtml(title, prevCall, nextCall) {
    return `<div class="cal-nav">
      <button type="button" class="cal-nav-btn" onclick="${prevCall}" aria-label="Previous">‹</button>
      <button type="button" class="cal-nav-title" onclick="TaskCalendar.goToday()">${UI.escapeHtml(title)}</button>
      <button type="button" class="cal-nav-btn" onclick="${nextCall}" aria-label="Next">›</button>
    </div>`;
  },

  modeSwitchHtml() {
    return `<div class="stats-toggle cal-mode-switch">
      <button class="toggle-btn ${this.mode === 'days' ? 'active' : ''}" onclick="TaskCalendar.setMode('days')">Days</button>
      <button class="toggle-btn ${this.mode === 'month' ? 'active' : ''}" onclick="TaskCalendar.setMode('month')">Month</button>
    </div>`;
  },

  timeText(it) {
    return it.allDay ? 'All day' : `${this.fmtMin(it.from)}${it.to < 1440 ? ' – ' + this.fmtMin(it.to) : ''}`;
  },

  render() {
    const box = document.getElementById('tasks-calendar-view');
    if (!box || !this.active) return;
    const keepScroll = document.getElementById('cal-timeline-scroll');
    if (keepScroll) this.tlScroll = keepScroll.scrollTop;

    box.innerHTML = this.modeSwitchHtml()
      + (this.mode === 'month' ? this.monthHtml() : this.daysHtml())
      + '<button type="button" class="btn-secondary cal-export-btn" onclick="TaskCalendar.downloadAll()">Export tasks to calendar app (.ics)</button>'
      + '<p class="cal-import-hint" style="text-align:center">Import other calendars (e.g. Family) in the Profile tab.</p>';

    const sc = document.getElementById('cal-timeline-scroll');
    if (sc) sc.scrollTop = this.tlScroll != null ? this.tlScroll : Math.max(0, (this.firstHourToShow() - 0.5) * this.HOUR_PX);
  },

  firstHourToShow() {
    const days = [this.selected, this.addDays(this.selected, 1)];
    const starts = days.flatMap(d => this.eventsOn(d)).filter(e => !e.allDay).map(e => e.from / 60);
    return starts.length ? Math.max(0, Math.min(...starts, 8)) : 8;
  },

  // ---------- month view ----------
  monthHtml() {
    const todayStr = UI.getLocalDateString();
    const first = new Date(this.year, this.month, 1);
    const offset = (first.getDay() + 6) % 7; // week starts on Monday
    const dim = this.daysInMonth(this.year, this.month + 1);
    const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<div class="cal-cell cal-cell-empty"></div>';
    for (let day = 1; day <= dim; day++) {
      const ds = `${this.year}-${this.pad(this.month + 1)}-${this.pad(day)}`;
      const count = this.eventsOn(ds).length;
      const cls = ['cal-cell', ds === todayStr ? 'is-today' : '', ds === this.selected ? 'is-selected' : ''].join(' ');
      cells += `<button type="button" class="${cls}" onclick="TaskCalendar.selectDay('${ds}')">
        <span>${day}</span>${count ? `<i class="cal-dot${count > 1 ? ' multi' : ''}"></i>` : ''}</button>`;
    }

    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const selLabel = new Date(this.selected + 'T12:00:00')
      .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const items = this.eventsOn(this.selected);
    const list = items.length === 0 ? '<div class="loader">Nothing on this day.</div>' : items.map(it => this.listRowHtml(it)).join('');

    return `<div class="card cal-card">
        ${this.headerHtml(title, 'TaskCalendar.shiftMonth(-1)', 'TaskCalendar.shiftMonth(1)')}
        <div class="cal-grid cal-weekdays">${names.map(n => `<span>${n}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="cal-day-head">
        <h3>${UI.escapeHtml(selLabel)}</h3>
        <button type="button" class="btn-primary cal-add-btn" onclick="App.openAddTaskModal('${this.selected}')">+ Event</button>
      </div>
      <div class="cal-day-list">${list}</div>`;
  },

  listRowHtml(it) {
    const isTask = it.source === 'task';
    const style = isTask ? '' : ` style="border-left:4px solid ${it.source}"`;
    const sub = [this.timeText(it), it.location, isTask ? UI.taskCategoryName(it.ref.category_id, App.taskCategoriesList || []) : it.sourceName].filter(Boolean).join(' • ');
    return `<div class="cal-event"${style}>
      <div class="cal-event-info" ${isTask ? `onclick="App.openEditTaskModal('${it.ref.id}')"` : ''}>
        <span class="cal-event-title">${UI.escapeHtml(it.title)}</span>
        <span class="cal-event-sub">${UI.escapeHtml(sub)}</span>
      </div>
      ${isTask ? `<button type="button" class="cal-event-ics" onclick="TaskCalendar.downloadTask('${it.ref.id}')" aria-label="Add to calendar app" title="Add to calendar app">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="12" y1="13" x2="12" y2="19"></line><line x1="9" y1="16" x2="15" y2="16"></line></svg>
      </button>` : ''}
    </div>`;
  },

  // ---------- days view (week strip + hour timeline, like the iOS Calendar) ----------
  daysHtml() {
    const todayStr = UI.getLocalDateString();
    const sel = new Date(this.selected + 'T12:00:00');
    const monday = this.addDays(this.selected, -((sel.getDay() + 6) % 7));
    const next = this.addDays(this.selected, 1);
    const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const title = sel.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    let strip = '';
    for (let i = 0; i < 7; i++) {
      const ds = this.addDays(monday, i);
      const cls = ['cal-wk-day', ds === this.selected ? 'is-selected' : '', ds === next ? 'is-next' : '', ds === todayStr ? 'is-today' : ''].join(' ');
      strip += `<button type="button" class="${cls}" onclick="TaskCalendar.selectDay('${ds}')">
        <small>${letters[i]}</small><span>${Number(ds.slice(8))}</span></button>`;
    }

    const cols = [this.selected, next];
    const colHead = cols.map(ds => new Date(ds + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })).map(t => `<div>${UI.escapeHtml(t)}</div>`).join('');
    const perDay = cols.map(ds => this.eventsOn(ds));

    const allDayRow = perDay.some(list => list.some(e => e.allDay))
      ? `<div class="cal-allday-row"><div class="cal-hours-gap"></div>${perDay.map(list =>
          `<div class="cal-allday-col">${list.filter(e => e.allDay).map(e => this.blockLabel(e)).join('')}</div>`).join('')}</div>`
      : '';

    const H = this.HOUR_PX;
    let hours = '';
    for (let h = 0; h < 24; h++) hours += `<div class="cal-hour-label" style="top:${h * H}px">${h === 0 ? '' : this.pad(h) + ':00'}</div>`;
    let lines = '';
    for (let h = 0; h < 24; h++) lines += `<div class="cal-hour-line" style="top:${h * H}px"></div>`;

    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const colsHtml = cols.map((ds, idx) => {
      const timed = this.layout(perDay[idx].filter(e => !e.allDay));
      const blocks = timed.map(e => {
        const top = e.from / 60 * H, height = Math.max(22, (e.to - e.from) / 60 * H - 2);
        const color = e.source === 'task' ? 'var(--accent-color)' : e.source;
        const click = e.source === 'task' ? `onclick="App.openEditTaskModal('${e.ref.id}')"` : '';
        return `<div class="cal-block" ${click} style="top:${top}px;height:${height}px;left:calc(${e.col / e.cols * 100}% + 2px);width:calc(${100 / e.cols}% - 4px);--c:${color}">
          <b>${UI.escapeHtml(e.title)}</b>
          ${e.location && height > 40 ? `<span>📍 ${UI.escapeHtml(e.location)}</span>` : ''}
          ${height > 56 ? `<span>🕒 ${this.fmtMin(e.from)}</span>` : ''}
        </div>`;
      }).join('');
      const now = ds === todayStr ? `<div class="cal-now" style="top:${nowM / 60 * H}px"></div>` : '';
      return `<div class="cal-day-col" ondblclick="">${blocks}${now}</div>`;
    }).join('');

    return `<div class="card cal-card cal-card-flush">
        ${this.headerHtml(title, 'TaskCalendar.shiftWeek(-1)', 'TaskCalendar.shiftWeek(1)')}
        <div class="cal-wk-strip">${strip}</div>
        <div class="cal-col-head"><div class="cal-hours-gap"></div>${colHead}</div>
        ${allDayRow}
        <div class="cal-timeline-scroll" id="cal-timeline-scroll">
          <div class="cal-timeline" style="height:${24 * H}px">
            <div class="cal-hours">${hours}</div>
            <div class="cal-lines">${lines}</div>
            <div class="cal-day-cols">${colsHtml}</div>
          </div>
        </div>
      </div>
      <div class="cal-day-head">
        <h3>Add to ${UI.escapeHtml(sel.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</h3>
        <button type="button" class="btn-primary cal-add-btn" onclick="App.openAddTaskModal('${this.selected}')">+ Event</button>
      </div>`;
  },

  blockLabel(e) {
    const color = e.source === 'task' ? 'var(--accent-color)' : e.source;
    const click = e.source === 'task' ? `onclick="App.openEditTaskModal('${e.ref.id}')"` : '';
    return `<div class="cal-allday-chip" ${click} style="--c:${color}">${UI.escapeHtml(e.title)}</div>`;
  },

  // Side-by-side columns for overlapping events.
  layout(items) {
    const sorted = items.map(e => ({ ...e })).sort((a, b) => a.from - b.from || b.to - a.to);
    let cluster = [], clusterEnd = -1;
    const flush = () => { const n = Math.max(1, ...cluster.map(e => e.col + 1)); cluster.forEach(e => { e.cols = n; }); cluster = []; };
    sorted.forEach(e => {
      if (cluster.length && e.from >= clusterEnd) { flush(); clusterEnd = -1; }
      const used = cluster.filter(o => o.to > e.from).map(o => o.col);
      let c = 0; while (used.includes(c)) c++;
      e.col = c; cluster.push(e); clusterEnd = Math.max(clusterEnd, e.to);
    });
    flush();
    return sorted;
  },

  // ---------- iCalendar (.ics) ----------
  icsEscape(text) {
    return String(text || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  },

  icsFold(line) {
    const out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  },

  icsDate(dateStr) { return dateStr.replace(/-/g, ''); },

  icsTime(dateStr, timeStr) {
    return `${this.icsDate(dateStr)}T${String(timeStr).slice(0, 5).replace(':', '')}00`;
  },

  addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return UI.getLocalDateString(d);
  },

  buildEvent(t) {
    const rec = t.recurrence_type;
    let start = t.due_date;
    if (!start) {
      if (rec === 'once') return null; // no date = nothing to put in a calendar
      start = UI.getLocalDateString();
    }

    const lines = ['BEGIN:VEVENT', `UID:task-${t.id}@habit-tracker`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      `SUMMARY:${this.icsEscape(t.title)}`];

    let rrule = '';
    if (rec === 'weekly') {
      const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const days = (Array.isArray(t.recurrence_days) ? t.recurrence_days : []).slice().sort();
      if (!days.length) return null;
      // DTSTART has to be an occurrence itself: move to the first matching weekday
      for (let i = 0; i < 7 && !days.includes(new Date(start + 'T12:00:00').getDay()); i++) start = this.addDays(start, 1);
      rrule = `RRULE:FREQ=WEEKLY;BYDAY=${days.map(d => names[d]).join(',')}`;
    } else if (rec === 'monthly') {
      const md = t.recurrence_month_day || 1;
      const d = new Date(start + 'T12:00:00');
      if (d.getDate() > md) d.setMonth(d.getMonth() + 1);
      d.setDate(Math.min(md, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      start = UI.getLocalDateString(d);
      rrule = `RRULE:FREQ=MONTHLY;BYMONTHDAY=${md >= 31 ? -1 : md}`;
    }

    const timed = !!(t.start_time || t.end_time);
    const endDay = rec === 'once' ? (t.end_date || start) : start;
    if (!timed) {
      lines.push(`DTSTART;VALUE=DATE:${this.icsDate(start)}`, `DTEND;VALUE=DATE:${this.icsDate(this.addDays(endDay, 1))}`);
    } else {
      const from = t.start_time || t.end_time;
      let to = t.end_time;
      let endDate = endDay;
      if (!to || to <= from && endDate === start) { // no end time: one hour long
        const [h, m] = String(from).split(':').map(Number);
        const total = h * 60 + m + 60;
        to = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        if (total >= 1440) endDate = this.addDays(start, 1);
      }
      // floating local time: lands at the same wall-clock time in whatever calendar it is imported to
      lines.push(`DTSTART:${this.icsTime(start, from)}`, `DTEND:${this.icsTime(endDate, to)}`);
    }

    if (rrule) lines.push(rrule);
    const cat = UI.taskCategoryName(t.category_id, App.taskCategoriesList || []);
    if (cat) lines.push(`CATEGORIES:${this.icsEscape(cat)}`);
    const items = Array.isArray(t.checklist) ? t.checklist.map(i => `- ${i.text || i.title || ''}`).join('\n') : '';
    if (items) lines.push(`DESCRIPTION:${this.icsEscape(items)}`);
    if (timed && t.reminder_enabled !== false) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${this.icsEscape(t.title)}`, 'TRIGGER:-PT10M', 'END:VALARM');
    }
    lines.push('END:VEVENT');
    return lines;
  },

  buildCalendar(tasks) {
    const events = tasks.map(t => this.buildEvent(t)).filter(Boolean);
    if (!events.length) return null;
    const all = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Habit Tracker//Tasks//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      ...events.flat(), 'END:VCALENDAR'];
    return all.map(l => this.icsFold(l)).join('\r\n') + '\r\n';
  },

  download(content, filename) {
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  downloadTask(taskId) {
    const t = (App.allTasks || []).find(x => String(x.id) === String(taskId));
    const ics = t && this.buildCalendar([t]);
    if (!ics) { alert('This task has no date, so it cannot be added to a calendar.'); return; }
    this.download(ics, 'task.ics');
  },

  downloadAll() {
    const ics = this.buildCalendar(App.allTasks || []);
    if (!ics) { alert('No dated tasks to export yet.'); return; }
    this.download(ics, 'habit-tracker-tasks.ics');
  }
};
