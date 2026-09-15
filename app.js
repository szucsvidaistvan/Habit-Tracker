// A day counts toward a streak if at least this % of active habits were completed.
// Lower than 100% on purpose: some habits only need a few times a week, so
// demanding a literal 100% every single day would punish people unfairly.
const STREAK_THRESHOLD = 70;

// Application Controller
const App = {
  currentUser: null,
  habitsList: [],
  inactiveHabitsList: [],
  achievementsList: [],
  editingHabitId: null,
  pendingDeleteId: null,
  activeStatsTab: 'weekly',

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

    // Supabase returns success without an explicit error even if the account
    // already exists (privacy behavior). An empty `identities` array is the
    // official way to detect a duplicate sign-up attempt.
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

    // How many times was each habit already completed this week, NOT counting today.
    // If that already meets the weekly goal, today's checkbox becomes optional/bonus
    // instead of something still "owed" for the day.
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

    UI.renderHabits(this.habitsList);
  },

  // Monday of the week containing dateObj, as a 'YYYY-MM-DD' string.
  getWeekStartString(dateObj = new Date()) {
    const d = new Date(dateObj);
    const dow = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
    const diffToMonday = (dow === 0 ? -6 : 1) - dow;
    d.setDate(d.getDate() + diffToMonday);
    return UI.getLocalDateString(d);
  },

  async handleToggleHabit(habitId) {
    console.log(`[App.handleToggleHabit] Toggling ID: ${habitId}`);
    const todayStr = UI.getLocalDateString();

    // Type-safe lookup via String() conversion (Type Coercion Fix)
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

    // Fetch inactive habits for reactivation
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

    // Type-safe lookup via String() conversion
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

    if (tab === 'stats') this.loadStatistics(this.activeStatsTab);
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
    const STREAK_WINDOW_DAYS = 90;

    // Build a 90-day date + label scaffold (oldest -> newest, ending today).
    // The chart/per-habit views use a slice of this; the streak calculation
    // always uses the full window regardless of the Weekly/Monthly toggle.
    const allDateStrings = [];
    const dayLabelByDate = {};
    for (let i = STREAK_WINDOW_DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = UI.getLocalDateString(d);
      allDateStrings.push(dateStr);
      dayLabelByDate[dateStr] = type === 'weekly'
        ? d.toLocaleDateString('en-US', { weekday: 'short' })
        : `${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getDate().toString().padStart(2,'0')}.`;
    }

    const startDateStr = allDateStrings[0];
    const { data: logs } = await API.fetchLogsRange(startDateStr);

    // Weekly-quota-aware daily percentages: a habit stops counting against a
    // day once its weekly target was already met earlier that same week.
    const dailyResults = this.computeDailyPercents(this.habitsList, logs, allDateStrings);

    // Raw completion counts per day for the "Habits Completed" bar chart —
    // this one is a plain tally, not quota-adjusted, so bonus check-ins still show up.
    const rawCountByDate = {};
    allDateStrings.forEach(d => { rawCountByDate[d] = 0; });
    if (logs) {
      logs.forEach(log => {
        if (rawCountByDate[log.log_date] !== undefined && log.completed !== false) {
          rawCountByDate[log.log_date]++;
        }
      });
    }

    // Slice to the selected period for the charts
    const periodDateStrings = allDateStrings.slice(-daysCount);
    const periodResults = dailyResults.slice(-daysCount);
    const labels = periodDateStrings.map(d => dayLabelByDate[d]);
    const dailyCounts = periodDateStrings.map(d => rawCountByDate[d]);
    const trendData = periodResults.map(r => r.percent);

    UI.renderBarChart(labels, dailyCounts);
    UI.renderLineChart(labels, trendData);

    // Per-habit completion breakdown for the selected period, scaled to each
    // habit's own weekly cadence instead of a flat "every single day" bar.
    const periodDateSet = new Set(periodDateStrings);
    const habitPeriodCounts = {};
    if (logs) {
      logs.forEach(log => {
        if (periodDateSet.has(log.log_date) && log.completed !== false) {
          habitPeriodCounts[log.habit_id] = (habitPeriodCounts[log.habit_id] || 0) + 1;
        }
      });
    }
    const habitStats = this.habitsList.map(h => {
      const count = habitPeriodCounts[h.id] || 0;
      const weeklyTarget = h.weekly_target || 7;
      const expectedForPeriod = weeklyTarget * (daysCount / 7);
      const percent = expectedForPeriod > 0 ? Math.min(Math.round((count / expectedForPeriod) * 100), 100) : 0;
      return { title: h.title, percent };
    });
    UI.renderHabitStats(habitStats);

    // Streaks always look at the full 90-day window, independent of the toggle
    const percentSeries = dailyResults.map(r => r.percent);
    const { current, best, todayQualifies } = this.computeStreaks(percentSeries, STREAK_THRESHOLD);
    UI.renderStreaks(current, best, todayQualifies);
  },

  // For each date in dateStrings (oldest -> newest), works out how many active
  // habits were still "owed" that day (a habit stops being owed once its
  // weekly target was already met earlier in that same Mon-Sun week) and how
  // many of those owed habits were actually completed. percent is based on
  // that adjusted denominator, so a 4x/week habit doesn't drag the score down
  // on days after its weekly goal is already secured.
  computeDailyPercents(habitsList, logs, dateStrings) {
    const completedByHabit = {};
    habitsList.forEach(h => { completedByHabit[h.id] = new Set(); });

    (logs || []).forEach(l => {
      if (l.completed !== false && completedByHabit[l.habit_id]) {
        completedByHabit[l.habit_id].add(l.log_date);
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
      let currentWeekKey = null;
      let weekCountBeforeToday = 0;

      dateStrings.forEach((dateStr, idx) => {
        const wk = weekKeyOf(dateStr);
        if (wk !== currentWeekKey) {
          currentWeekKey = wk;
          weekCountBeforeToday = 0;
        }

        const doneToday = completedByHabit[h.id].has(dateStr);
        const owedToday = weekCountBeforeToday < weeklyTarget;

        if (owedToday) {
          results[idx].denominator++;
          if (doneToday) results[idx].count++;
        }

        if (doneToday) weekCountBeforeToday++;
      });
    });

    results.forEach(r => {
      r.percent = r.denominator > 0 ? Math.round((r.count / r.denominator) * 100) : 100;
    });

    return results;
  },

  // A "qualifying day" is a day where at least STREAK_THRESHOLD% of active
  // habits were completed. Today is treated specially: if it hasn't hit the
  // threshold yet, it's still "pending" rather than counted as a broken day —
  // the streak shown is the one secured through yesterday. As soon as today
  // crosses the threshold, it's folded into the count immediately.
  computeStreaks(percentSeries, threshold) {
    const len = percentSeries.length;
    if (len === 0) return { current: 0, best: 0, todayQualifies: false };

    const todayQualifies = percentSeries[len - 1] >= threshold;
    const startIndex = todayQualifies ? len - 1 : len - 2;

    let current = 0;
    for (let i = startIndex; i >= 0; i--) {
      if (percentSeries[i] >= threshold) {
        current++;
      } else {
        break;
      }
    }

    let best = 0;
    let run = 0;
    percentSeries.forEach(p => {
      if (p >= threshold) {
        run++;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    });

    return { current, best, todayQualifies };
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

  async loadAchievements() {
    if (!this.currentUser) return;
    console.log('[App.loadAchievements] Computing achievements...');

    // Use a far-back start date to approximate "all-time" history for badges.
    const ALL_TIME_START = '2020-01-01';
    const { data: logs, error } = await API.fetchLogsRange(ALL_TIME_START);
    if (error) {
      console.error('[App.loadAchievements] Error:', error);
      return;
    }

    const completedLogs = (logs || []).filter(l => l.completed !== false);
    const totalCheckins = completedLogs.length;

    // Build a CONTIGUOUS day-by-day series from the earliest completion to
    // today (not just the days that have logs) so streak runs aren't falsely
    // stitched together across gaps, then reuse the same weekly-quota-aware
    // percent calculation as the Stats tab.
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

      const dailyResults = this.computeDailyPercents(this.habitsList, logs, contiguousDates);

      perfectDaysCount = dailyResults.filter(r => r.denominator > 0 && r.percent >= 100).length;

      let run = 0;
      dailyResults.forEach(r => {
        if (r.percent >= STREAK_THRESHOLD) {
          run++;
          bestStreakAllTime = Math.max(bestStreakAllTime, run);
        } else {
          run = 0;
        }
      });
    }

    const activeHabitsCount = this.habitsList.length;

    const achievements = this.buildAchievementList({
      totalCheckins,
      perfectDaysCount,
      bestStreakAllTime,
      activeHabitsCount
    });

    this.achievementsList = achievements;
    UI.renderAchievements(achievements);
  },

  buildAchievementList(stats) {
    return [
      { icon: 'game-icons:fire', name: 'Spark', description: 'Reach a 3-day streak', unlocked: stats.bestStreakAllTime >= 3 },
      { icon: 'game-icons:flame', name: 'Week Warrior', description: 'Reach a 7-day streak', unlocked: stats.bestStreakAllTime >= 7 },
      { icon: 'game-icons:fire-ring', name: 'Fortnight Fighter', description: 'Reach a 14-day streak', unlocked: stats.bestStreakAllTime >= 14 },
      { icon: 'game-icons:fire-dash', name: 'Monthly Master', description: 'Reach a 30-day streak', unlocked: stats.bestStreakAllTime >= 30 },
      { icon: 'game-icons:dragon-head', name: 'Unstoppable', description: 'Reach a 60-day streak', unlocked: stats.bestStreakAllTime >= 60 },
      { icon: 'game-icons:laurels', name: 'Centurion', description: 'Reach a 100-day streak', unlocked: stats.bestStreakAllTime >= 100 },
      { icon: 'game-icons:footprint', name: 'First Steps', description: 'Log 10 check-ins', unlocked: stats.totalCheckins >= 10 },
      { icon: 'game-icons:muscle-up', name: 'Getting Serious', description: 'Log 100 check-ins', unlocked: stats.totalCheckins >= 100 },
      { icon: 'game-icons:gears', name: 'Habit Machine', description: 'Log 500 check-ins', unlocked: stats.totalCheckins >= 500 },
      { icon: 'game-icons:trophy-cup', name: 'Legend', description: 'Log 1,000 check-ins', unlocked: stats.totalCheckins >= 1000 },
      { icon: 'game-icons:star-medal', name: 'Perfect Day', description: 'Complete every habit owed in one day', unlocked: stats.perfectDaysCount >= 1 },
      { icon: 'lucide:gem', name: 'Perfectionist', description: '10 perfect days', unlocked: stats.perfectDaysCount >= 10 },
      { icon: 'game-icons:gems', name: 'Flawless', description: '30 perfect days', unlocked: stats.perfectDaysCount >= 30 },
      { icon: 'game-icons:seedling', name: 'Getting Started', description: 'Track 3 active habits', unlocked: stats.activeHabitsCount >= 3 },
      { icon: 'game-icons:backpack', name: 'Habit Collector', description: 'Track 5 active habits', unlocked: stats.activeHabitsCount >= 5 },
      { icon: 'game-icons:tied-scroll', name: 'Habit Master', description: 'Track 8 active habits', unlocked: stats.activeHabitsCount >= 8 }
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
};

document.addEventListener('DOMContentLoaded', () => App.init());
