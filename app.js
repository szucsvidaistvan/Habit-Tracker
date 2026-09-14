const App = {
  currentUser: null,
  habitsList: [],
  editingHabitId: null,
  activeStatsTab: 'weekly',

  async init() {
    console.log('[App.init] Alkalmazás inicializálása indítva...');
    const today = new Date().toLocaleDateString('hu-HU');
    const dateElem = document.getElementById('current-date');
    if (dateElem) dateElem.innerText = `Mai nap: ${today}`;

    if (typeof API === 'undefined') {
      console.error('[App.init] CRITICAL ERROR: Az API objektum nem létezik! Ellenőrizd az api.js betöltését az index.html-ben.');
      return;
    }

    try {
      console.log('[App.init] Munkamenet (Session) lekérése...');
      const { data: { session }, error } = await API.getSession();
      if (error) console.error('[App.init] Session hiba:', error);

      if (session) {
        console.log('[App.init] Bejelentkezett felhasználó megtalálva:', session.user.email);
        this.currentUser = session.user;
        this.showApp();
      } else {
        console.log('[App.init] Nincs aktív munkamenet, Login nézet megjelenítése.');
        this.showAuth();
      }
    } catch (err) {
      console.error('[App.init] Váratlan hiba az init során:', err);
    }
  },

  showAuth() {
    console.log('[App.showAuth] Auth nézetre váltás.');
    const auth = document.getElementById('auth-container');
    const app = document.getElementById('app-container');
    const tabBar = document.getElementById('bottom-tab-bar');

    if (auth) auth.style.display = 'block';
    if (app) app.style.display = 'none';
    if (tabBar) tabBar.style.display = 'none';
  },

  async showApp() {
    console.log('[App.showApp] Fő alkalmazás nézetre váltás.');
    const auth = document.getElementById('auth-container');
    const app = document.getElementById('app-container');
    const tabBar = document.getElementById('bottom-tab-bar');

    if (auth) auth.style.display = 'none';
    if (app) app.style.display = 'block';
    if (tabBar) tabBar.style.display = 'flex';

    const userEmailElem = document.getElementById('user-email-display');
    if (userEmailElem && this.currentUser) {
      userEmailElem.innerText = `Bejelentkezve: ${this.currentUser.email}`;
    }

    await this.loadHabits();
  },

  async handleLogin() {
    console.log('[App.handleLogin] Bejelentkezési kísérlet...');
    const emailElem = document.getElementById('auth-email');
    const passElem = document.getElementById('auth-password');
    const errElem = document.getElementById('auth-error');

    if (!emailElem || !passElem) {
      console.error('[App.handleLogin] Hiányzó login input mezők!');
      return;
    }

    const { data, error } = await API.login(emailElem.value.trim(), passElem.value.trim());
    if (error) {
      console.error('[App.handleLogin] Bejelentkezési hiba:', error);
      if (errElem) errElem.innerText = 'Hibás login adat!';
    } else {
      console.log('[App.handleLogin] Sikeres bejelentkezés!');
      this.currentUser = data.user;
      this.showApp();
    }
  },

  async handleSignUp() {
    console.log('[App.handleSignUp] Regisztrációs kísérlet...');
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const { error } = await API.signUp(email, password);

    const errElem = document.getElementById('auth-error');
    if (error) {
      console.error('[App.handleSignUp] Regisztrációs hiba:', error);
      if (errElem) errElem.innerText = error.message;
    } else {
      console.log('[App.handleSignUp] Sikeres regisztráció.');
      if (errElem) errElem.innerText = 'Sikeres regisztráció!';
    }
  },

  async logout() {
    console.log('[App.logout] Kijelentkezés...');
    await API.logout();
    this.currentUser = null;
    this.showAuth();
  },

  async loadHabits() {
    if (!this.currentUser) {
      console.warn('[App.loadHabits] Nincs bejelentkezett felhasználó, lekérés megszakítva.');
      return;
    }
    const todayStr = UI.getLocalDateString();
    console.log(`[App.loadHabits] Szokások és mai logok (${todayStr}) lekérése Supabase-ből...`);

    const { data: habitsData, error: habitsError } = await API.fetchActiveHabits(this.currentUser.id);
    if (habitsError) console.error('[App.loadHabits] Hiba a szokások lekérésekor:', habitsError);

    const { data: logsData, error: logsError } = await API.fetchLogsByDate(todayStr);
    if (logsError) console.error('[App.loadHabits] Hiba a napi logok lekérésekor:', logsError);

    console.log('[App.loadHabits] Nyers habitsData:', habitsData);
    console.log('[App.loadHabits] Nyers logsData:', logsData);

    const logsMap = {};
    if (logsData) logsData.forEach(l => logsMap[l.habit_id] = l);

    this.habitsList = (habitsData || []).map(h => ({
      ...h,
      completed: logsMap[h.id] ? logsMap[h.id].completed : false
    }));

    console.log('[App.loadHabits] Feldolgozott habitsList:', this.habitsList);
    UI.renderHabits(this.habitsList);
  },

async handleToggleHabit(habitId) {
    console.log(`[App.handleToggleHabit] Váltás indítása -> Habit ID: ${habitId}`);
    const todayStr = UI.getLocalDateString();
    
    // Javítva: String()-re konvertálás a típuseltérés (number vs string) kiszűrésére
    const habit = this.habitsList.find(h => String(h.id) === String(habitId));

    if (!habit) {
      console.error(`[App.handleToggleHabit] A szokás nem található a memóriában ID: ${habitId}`);
      return;
    }

    // Optimista UI frissítés
    habit.completed = !habit.completed;
    console.log(`[App.handleToggleHabit] Új memóriabeli állapot (optimista): ${habit.completed}`);
    UI.updateProgress(this.habitsList);

    if (habit.completed) {
      console.log(`[App.handleToggleHabit] API hívás: addLog(habitId: ${habitId}, date: ${todayStr})`);
      const { error } = await API.addLog(habitId, todayStr);
      if (error) {
        console.error('[App.handleToggleHabit] Hiba a log hozzáadásakor, visszagörgetés:', error);
        habit.completed = false;
      }
    } else {
      console.log(`[App.handleToggleHabit] API hívás: removeLog(habitId: ${habitId}, date: ${todayStr})`);
      const { error } = await API.removeLog(habitId, todayStr);
      if (error) {
        console.error('[App.handleToggleHabit] Hiba a log törlésekor, visszagörgetés:', error);
        habit.completed = true;
      }
    }
    UI.updateProgress(this.habitsList);
  },

  openAddModal() {
    console.log('[App.openAddModal] Új szokás hozzáadása modal megnyitása.');
    this.editingHabitId = null;

    const nameInput = document.getElementById('habit-name-input');
    const freqInput = document.getElementById('habit-freq-input');
    const modalTitle = document.getElementById('modal-title');
    const modal = document.getElementById('habit-modal');

    if (!modal) console.error('[App.openAddModal] ERROR: #habit-modal elem hiányzik az index.html-ből!');
    if (!nameInput) console.error('[App.openAddModal] ERROR: #habit-name-input elem hiányzik!');

    if (nameInput) nameInput.value = '';
    if (freqInput) freqInput.value = '7';
    if (modalTitle) modalTitle.innerText = 'Új szokás hozzáadása';
    if (modal) modal.style.display = 'flex';
  },

  openEditModal(habitId) {
    console.log(`[App.openEditModal] Szerkesztés modal megnyitása -> Habit ID: ${habitId}`);
    
    // Javítva: String()-re konvertálás
    const habit = this.habitsList.find(h => String(h.id) === String(habitId));

    if (!habit) {
      console.error(`[App.openEditModal] A szokás nem található az id alapján: ${habitId}`);
      return;
    }

    this.editingHabitId = habitId;

    const nameInput = document.getElementById('habit-name-input');
    const freqInput = document.getElementById('habit-freq-input');
    const modalTitle = document.getElementById('modal-title');
    const modal = document.getElementById('habit-modal');

    if (!modal) console.error('[App.openEditModal] ERROR: #habit-modal elem hiányzik az index.html-ből!');

    if (nameInput) nameInput.value = habit.title;
    if (freqInput) freqInput.value = habit.weekly_target || 7;
    if (modalTitle) modalTitle.innerText = 'Szokás szerkesztése';
    if (modal) modal.style.display = 'flex';
  },

  closeModal() {
    console.log('[App.closeModal] Modal bezárása.');
    this.editingHabitId = null;

    const modal = document.getElementById('habit-modal');
    if (modal) modal.style.display = 'none';
  },

  async saveHabitModal() {
    console.log('[App.saveHabitModal] Mentés gomb megnyomva. Editing ID:', this.editingHabitId);
    const titleElem = document.getElementById('habit-name-input');
    const freqElem = document.getElementById('habit-freq-input');

    const title = titleElem ? titleElem.value.trim() : '';
    const targetNum = freqElem ? (parseInt(freqElem.value.trim()) || 7) : 7;

    if (!title) {
      console.warn('[App.saveHabitModal] Üres megnevezés, mentés megszakítva.');
      alert('Kérlek adj meg egy nevet a szokásnak!');
      return;
    }

    if (!this.currentUser) {
      console.error('[App.saveHabitModal] Nincs bejelentkezett felhasználó!');
      return;
    }

    if (this.editingHabitId) {
      console.log(`[App.saveHabitModal] API hívás: updateHabit(${this.editingHabitId}, ${title}, ${targetNum})`);
      const { error } = await API.updateHabit(this.editingHabitId, title, targetNum);
      if (error) console.error('[App.saveHabitModal] Frissítési hiba:', error);
    } else {
      console.log(`[App.saveHabitModal] API hívás: createHabit(${this.currentUser.id}, ${title}, ${targetNum})`);
      const { error } = await API.createHabit(this.currentUser.id, title, targetNum);
      if (error) console.error('[App.saveHabitModal] Létrehozási hiba:', error);
    }

    this.closeModal();
    await this.loadHabits();
  },

  async handleDeleteHabit(habitId) {
    console.log(`[App.handleDeleteHabit] Törlés kezdeményezve -> ID: ${habitId}`);
    if (!confirm('Biztosan törölni szeretnéd ezt a szokást?')) {
      console.log('[App.handleDeleteHabit] Törlés megszakítva a felhasználó által.');
      return;
    }

    console.log(`[App.handleDeleteHabit] API hívás: softDeleteHabit(${habitId})`);
    const { error } = await API.softDeleteHabit(habitId);
    if (error) {
      console.error('[App.handleDeleteHabit] Törlési hiba:', error);
    } else {
      console.log('[App.handleDeleteHabit] Sikeres törlés, lista újratöltése.');
      await this.loadHabits();
    }
  },

  switchTab(tab) {
    console.log(`[App.switchTab] Tab váltás -> ${tab}`);
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
  },

  switchStatsTab(type) {
    console.log(`[App.switchStatsTab] Statisztika típus váltás -> ${type}`);
    this.activeStatsTab = type;
    
    const wBtn = document.getElementById('btn-stats-weekly');
    const mBtn = document.getElementById('btn-stats-monthly');

    if (wBtn) wBtn.classList.toggle('active', type === 'weekly');
    if (mBtn) mBtn.classList.toggle('active', type === 'monthly');

    this.loadStatistics(type);
  },

  async loadStatistics(type) {
    if (!this.currentUser) return;
    console.log(`[App.loadStatistics] Statisztikák betöltése (${type})...`);

    const daysCount = type === 'weekly' ? 7 : 30;
    const datesList = [];
    const dateMap = {};

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = UI.getLocalDateString(d);
      const dayLabel = type === 'weekly' 
        ? d.toLocaleDateString('hu-HU', { weekday: 'short' }) 
        : `${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getDate().toString().padStart(2,'0')}.`;
      
      datesList.push({ dateStr, dayLabel });
      dateMap[dateStr] = 0;
    }

    const startDateStr = datesList[0].dateStr;
    const { data: allHabits } = await API.fetchAllHabitsForStats(this.currentUser.id);
    const { data: logs } = await API.fetchLogsRange(startDateStr);

    if (logs) {
      logs.forEach(log => {
        if (dateMap[log.log_date] !== undefined) dateMap[log.log_date]++;
      });
    }

    const labels = datesList.map(d => d.dayLabel);
    const dailyCounts = datesList.map(d => dateMap[d.dateStr]);
    const totalHabitsCount = this.habitsList.length || 1;
    const trendData = datesList.map(d => Math.round((dateMap[d.dateStr] / totalHabitsCount) * 100));

    UI.renderBarChart(labels, dailyCounts);
    UI.renderLineChart(labels, trendData);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
