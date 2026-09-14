const SUPABASE_URL = 'https://hcnfoywtoegokphjmzpn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Uzsb3AnDYM5bAwKWI5gwwQ_Hb3fwtNH';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const API = {
  async getSession() {
    return await db.auth.getSession();
  },
  async login(email, password) {
    return await db.auth.signInWithPassword({ email, password });
  },
  async signUp(email, password) {
    return await db.auth.signUp({ email, password });
  },
  async logout() {
    return await db.auth.signOut();
  },

  // Csak az aktív szokásokat kérjük le a főoldalra
  async fetchActiveHabits(userId) {
    return await db
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
  },

  // Az összes szokást lekérjük (inaktívakat is), hogy a korábbi statisztikák ne sérüljenek
  async fetchAllHabitsForStats(userId) {
    return await db
      .from('habits')
      .select('*')
      .eq('user_id', userId);
  },

  async fetchLogsByDate(todayStr) {
    return await db.from('daily_logs').select('*').eq('log_date', todayStr);
  },

  async addLog(habitId, logDate) {
    return await db.from('daily_logs').insert([{ habit_id: habitId, log_date: logDate, completed: true }]);
  },

  async removeLog(habitId, logDate) {
    return await db.from('daily_logs').delete().eq('habit_id', habitId).eq('log_date', logDate);
  },

  async createHabit(userId, title, weeklyTarget) {
    return await db.from('habits').insert([{
      user_id: userId,
      title: title,
      weekly_target: weeklyTarget,
      is_active: true
    }]);
  },

  async updateHabit(habitId, title, weeklyTarget) {
    return await db.from('habits').update({ title, weekly_target: weeklyTarget }).eq('id', habitId);
  },

  // SOFT DELETE: Fizikai törlés helyett beállítjuk az is_active = false értéket
  async softDeleteHabit(habitId) {
    return await db.from('habits').update({ is_active: false }).eq('id', habitId);
  },

  async fetchLogsRange(startDateStr) {
    return await db.from('daily_logs').select('*').gte('log_date', startDateStr).eq('completed', true);
  }
};