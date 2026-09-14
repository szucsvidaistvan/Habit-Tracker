const App = {
  currentUser: null,
  habitsList: [],
  editingHabitId: null,
  activeStatsTab: 'weekly',

  async init() {
    const today = new Date().toLocaleDateString('hu-HU');
    document.getElementById('current-date').innerText = `Mai nap: ${today}`;

    const { data: { session } } = await API.getSession();
    if (session) {
      this.currentUser = session.user;
      this.showApp();
    } else {
      this.showAuth();
    }
  },

  showAuth() {
    document.getElementById('auth-container').style.display = 'block';
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('bottom-tab-bar').style.display = 'none';
  },

  async showApp() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    document.getElementById('bottom-tab-bar').style.display = 'flex';
    document.getElementById('user-email-display').innerText = `Bejelentkezve: ${this.currentUser.email}`;
    await this.loadHabits();
  },

  async handleLogin() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const { data, error } = await API.login(email, password);
    if (error) {
      document.getElementById('auth-error').innerText = 'Hibás login adat!';
    } else {
      this.currentUser = data.user;
      this.showApp();
    }
  },

  async handleSignUp() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const { error } = await API.signUp(email, password);
    document.getElementById('auth-error').innerText = error ? error.message : 'Sikeres regisztráció!';
  },

  async logout() {
    await API.logout();
    this.currentUser = null;
    this.showAuth();
  },

  async loadHabits() {
    if (!this.currentUser) return;
    const todayStr = UI.getLocalDateString();
    
    const { data: habitsData } = await API.fetchActiveHabits(this.currentUser.id);
    const { data: logsData } = await API.fetchLogsByDate(todayStr);

    const logsMap = {};
    if (logsData) logsData.forEach(l => logsMap[l.habit_id] = l);

    this.habitsList = (habitsData || []).map(h => ({
      ...h,
      completed: logsMap[h.id] ? logsMap[h.id].completed : false
    }));

    UI.renderHabits(this.habitsList);
  },

  async handleToggleHabit(habitId) {
  const todayStr = UI.getLocalDateString();
  const habit = this.habitsList.find(h => h.id === habitId);
  if (!habit) return;

  console.log('[App Debug] Kapcsoló kattintva:', habit.title, '| Új állapot lesz:', !habit.completed);

  habit.completed = !habit.completed;
  UI.updateProgress(this.habitsList);

  if (habit.completed) {
    const { error } = await API.addLog(habitId, todayStr);
    if (error) {
      console.error('[App Debug] Hiba az addLog során:', error);
      habit.completed = false; // Visszaállítás hiba esetén
    }
  } else {
    const { error } = await API.removeLog(habitId, todayStr);
    if (error) {
      console.error('[App Debug] Hiba a removeLog során:', error);
      habit.completed = true; // Visszaállítás hiba esetén
    }
  }
  UI.updateProgress(this.habitsList);
}
  async saveHabitModal() {
    const title = document.getElementById('habit-name-input').value.trim();
    const targetNum = parseInt(document.getElementById('habit-freq-input').value.trim()) || 7;
    if (!title || !this.currentUser) return;

    if (this.editingHabitId) {
      await API.updateHabit(this.editingHabitId, title, targetNum);
    } else {
      await API.createHabit(this.currentUser.id, title, targetNum);
    }

    this.closeModal();
    await this.loadHabits();
  },

  switchTab(tab) {
    document.querySelectorAll('.tab-item').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');

    document.getElementById('view-home').style.display = tab === 'home' ? 'block' : 'none';
    document.getElementById('view-stats').style.display = tab === 'stats' ? 'block' : 'none';
    document.getElementById('view-profile').style.display = tab === 'profile' ? 'block' : 'none';

    if (tab === 'stats') this.loadStatistics(this.activeStatsTab);
  },
  
  switchStatsTab(type) {
    this.activeStatsTab = type;
    document.getElementById('btn-stats-weekly').classList.toggle('active', type === 'weekly');
    document.getElementById('btn-stats-monthly').classList.toggle('active', type === 'monthly');
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
        ? d.toLocaleDateString('hu-HU', { weekday: 'short' }) 
        : `${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getDate().toString().padStart(2,'0')}.`;
      
      datesList.push({ dateStr, dayLabel });
      dateMap[dateStr] = 0;
    }

    const startDateStr = datesList[0].dateStr;
    const { data: allHabits } = await API.fetchAllHabitsForStats(this.currentUser.id);
    const { data: logs } = await API.fetchLogsRange(startDateStr);

    const habitStats = {};
    (allHabits || []).forEach(h => {
      habitStats[h.id] = { title: h.title, target: h.weekly_target || 7, completedCount: 0 };
    });

    if (logs) {
      logs.forEach(log => {
        if (dateMap[log.log_date] !== undefined) dateMap[log.log_date]++;
        if (habitStats[log.habit_id]) habitStats[log.habit_id].completedCount++;
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
