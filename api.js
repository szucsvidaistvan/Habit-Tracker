// Supabase API réteg (*API layer*)
const SUPABASE_URL = 'https://hcnfoywtoegokphjmzpn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Uzsb3AnDYM5bAwKWI5gwwQ_Hb3fwtNH';

const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const API = {
  async getSession() {
    return await supabase.auth.getSession();
  },

  async login(email, password) {
    return await supabase.auth.signInWithPassword({ email, password });
  },

  async signUp(email, password) {
    return await supabase.auth.signUp({ email, password });
  },

  async loginWithGoogle() {
    return await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
  },

  async logout() {
    return await supabase.auth.signOut();
  },

  async fetchActiveHabits(userId) {
    return await supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('id', { ascending: true });
  },

  async fetchInactiveHabits(userId) {
    return await supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', false)
      .order('id', { ascending: true });
  },

  async fetchLogsByDate(dateStr) {
    return await supabase
      .from('daily_logs')
      .select('*')
      .eq('log_date', dateStr);
  },

  async createHabit(userId, title, weeklyTarget, targetMinutes = 0) {
    return await supabase.from('habits').insert([{
      user_id: userId,
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes,
      is_active: true
    }]);
  },

  async updateHabit(habitId, title, weeklyTarget, targetMinutes = 0) {
    return await supabase.from('habits').update({
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes
    }).eq('id', habitId);
  },

  async softDeleteHabit(habitId) {
    return await supabase
      .from('habits')
      .update({ is_active: false })
      .eq('id', habitId);
  },

  async reactivateHabit(habitId, title, weeklyTarget, targetMinutes = 0) {
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
    return await supabase.from('daily_logs').insert([{
      habit_id: habitId,
      log_date: dateStr,
      completed: true
    }]);
  },

  async removeLog(habitId, dateStr) {
    return await supabase.from('daily_logs')
      .delete()
      .eq('habit_id', habitId)
      .eq('log_date', dateStr);
  },

  async fetchAllHabitsForStats(userId) {
    return await supabase.from('habits').select('*').eq('user_id', userId);
  },

  async fetchLogsRange(startDateStr) {
    return await supabase.from('daily_logs').select('*').gte('log_date', startDateStr);
  }
};
