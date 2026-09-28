// Offline layer for Habit Tracker (loaded right after api.js).
//
//  * READS   - every successful Supabase read is stored on the device. When the
//              network is gone the stored copy is returned instead.
//  * CHECK-INS (habit on/off, task done/undo) - when offline they go into a queue,
//              the UI updates as usual, and the queue is uploaded on reconnect.
//  * OTHER WRITES (new/edit/delete habits, tasks, categories, ...) need a
//              connection and return a clear "you are offline" error.
//
// It works by wrapping the methods of the global API object, so app.js
// does not need to know anything about it.

const Offline = (() => {
  const CACHE_PREFIX = 'ht_cache:';
  const QUEUE_KEY = 'ht_queue';
  const OWNER_KEY = 'ht_owner';

  // The untouched API methods, used for the real network calls.
  const RAW = {};

  // ---------- tiny storage helpers ----------
  const read = (key) => {
    try {
      const value = localStorage.getItem(key);
      return value === null ? undefined : JSON.parse(value);
    } catch (_) {
      return undefined;
    }
  };

  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[Offline] Could not store', key, err);
    }
  };

  const remove = (key) => {
    try { localStorage.removeItem(key); } catch (_) {}
  };

  const getQueue = () => read(QUEUE_KEY) || [];
  const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  function isNetworkError(err) {
    if (!isOnline()) return true;
    if (!err) return false;
    const message = String(err.message || err).toLowerCase();
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error/.test(message);
  }

  // ---------- small "offline / syncing" pill ----------
  function updateBadge() {
    if (typeof document === 'undefined') return;
    let badge = document.getElementById('sync-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sync-badge';
      badge.className = 'sync-badge';
      document.body.appendChild(badge);
    }

    const pending = getQueue().length;
    if (!isOnline()) {
      badge.textContent = pending > 0 ? `Offline • ${pending} change${pending > 1 ? 's' : ''} waiting` : 'Offline';
      badge.classList.add('visible');
    } else if (pending > 0) {
      badge.textContent = `Syncing ${pending} change${pending > 1 ? 's' : ''}…`;
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  }

  // ---------- pending changes shown on top of stored / fetched data ----------
  function overlayHabitLogs(rows, { date = null, from = null } = {}) {
    let out = (rows || []).slice();

    getQueue().forEach((op) => {
      if (op.name !== 'addLog' && op.name !== 'removeLog') return;
      const [habitId, logDate] = op.args;
      if (date && logDate !== date) return;
      if (from && logDate < from) return;

      const same = (row) => String(row.habit_id) === String(habitId) && row.log_date === logDate;
      if (op.name === 'addLog') {
        if (!out.some(same)) out.push({ habit_id: habitId, log_date: logDate, completed: true });
      } else {
        out = out.filter((row) => !same(row));
      }
    });

    return out;
  }

  function overlayTaskLogs(rows) {
    let out = (rows || []).slice();

    getQueue().forEach((op) => {
      if (op.name === 'addTaskLog') {
        const [taskId, logDate] = op.args;
        const exists = out.some((r) => String(r.task_id) === String(taskId) && r.log_date === logDate);
        if (!exists) out.push({ task_id: taskId, log_date: logDate, completed: true });
      } else if (op.name === 'removeTaskLogs') {
        const [taskId, logDate] = op.args;
        out = out.filter((r) => {
          if (String(r.task_id) !== String(taskId)) return true;
          return logDate ? r.log_date !== logDate : false;
        });
      }
    });

    return out;
  }

  // ---------- uploading the queue ----------
  let flushing = null;

  function flush() {
    if (flushing) return flushing;
    if (!isOnline() || getQueue().length === 0) return Promise.resolve();

    flushing = (async () => {
      let synced = 0;

      while (true) {
        const queue = getQueue();
        if (queue.length === 0) break;

        const op = queue[0];
        let result;
        try {
          result = await RAW[op.name](...op.args);
        } catch (err) {
          result = { error: err };
        }

        if (result && result.error) {
          if (isNetworkError(result.error)) break; // still no connection, try again later
          // Anything else (e.g. the row already exists) would fail forever - drop it.
          console.warn('[Offline] Dropping change that the server rejected:', op, result.error);
        }

        write(QUEUE_KEY, getQueue().slice(1));
        synced++;
      }

      updateBadge();
      if (synced > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('offline-sync-done', { detail: { synced } }));
      }
    })().finally(() => {
      flushing = null;
    });

    return flushing;
  }

  function enqueue(name, args) {
    write(QUEUE_KEY, [...getQueue(), { name, args, at: Date.now() }]);
    updateBadge();
  }

  // ---------- wrapping the API ----------
  const READS = {
    fetchActiveHabits: { key: (u) => `active_habits:${u}` },
    fetchInactiveHabits: { key: (u) => `inactive_habits:${u}` },
    fetchCategories: { key: (u) => `categories:${u}` },
    fetchAllHabitsForStats: { key: (u) => `all_habits:${u}` },
    fetchUserAchievements: { key: (u) => `achievements:${u}` },
    fetchStreakState: { key: (u) => `streak_state:${u}` },
    fetchTaskCategories: { key: (u) => `task_categories:${u}` },
    fetchTasks: { key: (u) => `tasks:${u}` },
    fetchLogsByDate: {
      key: (d) => `logs_date:${d}`,
      overlay: (rows, d) => overlayHabitLogs(rows, { date: d }),
      fallback: []
    },
    fetchLogsRange: {
      key: (s) => `logs_range:${s}`,
      overlay: (rows, s) => overlayHabitLogs(rows, { from: s }),
      fallback: []
    },
    fetchTaskLogs: {
      key: () => 'task_logs',
      overlay: (rows) => overlayTaskLogs(rows),
      fallback: []
    }
  };

  const QUEUED_WRITES = ['addLog', 'removeLog', 'addTaskLog', 'removeTaskLogs'];

  const ONLINE_ONLY_WRITES = [
    'createHabit', 'updateHabit', 'softDeleteHabit', 'reactivateHabit',
    'createCategory', 'updateCategory', 'deleteCategory',
    'updateCategoryPositions', 'updateHabitCategory', 'updateHabitPositions',
    'unlockAchievement', 'sendBugReport', 'createStreakState', 'updateStreakState',
    'createTaskCategory', 'updateTaskCategory', 'deleteTaskCategory',
    'createTask', 'updateTask', 'deleteTask',
    'updateConsent', 'updatePassword', 'resetPassword'
  ];

  function install(api) {
    Object.keys(READS).forEach((name) => {
      if (typeof api[name] !== 'function') return;
      RAW[name] = api[name];
      const spec = READS[name];

      api[name] = async (...args) => {
        const key = CACHE_PREFIX + spec.key(...args);
        const overlay = (data) => (spec.overlay ? spec.overlay(data, ...args) : data);

        if (isOnline()) await flush(); // upload waiting changes first, so the fresh read includes them

        let result;
        if (!isOnline()) {
          // Known to be offline: skip the request and go straight to the stored copy.
          result = { data: null, error: { message: 'offline' } };
        } else {
          try {
            result = await RAW[name].apply(api, args);
          } catch (err) {
            result = { data: null, error: err };
          }
        }

        if (result && !result.error) {
          write(key, result.data);
          return { ...result, data: overlay(result.data) };
        }

        if (isNetworkError(result && result.error)) {
          const cached = read(key);
          if (cached !== undefined) return { data: overlay(cached), error: null, offline: true };
          if (spec.fallback !== undefined) return { data: overlay(spec.fallback), error: null, offline: true };
        }

        return result;
      };
    });

    QUEUED_WRITES.forEach((name) => {
      if (typeof api[name] !== 'function') return;
      RAW[name] = api[name];

      api[name] = async (...args) => {
        // keep the original order: anything already waiting goes up first
        if (isOnline() && getQueue().length > 0) await flush();

        if (!isOnline() || getQueue().length > 0) {
          enqueue(name, args);
          return { data: null, error: null, queued: true };
        }

        let result;
        try {
          result = await RAW[name].apply(api, args);
        } catch (err) {
          result = { data: null, error: err };
        }

        if (result && result.error && isNetworkError(result.error)) {
          enqueue(name, args);
          return { data: null, error: null, queued: true };
        }
        return result;
      };
    });

    ONLINE_ONLY_WRITES.forEach((name) => {
      if (typeof api[name] !== 'function') return;
      const original = api[name];

      api[name] = (...args) => {
        if (!isOnline()) {
          return Promise.resolve({
            data: null,
            error: { message: 'You are offline. This change needs an internet connection.' }
          });
        }
        return original.apply(api, args);
      };
    });

    // Never keep another person's data around after logging out.
    if (typeof api.logout === 'function') {
      const originalLogout = api.logout;
      api.logout = async (...args) => {
        const result = await originalLogout.apply(api, args);
        clearAll();
        return result;
      };
    }
  }

  function clearAll() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX) || k === QUEUE_KEY || k === OWNER_KEY)
        .forEach(remove);
    } catch (_) {}
    updateBadge();
  }

  // Drop day-by-day caches older than ~60 days so storage does not grow forever.
  function pruneOldDays() {
    try {
      const limit = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX + 'logs_date:'))
        .filter((k) => k.slice((CACHE_PREFIX + 'logs_date:').length) < limit)
        .forEach(remove);
    } catch (_) {}
  }

  // Called once we know who is logged in.
  function setOwner(userId) {
    const previous = read(OWNER_KEY);
    if (previous && previous !== userId) clearAll();
    write(OWNER_KEY, userId);
    pruneOldDays();
    updateBadge();
    flush();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { updateBadge(); flush(); });
    window.addEventListener('offline', updateBadge);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') flush();
    });
    document.addEventListener('DOMContentLoaded', updateBadge);
  }

  if (typeof API !== 'undefined') install(API);

  return { install, flush, setOwner, clearAll, getQueue, updateBadge, isNetworkError };
})();
