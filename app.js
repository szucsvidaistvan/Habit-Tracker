// Application Controller
const App = {
  currentUser: null,
  habitsList: [],
  inactiveHabitsList: [],
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
    console.log(`[App.loadHabits] Loading habits (${todayStr})...`);

    const { data: habitsData, error: habitsError } = await API.fetchActiveHabits(this.currentUser.id);
    if (habitsError) console.error('[App.loadHabits] Error:', habitsError);

    const { data: logsData, error: logsError } = await API.fetchLogsByDate(todayStr);
    if (logsError) console.error('[App.loadHabits] Error:', logsError);

    const logsMap = {};
    if (logsData) logsData.forEach(l => logsMap[l.habit_id] = l);

    this.habitsList = (habitsData || []).map(h => ({
      ...h,
      completed: logsMap[h.id] ? logsMap[h.id].completed : false
    }));

    UI.renderHabits(this.habitsList);
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
    if (tab === 'profile') this.loadProfileInactiveHabits();
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
    const datesList = [];
    const dateMap = {};

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = UI.getLocalDateString(d);
      const dayLabel = type === 'weekly'
        ? d.toLocaleDateString('en-US', { weekday: 'short' })
        : `${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getDate().toString().padStart(2,'0')}.`;

      datesList.push({ dateStr, dayLabel });
      dateMap[dateStr] = 0;
    }

    const startDateStr = datesList[0].dateStr;
    const { data: logs } = await API.fetchLogsRange(startDateStr);

    const habitCounts = {};
    if (logs) {
      logs.forEach(log => {
        if (dateMap[log.log_date] !== undefined) dateMap[log.log_date]++;
        if (log.completed !== false) {
          habitCounts[log.habit_id] = (habitCounts[log.habit_id] || 0) + 1;
        }
      });
    }

    const labels = datesList.map(d => d.dayLabel);
    const dailyCounts = datesList.map(d => dateMap[d.dateStr]);
    const totalHabitsCount = this.habitsList.length || 1;
    const trendData = datesList.map(d => Math.round((dateMap[d.dateStr] / totalHabitsCount) * 100));

    UI.renderBarChart(labels, dailyCounts);
    UI.renderLineChart(labels, trendData);

    // Per-habit completion breakdown for the selected period
    const habitStats = this.habitsList.map(h => {
      const count = habitCounts[h.id] || 0;
      const percent = daysCount > 0 ? Math.min(Math.round((count / daysCount) * 100), 100) : 0;
      return { title: h.title, percent };
    });
    UI.renderHabitStats(habitStats);
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
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
