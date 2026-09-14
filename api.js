// Supabase kliens és API réteg (API Layer)
const SUPABASE_URL = 'https://hcnfoywtoegokphjmzpn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Uzsb3AnDYM5bAwKWI5gwwQ_Hb3fwtNH';

const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const API = {
  async getSession() {
    console.log('[API.getSession] Munkamenet ellenőrzése...');
    return await supabase.auth.getSession();
  },

  async login(email, password) {
    console.log('[API.login] Bejelentkezés:', email);
    return await supabase.auth.signInWithPassword({ email, password });
  },

  async signUp(email, password) {
    console.log('[API.signUp] Regisztráció:', email);
    return await supabase.auth.signUp({ email, password });
  },

  async logout() {
    console.log('[API.logout] Kijelentkezés...');
    return await supabase.auth.signOut();
  },

  async fetchActiveHabits(userId) {
    console.log('[API.fetchActiveHabits] Aktív szokások lekérése User ID:', userId);
    return await supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('id', { ascending: true });
  },

  async fetchInactiveHabits(userId) {
    console.log('[API.fetchInactiveHabits] Inaktív szokások lekérése User ID:', userId);
    return await supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', false)
      .order('id', { ascending: true });
  },

  async fetchLogsByDate(dateStr) {
    console.log('[API.fetchLogsByDate] Logok lekérése dátumra:', dateStr);
    return await supabase
      .from('habit_logs')
      .select('*')
      .eq('log_date', dateStr);
  },

  async createHabit(userId, title, weeklyTarget, targetMinutes = 0) {
    console.log('[API.createHabit] Új szokás:', { userId, title, weeklyTarget, targetMinutes });
    return await supabase.from('habits').insert([{
      user_id: userId,
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes,
      is_active: true
    }]);
  },

  async updateHabit(habitId, title, weeklyTarget, targetMinutes = 0) {
    console.log('[API.updateHabit] Szokás frissítése:', { habitId, title, weeklyTarget, targetMinutes });
    return await supabase.from('habits').update({
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes
    }).eq('id', habitId);
  },

  async softDeleteHabit(habitId) {
    console.log('[API.softDeleteHabit] Lágy törlés (is_active = false) ID:', habitId);
    return await supabase
      .from('habits')
      .update({ is_active: false })
      .eq('id', habitId);
  },

  async reactivateHabit(habitId, title, weeklyTarget, targetMinutes = 0) {
    console.log('[API.reactivateHabit] Újraaktiválás ID:', habitId);
    return await supabase
      .from('habits')
      .update({
        title: title,
        weekly_target: weeklyTarget,
        target_minutes: targetMinutes,
        is_active: true
      })
      .eq('id', habitId);
  },

  async addLog(habitId, dateStr) {
    console.log('[API.addLog] Log hozzáadása:', { habitId, dateStr });
    return await supabase.from('habit_logs').insert([{
      habit_id: habitId,
      log_date: dateStr,
      completed: true
    }]);
  },

  async removeLog(habitId, dateStr) {
    console.log('[API.removeLog] Log törlése:', { habitId, dateStr });
    return await supabase.from('habit_logs')
      .delete()
      .eq('habit_id', habitId)
      .eq('log_date', dateStr);
  },

  async fetchAllHabitsForStats(userId) {
    return await supabase.from('habits').select('*').eq('user_id', userId);
  },

  async fetchLogsRange(startDateStr) {
    return await supabase.from('habit_logs').select('*').gte('log_date', startDateStr);
  }
};
