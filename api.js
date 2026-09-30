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
    return await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          privacy_consent_at: new Date().toISOString(),
          privacy_consent_version: 1
        }
      }
    });
  },

  async resetPassword(email) {
    return await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
  },

  async updatePassword(newPassword) {
    return await supabase.auth.updateUser({ password: newPassword });
  },

  async updateConsent(consentAtIso) {
    return await supabase.auth.updateUser({
      data: {
        privacy_consent_at: consentAtIso,
        privacy_consent_version: 1
      }
    });
  },

  // Lets the reminders Edge Function know which local time of day to use for this person.
  async updateTimezone(timezone) {
    return await supabase.auth.updateUser({ data: { timezone } });
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

  async createHabit(userId, title, weeklyTarget, targetMinutes = 0, categoryId = null, position = 0, reminderTime = null) {
    return await supabase.from('habits').insert([{
      user_id: userId,
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes,
      category_id: categoryId || null,
      position,
      is_active: true,
      reminder_time: reminderTime || null,
      reminder_enabled: !!reminderTime
    }]).select().single();
  },

  async updateHabit(habitId, title, weeklyTarget, targetMinutes = 0, categoryId = null, reminderTime = null) {
    return await supabase.from('habits').update({
      title: title,
      weekly_target: weeklyTarget,
      target_minutes: targetMinutes,
      category_id: categoryId || null,
      reminder_time: reminderTime || null,
      reminder_enabled: !!reminderTime
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
  },

  // ---------- Tasks ----------

  async fetchTaskCategories(userId) {
    const result = await supabase
      .from('task_categories')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true });

    if (result.error) return result;

    if (!result.data || result.data.length === 0) {
      return await supabase
        .from('task_categories')
        .insert([{ user_id: userId, name: 'General', position: 0 }])
        .select('*')
        .order('position', { ascending: true });
    }

    return result;
  },

  async createTaskCategory(userId, name, position = 0) {
    return await supabase
      .from('task_categories')
      .insert([{ user_id: userId, name, position }])
      .select()
      .single();
  },

  async updateTaskCategory(categoryId, name) {
    return await supabase
      .from('task_categories')
      .update({ name })
      .eq('id', categoryId);
  },

  async deleteTaskCategory(categoryId) {
    return await supabase
      .from('task_categories')
      .delete()
      .eq('id', categoryId);
  },

  async fetchTasks(userId) {
    return await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('id', { ascending: true });
  },

  buildTaskRow(fields) {
    const repeating = fields.recurrenceType !== 'once';
    return {
      title: fields.title,
      category_id: fields.categoryId || null,
      recurrence_type: fields.recurrenceType,
      // for one-time tasks this is the due date, for repeating ones the start date
      due_date: fields.dueDate || null,
      recurrence_days: fields.recurrenceType === 'weekly' ? fields.recurrenceDays : null,
      recurrence_month_day: fields.recurrenceType === 'monthly' ? fields.monthDay : null,
      end_date: fields.recurrenceType === 'once' ? (fields.endDate || null) : null,
      start_time: fields.startTime || null,
      end_time: fields.endTime || null,
      reminder_enabled: fields.reminderEnabled !== false
    };
  },

  async createTask(userId, fields) {
    return await supabase.from('tasks').insert([{
      user_id: userId,
      position: fields.position || 0,
      ...this.buildTaskRow(fields)
    }]).select().single();
  },

  async updateTask(taskId, fields) {
    return await supabase.from('tasks').update(this.buildTaskRow(fields)).eq('id', taskId);
  },

  async deleteTask(taskId) {
    return await supabase.from('tasks').delete().eq('id', taskId);
  },

  // RLS limits this to the current user's own tasks' logs.
  async fetchTaskLogs() {
    return await supabase.from('task_logs').select('*');
  },

  // Undo a completion. Pass a date to undo just that day (repeating tasks),
  // or omit it to clear every completion (one-time tasks).
  async removeTaskLogs(taskId, dateStr = null) {
    let query = supabase.from('task_logs').delete().eq('task_id', taskId);
    if (dateStr) query = query.eq('log_date', dateStr);
    return await query;
  },

  // ---------- Push notifications ----------

  async savePushSubscription(userId, subscription) {
    return await supabase.from('push_subscriptions').upsert([{
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    }], { onConflict: 'endpoint' });
  },

  async deletePushSubscription(endpoint) {
    return await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  },

  async addTaskLog(taskId, dateStr) {
    return await supabase.from('task_logs').insert([{
      task_id: taskId,
      log_date: dateStr,
      completed: true
    }]);
  }
};
