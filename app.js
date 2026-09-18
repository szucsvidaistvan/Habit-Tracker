// A day counts toward a streak if at least this % of active habits were completed.
// Lower than 100% on purpose: some habits only need a few times a week, so
// demanding a literal 100% every single day would punish people unfairly.

// Application Controller
const App = {
  currentUser: null,
  habitsList: [],
  inactiveHabitsList: [],
  achievementsList: [],
  editingHabitId: null,
  pendingDeleteId: null,
  activeStatsTab: 'weekly',
  authMode: 'login',

  async init() {
    console.log('[App.init] Starting application...');
    const today = new Date().toLocaleDateString('en-US');
    const dateElem = document.getElementById('current-date');
    if (dateElem) dateElem.innerText = `Today: ${today}`;

    if (typeof API === 'undefined') {
      console.error('[App.init] CRITICAL ERROR: API not found!');
      return;
    }

    try {
      const { data: { session }, error } = await API.getSession();
      if (error) console.error('[App.init] Session error:', error);

      if (session) {
        console.log('[App.init] Logged in user:', session.user.email);
        this.currentUser = session.user;
        this.showApp();
      } else {
        console.log('[App.init] Showing auth view.');
        this.showAuth();
      }
    } catch (err) {
      console.error('[App.init] Unexpected error:', err);
    }
  },

  showAuth() {
    const auth = document.getElementById('auth-container');
    const app = document.getElementById('app-container');
    const tabBar = document.getElementById('bottom-tab-bar');

    if (auth) auth.style.display = 'block';
    if (app) app.style.display = 'none';
    if (tabBar) tabBar.style.display = 'none';
  },

  async showApp() {
    const auth = document.getElementById('auth-container');
    const app = document.getElementById('app-container');
    const tabBar = document.getElementById('bottom-tab-bar');

    if (auth) auth.style.display = 'none';
    if (app) app.style.display = 'block';
    if (tabBar) tabBar.style.display = 'flex';

    const userEmailElem = document.getElementById('user-email-display');
    if (userEmailElem && this.currentUser) {
      userEmailElem.innerText = `Logged in as: ${this.currentUser.email}`;
    }

    await this.loadHabits();
  },

  async handleLogin() {
    const emailElem = document.getElementById('auth-email');
    const passElem = document.getElementById('auth-password');
    const errElem = document.getElementById('auth-error');

    if (!emailElem || !passElem) return;

    const email = emailElem.value.trim();
    const password = passElem.value.trim();

    if (!email || !password) {
      if (errElem) errElem.innerText = 'Please enter your email and password.';
      return;
    }

    const { data, error } = await API.login(email, password);
    if (error) {
      if (errElem) errElem.innerText = 'Invalid login credentials!';
    } else {
      if (errElem) errElem.innerText = '';
      this.currentUser = data.user;
      this.showApp();
    }
  },

  async handleSignUp() {
    const emailElem = document.getElementById('auth-email');
    const passElem = document.getElementById('auth-password');
    const errElem = document.getElementById('auth-error');

    const email = emailElem ? emailElem.value.trim() : '';
    const password = passElem ? passElem.value.trim() : '';

    if (!email || !password) {
      if (errElem) errElem.innerText = 'Please enter both an email address and a password to sign up.';
      return;
    }

    const { data, error } = await API.signUp(email, password);

    if (error) {
      if (errElem) errElem.innerText = error.message;
      return;
    }

    if (data && data.user && data.user.identities && data.user.identities.length === 0) {
      if (errElem) errElem.innerText = 'An account with this email already exists. Please log in instead.';
      return;
    }

    if (errElem) errElem.innerText = 'Registration successful! Please check your inbox to confirm your email.';
  },

  async logout() {
    await API.logout();
    this.currentUser = null;
    this.showAuth();
  },

  toggleAuthMode() {
    this.authMode = this.authMode === 'login' ? 'signup' : 'login';

    const titleElem = document.getElementById('auth-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const promptElem = document.getElementById('auth-toggle-prompt');
    const toggleBtn = document.getElementById('auth-toggle-btn');
    const errElem = document.getElementById('auth-error');

    if (this.authMode === 'signup') {
      if (titleElem) titleElem.innerText = 'Sign Up';
      if (submitBtn) submitBtn.innerText = 'Sign Up';
      if (promptElem) promptElem.innerText = 'Already have an account?';
      if (toggleBtn) toggleBtn.innerText = 'Log In';
    } else {
      if (titleElem) titleElem.innerText = 'Log In';
      if (submitBtn) submitBtn.innerText = 'Log In';
      if (promptElem) promptElem.innerText = "Don't have an account?";
      if (toggleBtn) toggleBtn.innerText = 'Sign Up';
    }

    if (errElem) errElem.innerText = '';
  },

  handleAuthSubmit() {
    if (this.authMode === 'signup') {
      this.handleSignUp();
    } else {
      this.handleLogin();
    }
  },

  async handleGoogleLogin() {
    console.log('[App.handleGoogleLogin] Starting Google OAuth...');
    const { error } = await API.loginWithGoogle();
    if (error) {
      console.error('[App.handleGoogleLogin] Error:', error);
      const errElem = document.getElementById('auth-error');
      if (errElem) errElem.innerText = error.message;
    }
  },

  async loadHabits() {
    if (!this.currentUser) return;
    const todayStr = UI.getLocalDateString();
    const mondayStr = this.getWeekStartString();
    console.log(`[App.loadHabits] Loading habits (${todayStr})...`);

    const { data: habitsData, error: habitsError } = await API.fetchActiveHabits(this.currentUser.id);
    if (habitsError) console.error('[App.loadHabits] Error:', habitsError);

    const { data: logsData, error: logsError } = await API.fetchLogsByDate(todayStr);
    if (logsError) console.error('[App.loadHabits] Error:', logsError);

    const { data: weekLogs, error: weekLogsError } = await API.fetchLogsRange(mondayStr);
    if (weekLogsError) console.error('[App.loadHabits] Error:', weekLogsError);

    const logsMap = {};
    if (logsData) logsData.forEach(l => logsMap[l.habit_id] = l);

    const weekCountsBeforeToday = {};
    if (weekLogs) {
      weekLogs.forEach(l => {
        if (l.completed !== false && l.log_date !== todayStr) {
          weekCountsBeforeToday[l.habit_id] = (weekCountsBeforeToday[l.habit_id] || 0) + 1;
        }
      });
    }

    this.habitsList = (habitsData || []).map(h => {
      const weeklyTarget = h.weekly_target || 7;
      const weekCountBeforeToday = weekCountsBeforeToday[h.id] || 0;
      return {
        ...h,
        completed: logsMap[h.id] ? logsMap[h.id].completed : false,
        weekCountBeforeToday,
        weeklyGoalMetBeforeToday: weekCountBeforeToday >= weeklyTarget
      };
    });
    const weekWidgetDays = this.buildWeekWidgetData(weekLogs, mondayStr, todayStr);
    const [my, mm, md] = mondayStr.split('-').map(Number);
    const monday = new Date(my, mm - 1, md);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const weekTitle = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const todayIndex = weekWidgetDays.findIndex(d => d.isToday);
    const dayNum = todayIndex >= 0 ? `Day ${todayIndex + 1}/7` : '';
    UI.renderWeekWidget(weekWidgetDays, weekTitle, dayNum);
    UI.renderHabits(this.habitsList);
  },  

  buildWeekWidgetData(weekLogs, mondayStr, todayStr) {
    const completedDates = new Set();
    (weekLogs || []).forEach(l => {
      if (l.completed !== false) completedDates.add(l.log_date);
    });
  
    const [my, mm, md] = mondayStr.split('-').map(Number);
    const monday = new Date(my, mm - 1, md);
  
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const dateStr = UI.getLocalDateString(d);
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
  
      let status;
      if (isFuture) status = 'future';
      else if (completedDates.has(dateStr)) status = 'done';
      else if (isToday) status = 'pending';
      else status = 'missed';
  
      days.push({ dateStr, label: d.toLocaleDateString('en-US', { weekday: 'narrow' }), isToday, status });
    }
    return days;
  },

  getWeekStartString(dateObj = new Date()) {
    const d = new Date(dateObj);
    const dow = d.getDay();
    const diffToMonday = (dow === 0 ? -6 : 1) - dow;
    d.setDate(d.getDate() + diffToMonday);
    return UI.getLocalDateString(d);
  },

  async handleToggleHabit(habitId) {
    console.log(`[App.handleToggleHabit] Toggling ID: ${habitId}`);
    const todayStr = UI.getLocalDateString();

    const habit = this.habitsList.find(h => String(h.id) === String(habitId));

    if (!habit) {
      console.error(`[App.handleToggleHabit] Habit not found. ID: ${habitId}`);
      return;
    }

    habit.completed = !habit.completed;
    UI.updateProgress(this.habitsList);

    if (habit.completed) {
      const { error } = await API.addLog(habitId, todayStr);
      if (error) {
        console.error('[App.handleToggleHabit] Error while saving:', error);
        habit.completed = false;
      }
    } else {
      const { error } = await API.removeLog(habitId, todayStr);
      if (error) {
        console.error('[App.handleToggleHabit] Error while removing:', error);
        habit.completed = true;
      }
    }
    UI.updateProgress(this.habitsList);
  },

  async openAddModal() {
    console.log('[App.openAddModal] Opening new habit modal.');
    this.editingHabitId = null;

    const nameInput = document.getElementById('habit-name-input');
    const freqInput = document.getElementById('habit-freq-input');
    const timeInput = document.getElementById('habit-time-input');
    const modalTitle = document.getElementById('modal-title');
    const modal = document.getElementById('habit-modal');
    const inactiveWrapper = document.getElementById('inactive-habits-wrapper');
    const inactiveSelect = document.getElementById('inactive-habits-select');

    if (modalTitle) modalTitle.innerText = 'Add New Habit';
    if (nameInput) nameInput.value = '';
    if (freqInput) freqInput.value = '7';
    if (timeInput) timeInput.value = '0';

    if (this.currentUser) {
      const { data: inactive, error } = await API.fetchInactiveHabits(this.currentUser.id);
      if (!error && inactive && inactive.length > 0) {
        this.inactiveHabitsList = inactive;
        if (inactiveSelect) {
          inactiveSelect.innerHTML = '<option value="">-- Choose from previous --</option>' +
            inactive.map(h => `<option value="${h.id}">${h.title}</option>`).join('');
        }
        if (inactiveWrapper) inactiveWrapper.style.display = 'block';
      } else {
        if (inactiveWrapper) inactiveWrapper.style.display = 'none';
      }
    }

    if (modal) modal.style.display = 'flex';
  },

  handleSelectInactiveHabit(habitId) {
    console.log('[App.handleSelectInactiveHabit] Selected inactive habit ID:', habitId);
    if (!habitId) {
      this.editingHabitId = null;
      document.getElementById('habit-name-input').value = '';
      return;
    }

    const selected = this.inactiveHabitsList.find(h => String(h.id) === String(habitId));
    if (selected) {
      this.editingHabitId = selected.id;
      document.getElementById('habit-name-input').value = selected.title;
      document.getElementById('habit-freq-input').value = selected.weekly_target || 7;
      document.getElementById('habit-time-input').value = selected.target_minutes || 0;
    }
  },

  openEditModal(habitId) {
    console.log(`[App.openEditModal] Opening edit modal -> Habit ID: ${habitId}`);

    const habit = this.habitsList.find(h => String(h.id) === String(habitId));

    if (!habit) {
      console.error(`[App.openEditModal] Habit not found. ID: ${habitId}`);
      return;
    }

    this.editingHabitId = habitId;

    const inactiveWrapper = document.getElementById('inactive-habits-wrapper');
    if (inactiveWrapper) inactiveWrapper.style.display = 'none';

    const nameInput = document.getElementById('habit-name-input');
    const freqInput = document.getElementById('habit-freq-input');
    const timeInput = document.getElementById('habit-time-input');
    const modalTitle = document.getElementById('modal-title');
    const modal = document.getElementById('habit-modal');

    if (modalTitle) modalTitle.innerText = 'Edit Habit';
    if (nameInput) nameInput.value = habit.title;
    if (freqInput) freqInput.value = habit.weekly_target || 7;
    if (timeInput) timeInput.value = habit.target_minutes || 0;
    if (modal) modal.style.display = 'flex';
  },

  closeModal() {
    this.editingHabitId = null;
    const modal = document.getElementById('habit-modal');
    if (modal) modal.style.display = 'none';
  },

  async saveHabitModal() {
    console.log('[App.saveHabitModal] Starting save. Target ID:', this.editingHabitId);
    const titleElem = document.getElementById('habit-name-input');
    const freqElem = document.getElementById('habit-freq-input');
    const timeElem = document.getElementById('habit-time-input');

    const title = titleElem ? titleElem.value.trim() : '';
    const targetNum = freqElem ? (parseInt(freqElem.value.trim()) || 7) : 7;
    const targetMins = timeElem ? (parseInt(timeElem.value.trim()) || 0) : 0;

    if (!title) {
      alert('Please enter a habit name.');
      return;
    }

    if (!this.currentUser) return;

    if (this.editingHabitId) {
      const isInactive = this.inactiveHabitsList.some(h => String(h.id) === String(this.editingHabitId));
      if (isInactive) {
        console.log('[App.saveHabitModal] Reactivating inactive habit...');
        await API.reactivateHabit(this.editingHabitId, title, targetNum, targetMins);
      } else {
        console.log('[App.saveHabitModal] Updating active habit...');
        await API.updateHabit(this.editingHabitId, title, targetNum, targetMins);
      }
    } else {
      console.log('[App.saveHabitModal] Creating new habit...');
      await API.createHabit(this.currentUser.id, title, targetNum, targetMins);
    }

    this.closeModal();
    await this.loadHabits();
  },

  handleDeleteHabit(habitId) {
    console.log(`[App.handleDeleteHabit] Opening delete modal -> ID: ${habitId}`);
    this.pendingDeleteId = habitId;
    const modal = document.getElementById('delete-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeDeleteModal() {
    this.pendingDeleteId = null;
    const modal = document.getElementById('delete-modal');
    if (modal) modal.style.display = 'none';
  },

  async confirmDeleteHabit() {
    const habitId = this.pendingDeleteId;
    if (!habitId) return;
    console.log(`[App.confirmDeleteHabit] Soft delete (deactivate) starting -> ID: ${habitId}`);

    const { error } = await API.softDeleteHabit(habitId);
    if (error) {
      console.error('[App.confirmDeleteHabit] Error while deactivating:', error);
    } else {
      console.log('[App.confirmDeleteHabit] Successfully deactivated.');
      this.closeDeleteModal();
      await this.loadHabits();
      return;
    }
    this.closeDeleteModal();
  },

  switchTab(tab) {
    document.querySelectorAll('.tab-item').forEach(btn => btn.classList.remove('active'));
    const tabBtn = document.getElementById(`tab-${tab}`);
    if (tabBtn) tabBtn.classList.add('active');

    const homeView = document.getElementById('view-home');
    const statsView = document.getElementById('view-stats');
    const profileView = document.getElementById('view-profile');

    if (homeView) homeView.style.display = tab === 'home' ? 'block' : 'none';
    if (statsView) statsView.style.display = tab === 'stats' ? 'block' : 'none';
    if (profileView) profileView.style.display = tab === 'profile' ? 'block' : 'none';

    if (tab === 'stats') {
      this.loadStatistics(this.activeStatsTab);
      this.loadHeatmap();
    }
    if (tab === 'profile') {
      this.loadProfileInactiveHabits();
      this.loadAchievements();
    }
  },

  switchStatsTab(type) {
    this.activeStatsTab = type;
    const wBtn = document.getElementById('btn-stats-weekly');
    const mBtn = document.getElementById('btn-stats-monthly');

    if (wBtn) wBtn.classList.toggle('active', type === 'weekly');
    if (mBtn) mBtn.classList.toggle('active', type === 'monthly');

    this.loadStatistics(type);
  },

  async loadStatistics(type) {
    if (!this.currentUser) return;

    const daysCount = type === 'weekly' ? 7 : 30;
    const STREAK_WINDOW_DAYS = 400;

    const { data: allHabitsHistory } = await API.fetchAllHabitsForStats(this.currentUser.id);

    const defaultWindowStart = new Date();
    defaultWindowStart.setDate(defaultWindowStart.getDate() - (STREAK_WINDOW_DAYS - 1));

    const fetchStartStr = UI.getLocalDateString(defaultWindowStart);
    const { data: logs } = await API.fetchLogsRange(fetchStartStr);

    const allDateStrings = [];
    const dayLabelByDate = {};
    const cursor = new Date(defaultWindowStart);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    while (cursor <= today) {
      const dateStr = UI.getLocalDateString(cursor);
      allDateStrings.push(dateStr);
      dayLabelByDate[dateStr] = type === 'weekly'
        ? cursor.toLocaleDateString('en-US', { weekday: 'short' })
        : `${(cursor.getMonth() + 1).toString().padStart(2, '0')}.${cursor.getDate().toString().padStart(2, '0')}.`;
      cursor.setDate(cursor.getDate() + 1);
    }

    const dailyResults = this.computeDailyPercents(
      allHabitsHistory || [],
      logs || [],
      allDateStrings
    );

    const rawCountByDate = {};
    allDateStrings.forEach(date => {
      rawCountByDate[date] = 0;
    });

    (logs || []).forEach(log => {
      if (
        rawCountByDate[log.log_date] !== undefined &&
        log.completed !== false
      ) {
        rawCountByDate[log.log_date]++;
      }
    });

    const periodDateStrings = allDateStrings.slice(-daysCount);
    const periodResults = dailyResults.slice(-daysCount);

    const labels = periodDateStrings.map(date => dayLabelByDate[date]);
    const dailyCounts = periodDateStrings.map(date => rawCountByDate[date]);
    const trendData = periodResults.map(result => result.percent);

    UI.renderBarChart(labels, dailyCounts);
    UI.renderLineChart(labels, trendData);

    // Szokásonkénti statisztika kiszámítása a kiválasztott időszakra (7 vagy 30 nap)
    const activeHabits = (allHabitsHistory || []).filter(h => !h.deactivated_at);
    const habitStats = activeHabits.map(h => {
      const habitLogs = (logs || []).filter(
        l => l.habit_id === h.id && periodDateStrings.includes(l.log_date) && l.completed !== false
      );
      const percent = Math.round((habitLogs.length / daysCount) * 100);
      return {
        title: h.title,
        percent: Math.min(100, percent)
      };
    });

    // Kártya feltöltése adatokkal
    UI.renderHabitStats(habitStats);

    const qualifiesSeries = dailyResults.map(
      result => result.denominator > 0 && result.count >= 1
    );

    const { current, best, todayQualifies } = this.computeStreaks(qualifiesSeries);

    UI.renderStreaks(current, best, todayQualifies);
  },

  computeDailyPercents(habitsList, logs, dateStrings) {
    const completedByHabit = {};
    const firstLogDateByHabit = {};
    
    habitsList.forEach(h => {
      completedByHabit[h.id] = new Set();
    });
    
    (logs || []).forEach(l => {
      if (l.completed !== false && completedByHabit[l.habit_id]) {
        completedByHabit[l.habit_id].add(l.log_date);
    
        if (
          !firstLogDateByHabit[l.habit_id] ||
          l.log_date < firstLogDateByHabit[l.habit_id]
        ) {
          firstLogDateByHabit[l.habit_id] = l.log_date;
        }
      }
    });

    const weekKeyOf = (dateStr) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const dow = dateObj.getDay();
      const diffToMonday = (dow === 0 ? -6 : 1) - dow;
      dateObj.setDate(dateObj.getDate() + diffToMonday);
      return UI.getLocalDateString(dateObj);
    };

    const results = dateStrings.map(dateStr => ({ dateStr, count: 0, denominator: 0, percent: 0 }));

    habitsList.forEach(h => {
      const weeklyTarget = h.weekly_target || 7;
      const createdDateStr =
        firstLogDateByHabit[h.id] ||
        (h.created_at ? h.created_at.slice(0, 10) : '1970-01-01');
      const deactivatedDateStr = h.deactivated_at ? h.deactivated_at.slice(0, 10) : null;

      let currentWeekKey = null;
      let weekCountBeforeToday = 0;

      dateStrings.forEach((dateStr, idx) => {
        const wk = weekKeyOf(dateStr);
        if (wk !== currentWeekKey) {
          currentWeekKey = wk;
          weekCountBeforeToday = 0;
        }

        const existedOnDay = createdDateStr <= dateStr && (!deactivatedDateStr || deactivatedDateStr > dateStr);
        const doneToday = completedByHabit[h.id].has(dateStr);
        const owedToday = existedOnDay && weekCountBeforeToday < weeklyTarget;

        if (owedToday) {
          results[idx].denominator++;
          if (doneToday) results[idx].count++;
        }

        if (existedOnDay && doneToday) weekCountBeforeToday++;
      });
    });

    results.forEach(r => {
      r.percent = r.denominator > 0 ? Math.round((r.count / r.denominator) * 100) : 0;
    });

    return results;
  },

  computeStreaks(qualifiesSeries) {
    const len = qualifiesSeries.length;
    if (len === 0) return { current: 0, best: 0, todayQualifies: false };

    const todayQualifies = qualifiesSeries[len - 1];
    const startIndex = todayQualifies ? len - 1 : len - 2;

    let current = 0;
    for (let i = startIndex; i >= 0; i--) {
      if (qualifiesSeries[i]) {
        current++;
      } else {
        break;
      }
    }

    let best = 0;
    let run = 0;
    qualifiesSeries.forEach(q => {
      if (q) {
        run++;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    });

    return { current, best, todayQualifies };
  },

  toggleInactiveAccordion() {
    const body = document.getElementById('inactive-accordion-body');
    const chevron = document.getElementById('inactive-accordion-chevron');
    if (!body) return;

    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.classList.toggle('open', !isOpen);
  },

  async loadProfileInactiveHabits() {
    if (!this.currentUser) return;
    console.log('[App.loadProfileInactiveHabits] Loading inactive habits...');

    const { data: inactive, error } = await API.fetchInactiveHabits(this.currentUser.id);
    if (error) {
      console.error('[App.loadProfileInactiveHabits] Error:', error);
      return;
    }

    this.inactiveHabitsList = inactive || [];
    UI.renderInactiveHabits(this.inactiveHabitsList);
  },

  async reactivateFromProfile(habitId) {
    console.log(`[App.reactivateFromProfile] Reactivating -> ID: ${habitId}`);
    const habit = this.inactiveHabitsList.find(h => String(h.id) === String(habitId));
    if (!habit) {
      console.error(`[App.reactivateFromProfile] Habit not found. ID: ${habitId}`);
      return;
    }

    const { error } = await API.reactivateHabit(habitId, habit.title, habit.weekly_target || 7, habit.target_minutes || 0);
    if (error) {
      console.error('[App.reactivateFromProfile] Error while reactivating:', error);
      return;
    }

    console.log('[App.reactivateFromProfile] Successfully reactivated.');
    await this.loadProfileInactiveHabits();
    await this.loadHabits();
  },
  
  async exportUserData() {
    if (!this.currentUser) return;

    try {
      const { data: habits, error: habitsErr } = await API.fetchAllHabitsForStats(this.currentUser.id);
      const { data: logs, error: logsErr } = await API.fetchLogsRange('2000-01-01');

      if (habitsErr || logsErr) throw new Error('Hiba az adatok lekérésekor');

      const habitMap = {};
      (habits || []).forEach(h => {
        habitMap[h.id] = h.title;
      });

      let csvContent = "Dátum;Szokás neve;Teljesítve\n";

      (logs || []).forEach(log => {
        const habitName = habitMap[log.habit_id] || "Ismeretlen szokás";
        const completed = log.completed ? "Igen" : "Nem";
        csvContent += `${log.log_date};"${habitName}";${completed}\n`;
      });

      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = URL.createObjectURL(blob);

      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = downloadUrl;
      downloadAnchor.download = `habit_tracker_export_${UI.getLocalDateString()}.csv`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();

      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(downloadUrl);

    } catch (error) {
      console.error('[App.exportUserData]', error);
      alert('Sikertelen CSV exportálás.');
    }
  },
  
  async loadHeatmap() {
    if (!this.currentUser) return;
    const HEATMAP_DAYS = 371;
    const { data: allHabitsHistory } = await API.fetchAllHabitsForStats(this.currentUser.id);
  
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - (HEATMAP_DAYS - 1));
    const fetchStartStr = UI.getLocalDateString(defaultStart);
    const { data: logs } = await API.fetchLogsRange(fetchStartStr);
  
    let earliestLogStr = null;
    (logs || []).forEach(l => {
      if (l.completed !== false && (!earliestLogStr || l.log_date < earliestLogStr)) {
        earliestLogStr = l.log_date;
      }
    });
  
    let windowStart = defaultStart;
  
    const dateStrings = [];
    const cursor = new Date(windowStart);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    while (cursor <= today) {
      dateStrings.push(UI.getLocalDateString(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
        
    const dailyResults = this.computeDailyPercents(
      allHabitsHistory || [],
      logs,
      dateStrings
    );
    
    const completedDates = new Set(
      (logs || [])
        .filter(log => log.completed !== false)
        .map(log => log.log_date)
    );
    
    const activityResults = dailyResults.filter(result =>
      completedDates.has(result.dateStr)
    );
    
    UI.renderHeatmap(activityResults);
  },

  async loadAchievements() {
    if (!this.currentUser) return;
    console.log('[App.loadAchievements] Loading achievements...');

    const { data: unlockedRows, error: unlockedError } = await API.fetchUserAchievements(this.currentUser.id);
    if (unlockedError) {
      console.error('[App.loadAchievements] Error fetching unlocked achievements:', unlockedError);
    }
    const unlockedMap = {};
    (unlockedRows || []).forEach(row => {
      unlockedMap[row.achievement_key] = row.unlocked_at;
    });

    const ALL_TIME_START = '2026-09-01';
    const { data: logs, error } = await API.fetchLogsRange(ALL_TIME_START);
    if (error) {
      console.error('[App.loadAchievements] Error:', error);
      return;
    }

    const { data: allHabitsHistory } = await API.fetchAllHabitsForStats(this.currentUser.id);

    const completedLogs = (logs || []).filter(l => l.completed !== false);
    const totalCheckins = completedLogs.length;

    let perfectDaysCount = 0;
    let bestStreakAllTime = 0;

    if (completedLogs.length > 0) {
      const sortedLogDates = completedLogs.map(l => l.log_date).sort();
      const [ey, em, ed] = sortedLogDates[0].split('-').map(Number);
      const cursor = new Date(ey, em - 1, ed);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const contiguousDates = [];
      while (cursor <= today) {
        contiguousDates.push(UI.getLocalDateString(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }

      const dailyResults = this.computeDailyPercents(allHabitsHistory || [], logs, contiguousDates);

      perfectDaysCount = dailyResults.filter(r => r.denominator > 0 && r.percent >= 100).length;

      const completedDates = new Set(
        completedLogs.map(log => log.log_date)
      );

      let run = 0;
      contiguousDates.forEach(dateStr => {
        if (completedDates.has(dateStr)) {
          run++;
          bestStreakAllTime = Math.max(bestStreakAllTime, run);
        } else {
          run = 0;
        }
      });
    }

    const activeHabitsCount = this.habitsList.length;

    const definitions = this.buildAchievementList({
      totalCheckins,
      perfectDaysCount,
      bestStreakAllTime,
      activeHabitsCount
    });

    for (const def of definitions) {
      if (def.metCondition && !unlockedMap[def.key]) {
        const { error: unlockError } = await API.unlockAchievement(this.currentUser.id, def.key);
        if (!unlockError) {
          unlockedMap[def.key] = new Date().toISOString();
          console.log(`[App.loadAchievements] Unlocked new achievement: ${def.key}`);
        }
      }
    }

    const achievements = definitions.map(def => ({
      icon: def.icon,
      name: def.name,
      description: def.description,
      unlocked: !!unlockedMap[def.key],
      unlockedAt: unlockedMap[def.key] || null
    }));

    this.achievementsList = achievements;
    UI.renderAchievements(achievements);
  },

  buildAchievementList(stats) {
    return [
      { key: 'streak_3', icon: 'game-icons:fire', name: 'Spark', description: 'Reach a 3-day streak', metCondition: stats.bestStreakAllTime >= 3 },
      { key: 'streak_7', icon: 'game-icons:flame', name: 'Week Warrior', description: 'Reach a 7-day streak', metCondition: stats.bestStreakAllTime >= 7 },
      { key: 'streak_14', icon: 'game-icons:fire-ring', name: 'Fortnight Fighter', description: 'Reach a 14-day streak', metCondition: stats.bestStreakAllTime >= 14 },
      { key: 'streak_30', icon: 'game-icons:fire-dash', name: 'Monthly Master', description: 'Reach a 30-day streak', metCondition: stats.bestStreakAllTime >= 30 },
      { key: 'streak_60', icon: 'game-icons:dragon-head', name: 'Unstoppable', description: 'Reach a 60-day streak', metCondition: stats.bestStreakAllTime >= 60 },
      { key: 'streak_100', icon: 'game-icons:laurels', name: 'Centurion', description: 'Reach a 100-day streak', metCondition: stats.bestStreakAllTime >= 100 },
      { key: 'checkins_10', icon: 'game-icons:boot-prints', name: 'First Steps', description: 'Log 10 check-ins', metCondition: stats.totalCheckins >= 10 },
      { key: 'checkins_100', icon: 'game-icons:muscle-up', name: 'Getting Serious', description: 'Log 100 check-ins', metCondition: stats.totalCheckins >= 100 },
      { key: 'checkins_500', icon: 'game-icons:gears', name: 'Habit Machine', description: 'Log 500 check-ins', metCondition: stats.totalCheckins >= 500 },
      { key: 'checkins_1000', icon: 'game-icons:trophy-cup', name: 'Legend', description: 'Log 1,000 check-ins', metCondition: stats.totalCheckins >= 1000 },
      { key: 'perfect_1', icon: 'game-icons:star-medal', name: 'Perfect Day', description: 'Complete every habit owed in one day', metCondition: stats.perfectDaysCount >= 1 },
      { key: 'perfect_10', icon: 'lucide:gem', name: 'Perfectionist', description: '10 perfect days', metCondition: stats.perfectDaysCount >= 10 },
      { key: 'perfect_30', icon: 'game-icons:gems', name: 'Flawless', description: '30 perfect days', metCondition: stats.perfectDaysCount >= 30 },
      { key: 'habits_3', icon: 'game-icons:seedling', name: 'Getting Started', description: 'Track 3 active habits', metCondition: stats.activeHabitsCount >= 3 },
      { key: 'habits_5', icon: 'game-icons:backpack', name: 'Habit Collector', description: 'Track 5 active habits', metCondition: stats.activeHabitsCount >= 5 },
      { key: 'habits_8', icon: 'game-icons:tied-scroll', name: 'Habit Master', description: 'Track 8 active habits', metCondition: stats.activeHabitsCount >= 8 }
    ];
  },

  openAchievementModal(index) {
    const achievement = this.achievementsList ? this.achievementsList[index] : null;
    if (!achievement) return;
    console.log('[App.openAchievementModal] Opening achievement:', achievement.name);
    UI.showAchievementDetail(achievement);
  },

  closeAchievementModal() {
    const modal = document.getElementById('achievement-modal');
    if (modal) modal.style.display = 'none';
  }
checkPwaBanner() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isDismissed = sessionStorage.getItem('pwa_banner_dismissed');

  if (!isStandalone && !isDismissed) {
    document.getElementById('pwa-banner').style.display = 'flex';
  }
},

closePwaBanner() {
  sessionStorage.setItem('pwa_banner_dismissed', 'true');
  document.getElementById('pwa-banner').style.display = 'none';
}
};
document.addEventListener('DOMContentLoaded', () => App.init());
