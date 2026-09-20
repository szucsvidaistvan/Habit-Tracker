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
      .order('position', { ascending: true })
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

  async fetchCategories(userId) {
    const result = await supabase
      .from('habit_categories')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true });

    if (result.error) return result;

    if (!result.data || result.data.length === 0) {
      const defaults = [
        { user_id: userId, name: 'Morning', position: 0 },
        { user_id: userId, name: 'During the day', position: 1 },
        { user_id: userId, name: 'Evening', position: 2 }
      ];

      const inserted = await supabase
        .from('habit_categories')
        .insert(defaults)
        .select('*')
        .order('position', { ascending: true });

      return inserted;
    }

    return result;
  },

  async createCategory(userId, name, position = 0) {
    return await supabase
      .from('habit_categories')
      .insert([{ user_id: userId, name, position }])
      .select()
      .single();
  },

  async updateCategory(categoryId, name) {
    return await supabase
      .from('habit_categories')
      .update({ name })
      .eq('id', categoryId);
  },

  async deleteCategory(categoryId) {
    return await supabase
      .from('habit_categories')
      .delete()
      .eq('id', categoryId);
  },

  async updateCategoryPositions(categories) {
    const operations = categories.map(category =>
      supabase
        .from('habit_categories')
        .update({ position: category.position })
        .eq('id', category.id)
    );

    return await Promise.all(operations);
  },

  async updateHabitCategory(habitId, categoryId, position) {
    return await supabase
      .from('habits')
      .update({
        category_id: categoryId || null,
        position
      })
      .eq('id', habitId);
  },

  async updateHabitPositions(habits) {
    const operations = habits.map(habit =>
      supabase
        .from('habits')
        .update({
          category_id: habit.category_id || null,
          position: habit.position
        })
        .eq('id', habit.id)
    );

    return await Promise.all(operations);
  },

  async fetchLogsByDate(dateStr) {
    return await supabase
      .from('daily_logs')
      .select('*')
      .eq('log_date', dateStr);
  },

  async createHabit(userId, title, weeklyTarget, targetMinutes = 0, categoryId = null, position = 0) {
    return await supabase.from('habits').insert([{
      user_id: userId,
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes,
      category_id: categoryId || null,
      position,
      is_active: true
    }]);
  },

  async updateHabit(habitId, title, weeklyTarget, targetMinutes = 0, categoryId = null) {
    return await supabase.from('habits').update({
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes,
      category_id: categoryId || null
    }).eq('id', habitId);
  },

  async softDeleteHabit(habitId) {
    return await supabase
      .from('habits')
      .update({ is_active: false, deactivated_at: new Date().toISOString() })
      .eq('id', habitId);
  },

  async reactivateHabit(habitId, title, weeklyTarget, targetMinutes = 0) {
    return await supabase
      .from('habits')
      .update({
        title: title,
        weekly_target: weeklyTarget,
        target_minutes: targetMinutes,
        is_active: true,
        deactivated_at: null
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
  },

  async fetchUserAchievements(userId) {
    return await supabase.from('user_achievements').select('*').eq('user_id', userId);
  },

  async unlockAchievement(userId, achievementKey) {
    return await supabase.from('user_achievements').insert([{
      user_id: userId,
      achievement_key: achievementKey
    }]);
  },

  async sendBugReport(description) {
    const { data: { user } } = await supabase.auth.getUser();
    return await supabase.from('bug_reports').insert([{ user_id: user.id, description }]);
  },

  async fetchStreakState(userId) {
    return await supabase
      .from('user_streak_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
  },

  async createStreakState(userId) {
    return await supabase
      .from('user_streak_state')
      .insert([{ user_id: userId }])
      .select()
      .single();
  },

  async updateStreakState(userId, fields) {
    return await supabase
      .from('user_streak_state')
      .update(fields)
      .eq('user_id', userId);
  }
};
