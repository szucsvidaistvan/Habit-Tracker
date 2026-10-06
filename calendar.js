// Tasks > Calendar view + iCalendar (.ics) export.
// Reads App.allTasks, so it never touches the database itself.
const TaskCalendar = {
  active: false,
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selected: UI.getLocalDateString(),

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
    App.adjustSliderHeight();
  },

  refresh() {
    if (this.active) { this.render(); App.adjustSliderHeight(); }
  },

  shiftMonth(delta) {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
    App.adjustSliderHeight();
  },

  goToday() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.selected = UI.getLocalDateString(now);
    this.render();
    App.adjustSliderHeight();
  },

  selectDay(dateStr) {
    this.selected = dateStr;
    this.render();
    App.adjustSliderHeight();
  },

  // ---------- which tasks fall on a day ----------
  tasksOn(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return (App.allTasks || []).filter(t => {
      if (t.recurrence_type === 'weekly') {
        const days = Array.isArray(t.recurrence_days) ? t.recurrence_days : [];
        return (!t.due_date || t.due_date <= dateStr) && days.includes(d.getDay());
      }
      if (t.recurrence_type === 'monthly') {
        const day = Math.min(t.recurrence_month_day || 1, dim);
        return (!t.due_date || t.due_date <= dateStr) && d.getDate() === day;
      }
      if (!t.due_date) return false; // undated tasks have no place on a calendar
      return t.due_date <= dateStr && dateStr <= (t.end_date || t.due_date);
    }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  },

  // ---------- rendering ----------
  render() {
    const box = document.getElementById('tasks-calendar-view');
    if (!box || !this.active) return;

    const todayStr = UI.getLocalDateString();
    const first = new Date(this.year, this.month, 1);
    const offset = (first.getDay() + 6) % 7; // week starts on Monday
    const dim = new Date(this.year, this.month + 1, 0).getDate();
    const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const pad = n => String(n).padStart(2, '0');

    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<div class="cal-cell cal-cell-empty"></div>';
    for (let day = 1; day <= dim; day++) {
      const ds = `${this.year}-${pad(this.month + 1)}-${pad(day)}`;
      const count = this.tasksOn(ds).length;
      const cls = ['cal-cell', ds === todayStr ? 'is-today' : '', ds === this.selected ? 'is-selected' : ''].join(' ');
      cells += `<button type="button" class="${cls}" onclick="TaskCalendar.selectDay('${ds}')">
        <span>${day}</span>${count ? `<i class="cal-dot${count > 1 ? ' multi' : ''}"></i>` : ''}</button>`;
    }

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayTasks = this.tasksOn(this.selected);
    const selLabel = new Date(this.selected + 'T12:00:00')
      .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    const list = dayTasks.length === 0
      ? '<div class="loader">Nothing on this day.</div>'
      : dayTasks.map(t => {
          const meta = UI.getTaskMeta(t, { includeDate: false });
          const cat = UI.taskCategoryName(t.category_id, App.taskCategoriesList || []);
          const sub = [cat, meta.text].filter(Boolean).join(' • ');
          return `<div class="cal-event">
            <div class="cal-event-info" onclick="App.openEditTaskModal('${t.id}')">
              <span class="cal-event-title">${UI.escapeHtml(t.title)}</span>
              ${sub ? `<span class="cal-event-sub">${UI.escapeHtml(sub)}</span>` : ''}
            </div>
            <button type="button" class="cal-event-ics" onclick="TaskCalendar.downloadTask('${t.id}')" aria-label="Add to calendar app" title="Add to calendar app">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="12" y1="13" x2="12" y2="19"></line><line x1="9" y1="16" x2="15" y2="16"></line></svg>
            </button>
          </div>`;
        }).join('');

    box.innerHTML = `
      <div class="card cal-card">
        <div class="cal-nav">
          <button type="button" class="cal-nav-btn" onclick="TaskCalendar.shiftMonth(-1)" aria-label="Previous month">‹</button>
          <button type="button" class="cal-nav-title" onclick="TaskCalendar.goToday()">${UI.escapeHtml(title)}</button>
          <button type="button" class="cal-nav-btn" onclick="TaskCalendar.shiftMonth(1)" aria-label="Next month">›</button>
        </div>
        <div class="cal-grid cal-weekdays">${dayNames.map(n => `<span>${n}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="cal-day-head">
        <h3>${UI.escapeHtml(selLabel)}</h3>
        <button type="button" class="btn-primary cal-add-btn" onclick="App.openAddTaskModal('${this.selected}')">+ Event</button>
      </div>
      <div class="cal-day-list">${list}</div>
      <button type="button" class="btn-secondary cal-export-btn" onclick="TaskCalendar.downloadAll()">Export all to calendar app (.ics)</button>
    `;
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
