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
  privacyGateActive: false,
  streakFreeze: { freezeCount: 2, maxFreezeCount: 2, lastRefillAt: null, nextRefillAt: null, pendingMissedDates: [] },
  freezeCountdownTimer: null,
  frozenDatesSet: new Set(),

  categoriesList: [],
  selectedCategoryId: null,

  tabOrder: ['tasks', 'home', 'stats', 'profile'],
  activeTabIndex: 1,

  // Tasks
  tasksList: [],
  taskCategoriesList: [],
  selectedTaskCategoryId: null,
  editingTaskId: null,
  pendingDeleteTaskId: null,
  taskRecurrenceType: 'once',
  selectedRecurrenceDays: [],
  suppressAchievementClose: false,
  achievementCoinRotation: 0,
  achievementCoinInertiaFrame: null,

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
        await this.proceedAfterAuth(session.user);
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
      userEmailElem.innerText = this.currentUser.email;
    }

    const avatarElem = document.getElementById('profile-avatar');
    if (avatarElem && this.currentUser && this.currentUser.email) {
      avatarElem.innerText = this.currentUser.email.charAt(0).toUpperCase();
    }

    await this.loadStreakFreezeState();
    await this.loadHabits();
    await this.loadTasks();
    this.switchTab('home');
  },

  // Shows the app, then blocks it behind the privacy modal if the user
  // (e.g. a Google sign-up, or a pre-existing account from before this
  // feature existed) has not yet recorded consent.
  async proceedAfterAuth(user) {
    this.currentUser = user;
    if (typeof Offline !== 'undefined') Offline.setOwner(user.id);
    await this.showApp();

    const consentAt = user && user.user_metadata ? user.user_metadata.privacy_consent_at : null;
    if (!consentAt) {
      this.openPrivacyModal(true);
    }
  },

  openPrivacyModal(gate = false) {
    this.privacyGateActive = gate;

    const modal = document.getElementById('privacy-modal');
    const footer = document.getElementById('privacy-modal-gate-footer');
    const closeBtn = document.getElementById('privacy-modal-close-btn');

    if (footer) footer.style.display = gate ? 'block' : 'none';
    if (closeBtn) closeBtn.style.display = gate ? 'none' : 'block';
    if (modal) modal.style.display = 'flex';
  },

  closePrivacyModal() {
    if (this.privacyGateActive) return;
    const modal = document.getElementById('privacy-modal');
    if (modal) modal.style.display = 'none';
  },

  async acceptPrivacyPolicy() {
    const nowIso = new Date().toISOString();
    const { data, error } = await API.updateConsent(nowIso);

    if (error) {
      console.error('[App.acceptPrivacyPolicy] Failed to save consent:', error);
      const note = document.querySelector('.privacy-gate-note');
      if (note) note.innerText = 'Hiba történt a mentés során, próbáld újra.';
      return;
    }

    if (data && data.user) this.currentUser = data.user;

    this.privacyGateActive = false;
    const modal = document.getElementById('privacy-modal');
    if (modal) modal.style.display = 'none';
  },

  setAuthMessage(text, isSuccess = false) {
    const errElem = document.getElementById('auth-error');
    if (!errElem) return;
    errElem.innerText = text;
    errElem.classList.toggle('auth-success', isSuccess);
  },

  async handleForgotPassword() {
    const emailElem = document.getElementById('auth-email');
    const email = emailElem ? emailElem.value.trim() : '';

    if (!email) {
      this.setAuthMessage('Enter your email address above first, then tap "Forgot password?".');
      return;
    }

    const { error } = await API.resetPassword(email);
    if (error) {
      console.error('[App.handleForgotPassword] Error:', error);
      this.setAuthMessage(error.message || 'Could not send the reset email. Try again later.');
      return;
    }

    // Same message whether or not the address has an account (no account probing).
    this.setAuthMessage('If this email has an account, a reset link is on its way. Check your inbox.', true);
  },

  openPasswordResetModal() {
    const modal = document.getElementById('password-reset-modal');
    if (modal) modal.style.display = 'flex';
  },

  async submitNewPassword() {
    const pw = document.getElementById('new-password-input');
    const confirmPw = document.getElementById('new-password-confirm');
    const errElem = document.getElementById('password-reset-error');
    const setError = msg => { if (errElem) errElem.innerText = msg; };

    const password = pw ? pw.value : '';
    if (password.length < 6) {
      setError('The password must be at least 6 characters long.');
      return;
    }
    if (password !== (confirmPw ? confirmPw.value : '')) {
      setError('The two passwords do not match.');
      return;
    }

    const { error } = await API.updatePassword(password);
    if (error) {
      console.error('[App.submitNewPassword] Error:', error);
      setError(error.message || 'Could not change the password.');
      return;
    }

    setError('');
    if (pw) pw.value = '';
    if (confirmPw) confirmPw.value = '';
    const modal = document.getElementById('password-reset-modal');
    if (modal) modal.style.display = 'none';

    // drop the recovery tokens from the address bar
    history.replaceState(null, '', window.location.pathname);
    alert('Password updated. You are now logged in.');
  },

  async handleLogin() {
    const staleMsg = document.getElementById('auth-error');
    if (staleMsg) staleMsg.classList.remove('auth-success');

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
      await this.proceedAfterAuth(data.user);
    }
  },

  async handleSignUp() {
    const staleMsg = document.getElementById('auth-error');
    if (staleMsg) staleMsg.classList.remove('auth-success');

    const emailElem = document.getElementById('auth-email');
    const passElem = document.getElementById('auth-password');
    const errElem = document.getElementById('auth-error');

    const email = emailElem ? emailElem.value.trim() : '';
    const password = passElem ? passElem.value.trim() : '';

    if (!email || !password) {
      if (errElem) errElem.innerText = 'Please enter both an email address and a password to sign up.';
      return;
    }

    const consentElem = document.getElementById('auth-consent-checkbox');
    if (!consentElem || !consentElem.checked) {
      if (errElem) errElem.innerText = 'Az adatvédelmi tájékoztató elfogadása kötelező a regisztrációhoz.';
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
    const staleMsg = document.getElementById('auth-error');
    if (staleMsg) staleMsg.classList.remove('auth-success');

    this.authMode = this.authMode === 'login' ? 'signup' : 'login';

    const titleElem = document.getElementById('auth-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const promptElem = document.getElementById('auth-toggle-prompt');
    const toggleBtn = document.getElementById('auth-toggle-btn');
    const errElem = document.getElementById('auth-error');
    const consentRow = document.getElementById('auth-consent-row');
    const forgotRow = document.getElementById('auth-forgot-row');
    if (forgotRow) forgotRow.style.display = this.authMode === 'signup' ? 'none' : 'block';

    if (this.authMode === 'signup') {
      if (titleElem) titleElem.innerText = 'Sign Up';
      if (submitBtn) submitBtn.innerText = 'Sign Up';
      if (promptElem) promptElem.innerText = 'Already have an account?';
      if (toggleBtn) toggleBtn.innerText = 'Log In';
      if (consentRow) consentRow.style.display = 'flex';
    } else {
      if (titleElem) titleElem.innerText = 'Log In';
      if (submitBtn) submitBtn.innerText = 'Log In';
      if (promptElem) promptElem.innerText = "Don't have an account?";
      if (toggleBtn) toggleBtn.innerText = 'Sign Up';
      if (consentRow) consentRow.style.display = 'none';
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

    const [
      { data: categoryData, error: categoryError },
      { data: habitsData, error: habitsError },
      { data: logsData, error: logsError },
      { data: weekLogs, error: weekLogsError }
    ] = await Promise.all([
      API.fetchCategories(this.currentUser.id),
      API.fetchActiveHabits(this.currentUser.id),
      API.fetchLogsByDate(todayStr),
      API.fetchLogsRange(mondayStr)
    ]);

    if (categoryError) console.error('[App.loadHabits] Categories error:', categoryError);
    if (habitsError) console.error('[App.loadHabits] Habit error:', habitsError);
    if (logsError) console.error('[App.loadHabits] Logs error:', logsError);
    if (weekLogsError) console.error('[App.loadHabits] Weekly logs error:', weekLogsError);

    this.categoriesList = categoryData || [];
    this.selectedCategoryId = this.selectedCategoryId || this.categoriesList[0]?.id || null;

    const logsMap = {};
    (logsData || []).forEach(l => logsMap[l.habit_id] = l);

    const weekCountsBeforeToday = {};
    (weekLogs || []).forEach(l => {
      if (l.completed !== false && l.log_date !== todayStr) {
        weekCountsBeforeToday[l.habit_id] = (weekCountsBeforeToday[l.habit_id] || 0) + 1;
      }
    });

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

    const weekWidgetDays = this.buildWeekWidgetData(weekLogs, mondayStr, todayStr, this.frozenDatesSet);
    const [my, mm, md] = mondayStr.split('-').map(Number);
    const monday = new Date(my, mm - 1, md);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const weekTitle = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const todayIndex = weekWidgetDays.findIndex(d => d.isToday);
    const dayNum = todayIndex >= 0 ? `Day ${todayIndex + 1}/7` : '';

    this.weekWidgetDays = weekWidgetDays;
    this.weekWidgetTitle = weekTitle;
    this.weekWidgetDayNum = dayNum;

    UI.renderCategorySelect(this.categoriesList, this.selectedCategoryId);
    UI.renderWeekWidget(weekWidgetDays, weekTitle, dayNum);
    UI.renderHabits(this.habitsList, this.categoriesList);
    this.adjustSliderHeight();
  },

  buildWeekWidgetData(weekLogs, mondayStr, todayStr, frozenDates) {
    const frozen = frozenDates || new Set();
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
      else if (frozen.has(dateStr)) status = 'frozen';
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
    this.refreshTodayWeekDot();

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
    this.refreshTodayWeekDot();
  },

  refreshTodayWeekDot() {
    if (!this.weekWidgetDays) return;
    const todayEntry = this.weekWidgetDays.find(d => d.isToday);
    if (!todayEntry) return;

    const anyCompletedToday = this.habitsList.some(h => h.completed);
    todayEntry.status = anyCompletedToday ? 'done' : 'pending';

    UI.renderWeekWidget(this.weekWidgetDays, this.weekWidgetTitle, this.weekWidgetDayNum);
  },

  async openAddModal() {
    console.log('[App.openAddModal] Opening new habit modal.');
    this.editingHabitId = null;
    this.selectedCategoryId = this.categoriesList[0]?.id || null;

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

    UI.renderCategorySelect(this.categoriesList, this.selectedCategoryId);

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
      const nameInput = document.getElementById('habit-name-input');
      if (nameInput) nameInput.value = '';
      return;
    }

    const selected = this.inactiveHabitsList.find(h => String(h.id) === String(habitId));
    if (selected) {
      this.editingHabitId = selected.id;
      const nameInput = document.getElementById('habit-name-input');
      const freqInput = document.getElementById('habit-freq-input');
      const timeInput = document.getElementById('habit-time-input');
      const categoryInput = document.getElementById('habit-category-input');

      if (nameInput) nameInput.value = selected.title;
      if (freqInput) freqInput.value = selected.weekly_target || 7;
      if (timeInput) timeInput.value = selected.target_minutes || 0;
      if (categoryInput) categoryInput.value = selected.category_id || this.categoriesList[0]?.id || '';
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
    this.selectedCategoryId = habit.category_id || this.categoriesList[0]?.id || null;

    const inactiveWrapper = document.getElementById('inactive-habits-wrapper');
    if (inactiveWrapper) inactiveWrapper.style.display = 'none';

    const nameInput = document.getElementById('habit-name-input');
    const freqInput = document.getElementById('habit-freq-input');
    const timeInput = document.getElementById('habit-time-input');
    const categoryInput = document.getElementById('habit-category-input');
    const modalTitle = document.getElementById('modal-title');
    const modal = document.getElementById('habit-modal');

    if (modalTitle) modalTitle.innerText = 'Edit Habit';
    if (nameInput) nameInput.value = habit.title;
    if (freqInput) freqInput.value = habit.weekly_target || 7;
    if (timeInput) timeInput.value = habit.target_minutes || 0;
    if (categoryInput) categoryInput.value = habit.category_id || '';

    UI.renderCategorySelect(this.categoriesList, this.selectedCategoryId);

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
    const categoryElem = document.getElementById('habit-category-input');

    const title = titleElem ? titleElem.value.trim() : '';
    const targetNum = freqElem ? (parseInt(freqElem.value.trim()) || 7) : 7;
    const targetMins = timeElem ? (parseInt(timeElem.value.trim()) || 0) : 0;
    const categoryId = categoryElem ? categoryElem.value || null : null;

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
        await API.updateHabit(this.editingHabitId, title, targetNum, targetMins, categoryId);
      }
    } else {
      console.log('[App.saveHabitModal] Creating new habit...');
      const currentCategoryHabits = this.habitsList.filter(h => String(h.category_id || '') === String(categoryId || ''));
      await API.createHabit(this.currentUser.id, title, targetNum, targetMins, categoryId, currentCategoryHabits.length);
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
    const index = this.tabOrder.indexOf(tab);
    if (index === -1) return;

    document.querySelectorAll('.tab-item').forEach(btn => btn.classList.remove('active'));
    const tabBtn = document.getElementById(`tab-${tab}`);
    if (tabBtn) tabBtn.classList.add('active');

    this.activeTabIndex = index;
    const slider = document.getElementById('tabs-slider');
    if (slider) {
      slider.classList.remove('no-transition');
      slider.style.transform = `translateX(-${index * 25}%)`;
    }
    this.adjustSliderHeight();

    if (tab === 'tasks') {
      this.loadTasks();
    }
    if (tab === 'stats') {
      this.loadStatistics(this.activeStatsTab);
      this.loadHeatmap();
    }
    if (tab === 'profile') {
      this.loadProfileInactiveHabits();
      this.loadAchievements();
      UI.renderFreezeCard(this.streakFreeze);
    }
  },

  // Sizes the sliding row to the height of the tab that's currently visible,
  // instead of the flex-row default of stretching every tab to match the
  // tallest one (which was leaving a big empty gap under shorter tabs).
  adjustSliderHeight() {
    const slider = document.getElementById('tabs-slider');
    if (!slider) return;
    const activePanel = slider.children[this.activeTabIndex];
    if (!activePanel) return;

    requestAnimationFrame(() => {
      // Never shorter than the visible screen, otherwise the empty area under
      // a short page isn't part of the slider and swipes there do nothing.
      const top = slider.getBoundingClientRect().top + window.scrollY;
      const minHeight = Math.max(0, window.innerHeight - top - 100);
      slider.style.height = Math.max(activePanel.offsetHeight, minHeight) + 'px';
    });
  },

  // Lets the user swipe left/right between the Home / Stats / Profile
  // pages instead of only using the bottom tab bar.
  setupSwipeNavigation() {
    const slider = document.getElementById('tabs-slider');
    if (!slider) return;

    // How far (in px) a drag that starts on a habit card has to travel
    // before we treat it as "the user wants to change page" instead of
    // "the user wants to reveal the edit/delete buttons". The card's own
    // gesture (in ui.js) tops out around 128-148px, so this sits safely
    // beyond that.
    const CARD_ESCAPE_PX = 170;

    let startX = 0, startY = 0, currentX = 0;
    let tracking = false;      // a pointer is down and we're watching it
    let decided = false;       // this gesture is now driving the page slider
    let startedOnCard = false; // the gesture began on a swipeable habit row
    let escapeOffset = 0;      // set once a card-originated drag "escapes" past CARD_ESCAPE_PX
    let containerWidth = 0;

    const basePercent = () => -this.activeTabIndex * 25;

    slider.addEventListener('pointerdown', (e) => {
      // Normal form controls keep their own interactions.
      if (e.target.closest('input, textarea, select')) return;

      startX = e.clientX;
      startY = e.clientY;
      currentX = startX;
      tracking = true;
      decided = false;
      escapeOffset = 0;
      startedOnCard = !!e.target.closest('.habit-item');
      containerWidth = slider.parentElement.getBoundingClientRect().width || 1;
    });

    slider.addEventListener('pointermove', (e) => {
      if (!tracking) return;
      currentX = e.clientX;
      const diffX = currentX - startX;
      const diffY = e.clientY - startY;

      if (!decided) {
        if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) return;
        if (Math.abs(diffY) > Math.abs(diffX)) {
          tracking = false; // vertical scroll intent, let the page scroll normally
          return;
        }

        if (startedOnCard && Math.abs(diffX) <= CARD_ESCAPE_PX) {
          // Still within the habit card's own reveal range - let its
          // listener (in ui.js) handle this movement. Keep watching in
          // case the drag keeps going and turns into a real page swipe.
          return;
        }

        decided = true;
        if (startedOnCard) escapeOffset = diffX > 0 ? CARD_ESCAPE_PX : -CARD_ESCAPE_PX;
        slider.style.willChange = 'transform';
        slider.classList.add('no-transition');
        try { slider.setPointerCapture(e.pointerId); } catch (_) {}
      }

      const effectiveDiff = diffX - escapeOffset;

      let clampedDiff = effectiveDiff;
      const atFirstTab = this.activeTabIndex === 0;
      const atLastTab = this.activeTabIndex === this.tabOrder.length - 1;
      if (atFirstTab && clampedDiff > 0) clampedDiff = clampedDiff * 0.35;
      if (atLastTab && clampedDiff < 0) clampedDiff = clampedDiff * 0.35;

      const percentDiff = (clampedDiff / containerWidth) * 25;
      slider.style.transform = `translateX(${basePercent() + percentDiff}%)`;
      e.preventDefault();
    });

    const endDrag = (e) => {
      if (!tracking) return;
      tracking = false;
      slider.classList.remove('no-transition');
      slider.style.willChange = 'auto';

      if (!decided) return; // stayed inside the card's own gesture, or was just a tap

      try { slider.releasePointerCapture(e.pointerId); } catch (_) {}

      const effectiveDiff = (currentX - startX) - escapeOffset;
      const threshold = containerWidth * 0.18;

      let targetIndex = this.activeTabIndex;
      if (effectiveDiff < -threshold && this.activeTabIndex < this.tabOrder.length - 1) {
        targetIndex = this.activeTabIndex + 1;
      } else if (effectiveDiff > threshold && this.activeTabIndex > 0) {
        targetIndex = this.activeTabIndex - 1;
      }

      this.switchTab(this.tabOrder[targetIndex]);
    };

    slider.addEventListener('pointerup', endDrag);
    slider.addEventListener('pointercancel', endDrag);
  },

  async loadStreakFreezeState() {
    if (!this.currentUser) return;
    try {
      let { data: state, error } = await API.fetchStreakState(this.currentUser.id);
      if (error) console.error('[App.loadStreakFreezeState] fetch error:', error);

      if (!state) {
        const { data: created, error: createErr } = await API.createStreakState(this.currentUser.id);
        if (createErr) {
          console.error('[App.loadStreakFreezeState] create error:', createErr);
          return;
        }
        state = created;
      }

      const msPerDay = 24 * 60 * 60 * 1000;
      const now = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const yesterdayStr = UI.getLocalDateString(yesterday);

      const maxFreeze = state.max_freeze_count || 2;
      let freezeCount = state.freeze_count;
      let lastRefillAt = new Date(state.last_freeze_refill_at);

      let daysSinceRefill = Math.floor((now - lastRefillAt) / msPerDay);
      while (daysSinceRefill >= 14) {
        if (freezeCount < maxFreeze) freezeCount++;
        lastRefillAt = new Date(lastRefillAt.getTime() + 14 * msPerDay);
        daysSinceRefill -= 14;
      }

      const frozenDates = new Set(state.frozen_dates || []);
      const pendingMissedDates = new Set(state.pending_missed_dates || []);
      let lastChecked = state.last_checked_date;

      if (lastChecked < yesterdayStr) {
        const [ly, lm, ld] = lastChecked.split('-').map(Number);
        const rangeStart = new Date(ly, lm - 1, ld + 1);
        const rangeStartStr = UI.getLocalDateString(rangeStart);

        if (rangeStartStr <= yesterdayStr) {
          const { data: allHabitsHistory } = await API.fetchAllHabitsForStats(this.currentUser.id);
          const { data: logs } = await API.fetchLogsRange(rangeStartStr);

          const dateStrings = [];
          const cursor = new Date(rangeStart);
          while (cursor <= yesterday) {
            dateStrings.push(UI.getLocalDateString(cursor));
            cursor.setDate(cursor.getDate() + 1);
          }

          const dailyResults = this.computeDailyPercents(allHabitsHistory || [], logs || [], dateStrings);

          dailyResults.forEach(r => {
            const missed = r.denominator > 0 && r.count === 0;
            if (missed && !frozenDates.has(r.dateStr)) {
              pendingMissedDates.add(r.dateStr);
            }
          });
        }
        lastChecked = yesterdayStr;
      }

      const { error: updateErr } = await API.updateStreakState(this.currentUser.id, {
        freeze_count: freezeCount,
        last_freeze_refill_at: lastRefillAt.toISOString(),
        last_checked_date: lastChecked,
        frozen_dates: Array.from(frozenDates),
        pending_missed_dates: Array.from(pendingMissedDates).sort()
      });
      if (updateErr) console.error('[App.loadStreakFreezeState] update error:', updateErr);

      const nextRefillAt = freezeCount >= maxFreeze
        ? null
        : lastRefillAt.getTime() + 14 * msPerDay;

      this.streakFreeze = {
        freezeCount,
        maxFreezeCount: maxFreeze,
        lastRefillAt: lastRefillAt.getTime(),
        nextRefillAt,
        pendingMissedDates: Array.from(pendingMissedDates).sort()
      };
      this.frozenDatesSet = frozenDates;

      console.log('[App.loadStreakFreezeState] state loaded:', this.streakFreeze);

      UI.renderFreezeCard(this.streakFreeze);
      UI.renderFreezeBadgeHome(this.streakFreeze);
      this.startFreezeCountdownTimer();

      if (this.streakFreeze.pendingMissedDates.length > 0) {
        console.log('[App.loadStreakFreezeState] pending missed day(s) found, opening popup.');
        UI.openFreezeModal(this.streakFreeze);
      } else {
        console.log('[App.loadStreakFreezeState] no pending missed days.');
      }
    } catch (err) {
      console.error('[App.loadStreakFreezeState] Unexpected error:', err);
    }
  },

  closeFreezeModal() {
    UI.closeFreezeModal();
  },

  startFreezeCountdownTimer() {
    if (this.freezeCountdownTimer) clearInterval(this.freezeCountdownTimer);
    const tick = () => UI.updateFreezeCountdowns(this.streakFreeze.nextRefillAt, this.streakFreeze.freezeCount >= this.streakFreeze.maxFreezeCount);
    tick();
    this.freezeCountdownTimer = setInterval(tick, 60000);
  },

  async resolvePendingFreeze(dateStr, useFreeze) {
    if (!this.currentUser) return;
    console.log(`[App.resolvePendingFreeze] date=${dateStr} useFreeze=${useFreeze}`);

    const pending = new Set(this.streakFreeze.pendingMissedDates || []);
    if (!pending.has(dateStr)) return;
    pending.delete(dateStr);

    let freezeCount = this.streakFreeze.freezeCount;

    if (useFreeze) {
      if (freezeCount <= 0) return;
      freezeCount--;
      this.frozenDatesSet.add(dateStr);
    }

    const { error } = await API.updateStreakState(this.currentUser.id, {
      freeze_count: freezeCount,
      frozen_dates: Array.from(this.frozenDatesSet),
      pending_missed_dates: Array.from(pending).sort()
    });
    if (error) console.error('[App.resolvePendingFreeze] update error:', error);

    const msPerDay = 24 * 60 * 60 * 1000;
    const nextRefillAt = freezeCount >= this.streakFreeze.maxFreezeCount
      ? null
      : this.streakFreeze.lastRefillAt + 14 * msPerDay;

    this.streakFreeze = {
      ...this.streakFreeze,
      freezeCount,
      nextRefillAt,
      pendingMissedDates: Array.from(pending).sort()
    };

    UI.renderFreezeCard(this.streakFreeze);
    UI.renderFreezeBadgeHome(this.streakFreeze);
    this.startFreezeCountdownTimer();

    if (UI.isFreezeModalOpen()) {
      UI.openFreezeModal(this.streakFreeze);
    }

    if (this.weekWidgetDays) {
      const weekEntry = this.weekWidgetDays.find(d => d.dateStr === dateStr);
      if (weekEntry) {
        weekEntry.status = useFreeze ? 'frozen' : 'missed';
        UI.renderWeekWidget(this.weekWidgetDays, this.weekWidgetTitle, this.weekWidgetDayNum);
      }
    }

    if (this.activeStatsTab) this.loadStatistics(this.activeStatsTab);
    this.loadHeatmap();
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

    const dailyResults = this.computeDailyPercents(allHabitsHistory || [], logs || [], allDateStrings);

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

    UI.renderHabitStats(habitStats);

    const frozen = this.frozenDatesSet || new Set();
    const qualifiesSeries = dailyResults.map(
      result => (result.denominator > 0 && result.count >= 1) || frozen.has(result.dateStr)
    );

    const { current, best, todayQualifies } = this.computeStreaks(qualifiesSeries);

    UI.renderStreaks(current, best, todayQualifies);
    this.adjustSliderHeight();
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
    this.adjustSliderHeight();
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
    this.adjustSliderHeight();
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

    const dateStrings = [];
    const cursor = new Date(defaultStart);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    while (cursor <= today) {
      dateStrings.push(UI.getLocalDateString(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const dailyResults = this.computeDailyPercents(allHabitsHistory || [], logs || [], dateStrings);

    const completedDates = new Set(
      (logs || [])
        .filter(log => log.completed !== false)
        .map(log => log.log_date)
    );

    const frozen = this.frozenDatesSet || new Set();

    const activityResults = dailyResults.filter(result =>
      completedDates.has(result.dateStr) || frozen.has(result.dateStr)
    );

    UI.renderHeatmap(activityResults, frozen);
    this.adjustSliderHeight();
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

      const completedDates = new Set(completedLogs.map(log => log.log_date));
      (this.frozenDatesSet || new Set()).forEach(d => completedDates.add(d));

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
    this.adjustSliderHeight();
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

  resetAchievementCoin() {
    const coin = document.getElementById('achievement-coin');
    if (this.achievementCoinInertiaFrame) {
      cancelAnimationFrame(this.achievementCoinInertiaFrame);
      this.achievementCoinInertiaFrame = null;
    }
    this.achievementCoinRotation = 0;
    if (coin) {
      coin.style.transition = 'none';
      coin.style.transform = 'rotateY(0deg)';
      void coin.offsetWidth; // force reflow so the drop-in animation replays
      coin.style.transition = '';
    }
  },

  openAchievementModal(index) {
    const achievement = this.achievementsList ? this.achievementsList[index] : null;
    if (!achievement) return;
    console.log('[App.openAchievementModal] Opening achievement:', achievement.name);
    this.resetAchievementCoin();
    UI.showAchievementDetail(achievement);
  },

  closeAchievementModal() {
    const modal = document.getElementById('achievement-modal');
    if (modal) modal.style.display = 'none';
  },

  // Lets the opened achievement coin be dragged to spin around its vertical
  // axis like a real coin - flips over to a back face, keeps spinning with
  // inertia after release, then settles flat facing front or back.
  setupAchievementCardTilt() {
    const modal = document.getElementById('achievement-modal');
    const coin = document.getElementById('achievement-coin');
    if (!modal || !coin) return;

    // Build the coin's side wall: a stack of thin discs between the two faces.
    for (let z = -6; z <= 6; z++) {
      const layer = document.createElement('div');
      layer.className = 'coin-edge-layer';
      layer.style.transform = `translateZ(${z}px)`;
      coin.insertBefore(layer, coin.firstChild);
    }

    let startX = 0, lastX = 0, lastT = 0;
    let dragging = false, moved = false, velocity = 0; // velocity in deg/ms

    const applyRotation = () => {
      coin.style.transform = `rotateY(${this.achievementCoinRotation}deg)`;
    };

    const stopInertia = () => {
      if (this.achievementCoinInertiaFrame) {
        cancelAnimationFrame(this.achievementCoinInertiaFrame);
        this.achievementCoinInertiaFrame = null;
      }
    };

    coin.addEventListener('pointerdown', (e) => {
      stopInertia();
      coin.style.transition = 'none';
      startX = e.clientX;
      lastX = startX;
      lastT = performance.now();
      velocity = 0;
      dragging = true;
      moved = false;
      try { coin.setPointerCapture(e.pointerId); } catch (_) {}
    });

    coin.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      const dt = Math.max(1, now - lastT);

      if (Math.abs(e.clientX - startX) > 4) moved = true;

      const rotationStep = dx * 0.6;
      this.achievementCoinRotation += rotationStep;
      velocity = rotationStep / dt;
      applyRotation();

      lastX = e.clientX;
      lastT = now;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { coin.releasePointerCapture(e.pointerId); } catch (_) {}

      this.suppressAchievementClose = moved;

      const friction = 0.94;
      const step = () => {
        velocity *= friction;
        this.achievementCoinRotation += velocity * 16;
        applyRotation();

        if (Math.abs(velocity) > 0.01) {
          this.achievementCoinInertiaFrame = requestAnimationFrame(step);
        } else {
          this.achievementCoinInertiaFrame = null;
          this.settleAchievementCoin();
        }
      };

      if (Math.abs(velocity) > 0.02) {
        this.achievementCoinInertiaFrame = requestAnimationFrame(step);
      } else {
        this.settleAchievementCoin();
      }
    };

    coin.addEventListener('pointerup', endDrag);
    coin.addEventListener('pointercancel', endDrag);

    modal.addEventListener('click', () => {
      if (this.suppressAchievementClose) {
        this.suppressAchievementClose = false;
        return;
      }
      this.closeAchievementModal();
    });
  },

  // Snaps the coin flat to whichever face (front/back) it's closest to
  // after a drag or an inertia spin ends.
  settleAchievementCoin() {
    const coin = document.getElementById('achievement-coin');
    if (!coin) return;
    const nearest = Math.round(this.achievementCoinRotation / 180) * 180;
    this.achievementCoinRotation = nearest;
    coin.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
    coin.style.transform = `rotateY(${nearest}deg)`;
  },

  checkPwaBanner() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const isDismissed = sessionStorage.getItem('pwa_banner_dismissed');

    if (!isStandalone && !isDismissed) {
      const banner = document.getElementById('pwa-banner');
      if (banner) banner.style.display = 'flex';
    }
  },

  closePwaBanner() {
    sessionStorage.setItem('pwa_banner_dismissed', 'true');
    const banner = document.getElementById('pwa-banner');
    if (banner) banner.style.display = 'none';
  },

  async submitBugReport() {
    const bugInput = document.getElementById('bug-text');
    const description = bugInput ? bugInput.value.trim() : '';
    if (!description) {
      alert('Please describe the bug or feedback!');
      return;
    }

    const { error } = await API.sendBugReport(description);

    if (error) {
      console.error('[App.submitBugReport]', error);
      alert('Failed to submit report.');
    } else {
      alert('Thank you! Your report has been sent successfully.');
      if (bugInput) bugInput.value = '';
    }
  },

  // Category management methods
  // ---------- Tasks ----------

  async loadTasks() {
    if (!this.currentUser) return;

    const todayStr = UI.getLocalDateString();
    const todayWeekday = new Date().getDay(); // 0 = Sunday ... 6 = Saturday

    const dateElem = document.getElementById('tasks-date');
    if (dateElem) dateElem.innerText = `Today: ${new Date().toLocaleDateString('en-US')}`;

    const [categoryRes, tasksRes, logsRes] = await Promise.all([
      API.fetchTaskCategories(this.currentUser.id),
      API.fetchTasks(this.currentUser.id),
      API.fetchTaskLogs()
    ]);

    if (categoryRes.error) console.error('[App.loadTasks] categories:', categoryRes.error);
    if (tasksRes.error) console.error('[App.loadTasks] tasks:', tasksRes.error);
    if (logsRes.error) console.error('[App.loadTasks] logs:', logsRes.error);

    this.taskCategoriesList = categoryRes.data || [];
    this.allTasks = tasksRes.data || [];
    this.selectedTaskCategoryId =
      this.selectedTaskCategoryId || this.taskCategoriesList[0]?.id || null;

    const logDatesByTask = {};
    (logsRes.data || []).forEach(log => {
      (logDatesByTask[log.task_id] = logDatesByTask[log.task_id] || []).push(log.log_date);
    });

    // which tasks count as completed right now (for the All Tasks list)
    this.doneTaskIds = new Set();
    this.allTasks.forEach(task => {
      const doneDates = logDatesByTask[task.id] || [];
      const isDone = task.recurrence_type === 'once'
        ? doneDates.length > 0
        : doneDates.includes(todayStr);
      if (isDone) this.doneTaskIds.add(String(task.id));
    });

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    this.tasksList = this.allTasks.filter(task => {
      const doneDates = logDatesByTask[task.id] || [];
      const started = !task.due_date || task.due_date <= todayStr;

      if (task.recurrence_type === 'weekly') {
        const days = Array.isArray(task.recurrence_days) ? task.recurrence_days : [];
        return started && days.includes(todayWeekday) && !doneDates.includes(todayStr);
      }

      if (task.recurrence_type === 'monthly') {
        // a "31st" task lands on the last day of shorter months
        const day = Math.min(task.recurrence_month_day || 1, daysInMonth);
        return started && now.getDate() === day && !doneDates.includes(todayStr);
      }

      // one-time: shown from its due date on (overdue stays visible) until checked off
      return doneDates.length === 0 && !!task.due_date && task.due_date <= todayStr;
    });

    this.tasksList.sort((a, b) =>
      (a.start_time || a.end_time || '99:99').localeCompare(b.start_time || b.end_time || '99:99')
    );

    UI.renderTaskCategorySelect(this.taskCategoriesList, this.selectedTaskCategoryId);
    UI.renderTasks(this.tasksList, this.taskCategoriesList);
    UI.renderAllTasks(this.getSortedAllTasks(), this.taskCategoriesList, this.doneTaskIds);
    this.adjustSliderHeight();
  },

  getSortedAllTasks() {
    const done = this.doneTaskIds || new Set();
    return [...(this.allTasks || [])].sort((a, b) =>
      (done.has(String(a.id)) - done.has(String(b.id))) || // unfinished first
      (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
      a.title.localeCompare(b.title)
    );
  },

  // Puts a completed task back among the open ones.
  async restoreTask(taskId) {
    const task = (this.allTasks || []).find(t => String(t.id) === String(taskId));
    if (!task) return;

    const { error } = task.recurrence_type === 'once'
      ? await API.removeTaskLogs(taskId)
      : await API.removeTaskLogs(taskId, UI.getLocalDateString());

    if (error) console.error('[App.restoreTask] Error:', error);
    await this.loadTasks();
  },

  async handleToggleTask(taskId) {
    const todayStr = UI.getLocalDateString();

    const { error } = await API.addTaskLog(taskId, todayStr);
    if (error) {
      console.error('[App.handleToggleTask] Error saving completion:', error);
      await this.loadTasks(); // put the switch back to its real state
      return;
    }

    UI.removeTaskCard(taskId, () => {
      this.tasksList = this.tasksList.filter(t => String(t.id) !== String(taskId));
      UI.renderTasks(this.tasksList, this.taskCategoriesList);
      this.adjustSliderHeight();
    });
  },

  setTaskRecurrenceType(type) {
    this.taskRecurrenceType = type;

    const select = document.getElementById('task-repeat-select');
    const daysWrapper = document.getElementById('task-weekdays-wrapper');
    const monthWrapper = document.getElementById('task-monthday-wrapper');
    const endDate = document.getElementById('task-end-date-input');

    if (select) select.value = type;
    if (daysWrapper) daysWrapper.style.display = type === 'weekly' ? 'block' : 'none';
    if (monthWrapper) monthWrapper.style.display = type === 'monthly' ? 'flex' : 'none';
    // a repeating task has no single end date, only the time of day
    if (endDate) endDate.style.display = type === 'once' ? '' : 'none';
  },

  // All-day on = no times. Turning it off pre-fills the next full hour, like a calendar.
  setTaskAllDay(allDay) {
    const toggle = document.getElementById('task-allday-toggle');
    const fromInput = document.getElementById('task-start-time-input');
    const untilInput = document.getElementById('task-end-time-input');

    if (toggle) toggle.checked = allDay;
    if (fromInput) fromInput.style.display = allDay ? 'none' : '';
    if (untilInput) untilInput.style.display = allDay ? 'none' : '';

    if (!allDay && fromInput && untilInput && !fromInput.value) {
      const now = new Date();
      const startH = Math.min(now.getHours() + 1, 22);
      const pad = n => String(n).padStart(2, '0');
      fromInput.value = `${pad(startH)}:00`;
      untilInput.value = `${pad(startH + 1)}:00`;
    }
    if (allDay) {
      if (fromInput) fromInput.value = '';
      if (untilInput) untilInput.value = '';
    }
  },

  // Like a calendar: pushing the start date past the end date drags the end date along.
  onTaskStartDateChange() {
    const start = document.getElementById('task-due-date-input');
    const end = document.getElementById('task-end-date-input');
    if (start && end && (!end.value || end.value < start.value)) end.value = start.value;
  },

  toggleRecurrenceDay(dayIndex) {
    const i = this.selectedRecurrenceDays.indexOf(dayIndex);
    if (i === -1) this.selectedRecurrenceDays.push(dayIndex);
    else this.selectedRecurrenceDays.splice(i, 1);

    UI.renderWeekdayPicker(this.selectedRecurrenceDays);
  },

  fillTaskExtraFields(task) {
    const monthInput = document.getElementById('task-monthday-input');
    const fromInput = document.getElementById('task-start-time-input');
    const untilInput = document.getElementById('task-end-time-input');
    const endDate = document.getElementById('task-end-date-input');
    const startDate = document.getElementById('task-due-date-input');

    if (monthInput) monthInput.value = task.recurrence_month_day || '';
    if (fromInput) fromInput.value = task.start_time ? String(task.start_time).slice(0, 5) : '';
    if (untilInput) untilInput.value = task.end_time ? String(task.end_time).slice(0, 5) : '';
    if (endDate) endDate.value = task.end_date || (startDate ? startDate.value : '');

    this.setTaskAllDay(!(task.start_time || task.end_time));
  },

  openAddTaskModal() {
    this.editingTaskId = null;
    this.selectedTaskCategoryId = this.taskCategoriesList[0]?.id || null;
    this.selectedRecurrenceDays = [];

    const titleElem = document.getElementById('task-modal-title');
    const nameInput = document.getElementById('task-name-input');
    const dueInput = document.getElementById('task-due-date-input');

    if (titleElem) titleElem.innerText = 'Add New Task';
    if (nameInput) nameInput.value = '';
    if (dueInput) dueInput.value = UI.getLocalDateString();
    this.fillTaskExtraFields({});

    UI.renderTaskCategorySelect(this.taskCategoriesList, this.selectedTaskCategoryId);
    UI.renderWeekdayPicker(this.selectedRecurrenceDays);
    this.setTaskRecurrenceType('once');

    const modal = document.getElementById('task-modal');
    if (modal) modal.style.display = 'flex';
  },

  openEditTaskModal(taskId) {
    const task = (this.allTasks || []).find(t => String(t.id) === String(taskId));
    if (!task) return;

    this.editingTaskId = task.id;
    this.selectedTaskCategoryId = task.category_id || this.taskCategoriesList[0]?.id || null;
    this.selectedRecurrenceDays = Array.isArray(task.recurrence_days) ? [...task.recurrence_days] : [];

    const titleElem = document.getElementById('task-modal-title');
    const nameInput = document.getElementById('task-name-input');
    const dueInput = document.getElementById('task-due-date-input');

    if (titleElem) titleElem.innerText = 'Edit Task';
    if (nameInput) nameInput.value = task.title;
    if (dueInput) dueInput.value = task.due_date || UI.getLocalDateString();
    this.fillTaskExtraFields(task);

    UI.renderTaskCategorySelect(this.taskCategoriesList, this.selectedTaskCategoryId);
    UI.renderWeekdayPicker(this.selectedRecurrenceDays);
    this.setTaskRecurrenceType(['weekly', 'monthly'].includes(task.recurrence_type) ? task.recurrence_type : 'once');

    const modal = document.getElementById('task-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeTaskModal() {
    this.editingTaskId = null;
    const modal = document.getElementById('task-modal');
    if (modal) modal.style.display = 'none';
  },

  async saveTaskModal() {
    if (!this.currentUser) return;

    const nameInput = document.getElementById('task-name-input');
    const categoryInput = document.getElementById('task-category-input');
    const dueInput = document.getElementById('task-due-date-input');

    const title = nameInput ? nameInput.value.trim() : '';
    const categoryId = categoryInput ? categoryInput.value || null : null;
    const dueDate = dueInput ? dueInput.value : '';
    const recurrenceType = this.taskRecurrenceType;
    const recurrenceDays = [...this.selectedRecurrenceDays].sort((a, b) => a - b);

    if (!title) {
      alert('Please enter a task name.');
      return;
    }
    if (!dueDate) {
      alert(recurrenceType === 'once' ? 'Please choose a date.' : 'Please choose a start date.');
      return;
    }
    const monthInput = document.getElementById('task-monthday-input');
    const monthDay = monthInput ? parseInt(monthInput.value, 10) : NaN;
    if (recurrenceType === 'monthly' && !(monthDay >= 1 && monthDay <= 31)) {
      alert('Please enter a day of the month (1-31).');
      return;
    }
    const fromInput = document.getElementById('task-start-time-input');
    const untilInput = document.getElementById('task-end-time-input');
    const allDayToggle = document.getElementById('task-allday-toggle');
    const allDay = allDayToggle ? allDayToggle.checked : true;
    const startTime = allDay || !fromInput ? '' : fromInput.value;
    const endTime = allDay || !untilInput ? '' : untilInput.value;
    const endDateInput = document.getElementById('task-end-date-input');
    const endDate = recurrenceType === 'once' && endDateInput ? (endDateInput.value || dueDate) : '';

    if (endDate && endDate < dueDate) {
      alert('The end date can\'t be before the start date.');
      return;
    }
    const sameDay = !endDate || endDate === dueDate;
    if (sameDay && startTime && endTime && endTime < startTime) {
      alert('The end time can\'t be before the start time.');
      return;
    }
    if (recurrenceType === 'weekly' && recurrenceDays.length === 0) {
      alert('Please choose at least one day of the week.');
      return;
    }

    const fields = { title, categoryId, recurrenceType, dueDate, endDate, recurrenceDays, monthDay, startTime, endTime };

    let error;
    if (this.editingTaskId) {
      ({ error } = await API.updateTask(this.editingTaskId, fields));
    } else {
      const sameCategory = (this.allTasks || []).filter(
        t => String(t.category_id || '') === String(categoryId || '')
      );
      ({ error } = await API.createTask(this.currentUser.id, { ...fields, position: sameCategory.length }));
    }

    if (error) {
      console.error('[App.saveTaskModal] Error:', error);
      alert('Could not save the task. Did you run all the tasks SQL migrations in Supabase?');
      return;
    }

    this.closeTaskModal();
    await this.loadTasks();
  },

  openAllTasksModal() {
    UI.renderAllTasks(this.getSortedAllTasks(), this.taskCategoriesList, this.doneTaskIds);
    const modal = document.getElementById('all-tasks-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeAllTasksModal() {
    const modal = document.getElementById('all-tasks-modal');
    if (modal) modal.style.display = 'none';
  },

  editFromAllTasks(taskId) {
    this.openEditTaskModal(taskId);
  },

  handleDeleteTask(taskId) {
    this.pendingDeleteTaskId = taskId;
    const modal = document.getElementById('delete-task-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeDeleteTaskModal() {
    this.pendingDeleteTaskId = null;
    const modal = document.getElementById('delete-task-modal');
    if (modal) modal.style.display = 'none';
  },

  async confirmDeleteTask() {
    const taskId = this.pendingDeleteTaskId;
    if (!taskId) return;

    const { error } = await API.deleteTask(taskId);
    if (error) console.error('[App.confirmDeleteTask] Error:', error);

    this.closeDeleteTaskModal();
    await this.loadTasks();
  },

  openTaskCategoriesModal() {
    UI.renderTaskCategories(this.taskCategoriesList);
    const modal = document.getElementById('task-categories-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeTaskCategoriesModal() {
    const modal = document.getElementById('task-categories-modal');
    if (modal) modal.style.display = 'none';
  },

  async refreshTaskCategories() {
    const { data } = await API.fetchTaskCategories(this.currentUser.id);
    this.taskCategoriesList = data || [];
    UI.renderTaskCategories(this.taskCategoriesList);
    UI.renderTaskCategorySelect(
      this.taskCategoriesList,
      this.selectedTaskCategoryId || this.taskCategoriesList[0]?.id || null
    );
    UI.renderTasks(this.tasksList, this.taskCategoriesList);
    this.adjustSliderHeight();
  },

  async createNewTaskCategory() {
    if (!this.currentUser) return;

    const input = document.getElementById('new-task-category-input');
    const name = input ? input.value.trim() : '';
    if (!name) return;

    const duplicate = this.taskCategoriesList.some(
      c => c.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      alert('This category already exists.');
      return;
    }

    const { error } = await API.createTaskCategory(
      this.currentUser.id, name, this.taskCategoriesList.length
    );
    if (error) {
      console.error('[App.createNewTaskCategory]', error);
      return;
    }

    if (input) input.value = '';
    await this.refreshTaskCategories();
  },

  async renameTaskCategory(categoryId) {
    const category = this.taskCategoriesList.find(c => String(c.id) === String(categoryId));
    if (!category) return;

    const newName = prompt('Category name:', category.name);
    if (!newName || !newName.trim()) return;

    const { error } = await API.updateTaskCategory(categoryId, newName.trim());
    if (error) {
      console.error('[App.renameTaskCategory]', error);
      return;
    }

    await this.refreshTaskCategories();
  },

  async removeTaskCategory(categoryId) {
    const category = this.taskCategoriesList.find(c => String(c.id) === String(categoryId));
    if (!category) return;

    const usedByTasks = (this.allTasks || []).some(
      t => String(t.category_id || '') === String(categoryId)
    );
    if (usedByTasks) {
      alert('Move or delete all tasks in this category before deleting it.');
      return;
    }

    if (!confirm(`Delete "${category.name}"?`)) return;

    const { error } = await API.deleteTaskCategory(categoryId);
    if (error) {
      console.error('[App.removeTaskCategory]', error);
      return;
    }

    await this.refreshTaskCategories();
  },

  openCategoriesModal() {
    UI.renderCategories(this.categoriesList);
    const modal = document.getElementById('categories-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeCategoriesModal() {
    const modal = document.getElementById('categories-modal');
    if (modal) modal.style.display = 'none';
  },

  async createNewCategory() {
    if (!this.currentUser) return;

    const input = document.getElementById('new-category-input');
    const name = input ? input.value.trim() : '';

    if (!name) return;

    const duplicate = this.categoriesList.some(category =>
      category.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      alert('This category already exists.');
      return;
    }

    const { error } = await API.createCategory(this.currentUser.id, name, this.categoriesList.length);
    if (error) {
      console.error('[App.createNewCategory]', error);
      return;
    }

    if (input) input.value = '';

    const { data } = await API.fetchCategories(this.currentUser.id);
    this.categoriesList = data || [];
    UI.renderCategories(this.categoriesList);
    UI.renderCategorySelect(this.categoriesList, this.selectedCategoryId || this.categoriesList[0]?.id || null);
  },

  async renameCategory(categoryId) {
    const category = this.categoriesList.find(item => String(item.id) === String(categoryId));
    if (!category) return;

    const newName = prompt('Category name:', category.name);
    if (!newName || !newName.trim()) return;

    const { error } = await API.updateCategory(categoryId, newName.trim());
    if (error) {
      console.error('[App.renameCategory]', error);
      return;
    }

    const { data } = await API.fetchCategories(this.currentUser.id);
    this.categoriesList = data || [];
    UI.renderCategories(this.categoriesList);
    UI.renderCategorySelect(this.categoriesList, this.selectedCategoryId || this.categoriesList[0]?.id || null);
  },

  async removeCategory(categoryId) {
    const category = this.categoriesList.find(item => String(item.id) === String(categoryId));
    if (!category) return;

    const usedByHabits = this.habitsList.some(
      habit => String(habit.category_id || '') === String(categoryId)
    );

    if (usedByHabits) {
      alert('Move all habits out of this category before deleting it.');
      return;
    }

    if (!confirm(`Delete "${category.name}"?`)) return;

    const { error } = await API.deleteCategory(categoryId);
    if (error) {
      console.error('[App.removeCategory]', error);
      return;
    }

    const { data } = await API.fetchCategories(this.currentUser.id);
    this.categoriesList = data || [];
    UI.renderCategories(this.categoriesList);
    UI.renderCategorySelect(this.categoriesList, this.selectedCategoryId || this.categoriesList[0]?.id || null);
  }
};

// Password recovery: the e-mail link signs the user in with a recovery session
// and Supabase fires PASSWORD_RECOVERY - ask for the new password right away.
if (typeof supabase !== 'undefined' && supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') App.openPasswordResetModal();
  });
}

// Offline support: cache the app files so it can start without a connection.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.error('[ServiceWorker] Registration failed:', err)
    );
  });
}

// iOS Safari ignores user-scalable=no, so block pinch gestures explicitly.
['gesturestart', 'gesturechange', 'gestureend'].forEach(evt =>
  document.addEventListener(evt, e => e.preventDefault())
);
document.addEventListener('touchmove', e => {
  if (e.touches && e.touches.length > 1) e.preventDefault();
}, { passive: false });
window.addEventListener('resize', () => App.adjustSliderHeight());

// Changes made offline just reached the server - refresh what is on screen.
window.addEventListener('offline-sync-done', () => {
  if (!App.currentUser) return;
  App.loadHabits();
  App.loadTasks();
});

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.checkPwaBanner();
  App.setupSwipeNavigation();
  App.setupAchievementCardTilt();

  const bugDetails = document.querySelector('.bug-report-card');
  if (bugDetails) {
    bugDetails.addEventListener('toggle', () => App.adjustSliderHeight());
  }
});
