// Offline layer for Habit Tracker (loaded right after api.js).
//
//  * READS   - every successful Supabase read is stored on the device. When the
//              network is gone (or too slow) the stored copy is returned instead.
//  * CHECK-INS (habit on/off, task done/undo) - when offline they go into a queue,
//              the UI updates as usual, and the queue is uploaded on reconnect.
//  * OTHER WRITES (new/edit/delete habits, tasks, categories, ...) need a
//              connection and return a clear "you are offline" error + a small toast.
//  * START-UP - the logged-in user is remembered, so the app can open with no
//              connection even when the login token has expired in the meantime.
//
// It works by wrapping the methods of the global API object, so app.js
// does not need to know much about it.

const Offline = (() => {
  const CACHE_PREFIX = 'ht_cache:';
  const QUEUE_KEY = 'ht_queue';
  const OWNER_KEY = 'ht_owner';
  const USER_KEY = 'ht_user';

  const FLUSH_WAIT_MS = 6000;      // a read waits at most this long for waiting changes to upload
  const READ_TIMEOUT_MS = 8000;    // with a stored copy available, a slow read gives up after this
  const WRITE_TIMEOUT_MS = 12000;  // a single upload gives up after this
  const RETRY_EVERY_MS = 30000;    // background retry (captive wifi never fires the "online" event)
  const MAX_UNKNOWN_TRIES = 5;     // an unclassifiable server error is retried this many times, then dropped

  const OFFLINE_WRITE_MESSAGE = 'You are offline. This change needs an internet connection.';

  // The untouched API methods, used for the real network calls.
  const RAW = {};

  // true after a read was answered from the stored copy because the network failed
  let stale = false;

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

  const storedKeys = (prefix) => {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    } catch (_) {
      return [];
    }
  };

  const getQueue = () => read(QUEUE_KEY) || [];
  const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Rejects when the promise takes longer than `ms` (0 = wait as long as it takes).
  function withTimeout(promise, ms) {
    if (!ms) return Promise.resolve(promise);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Network request timed out')), ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  }

  function isNetworkError(err) {
    if (!isOnline()) return true;
    if (!err) return false;
    if (err.name === 'AuthRetryableFetchError') return true;
    const message = String(err.message || err).toLowerCase();
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error|timed out|timeout/.test(message);
  }

  // network   - no connection / too slow: keep the change, try again later
  // auth      - login token expired or not ready yet: keep the change, try again later
  // duplicate - the row is already there: the change is effectively done
  // rejected  - the server will never accept this change: drop it
  // unknown   - retry a few times, then drop
  function classifyError(err, status) {
    if (isNetworkError(err)) return 'network';

    const code = String((err && err.code) || '');
    const http = Number(status || (err && (err.status || err.statusCode))) || 0;
    const message = String((err && err.message) || err || '').toLowerCase();

    if (code === '23505') return 'duplicate';
    if (
      http === 401 || http === 403 ||
      /^PGRST30\d$/.test(code) || code === '42501' ||
      /jwt|token|not authenticated|unauthorized|expired/.test(message)
    ) return 'auth';
    if (http === 408 || http === 429 || http >= 500) return 'network';
    if (/^(22|23)/.test(code) || http === 400 || http === 404 || http === 409 || http === 422) return 'rejected';
    return 'unknown';
  }

  // ---------- small "offline / syncing" pill ----------
  function updateBadge() {
    if (typeof document === 'undefined' || !document.body) return;
    let badge = document.getElementById('sync-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sync-badge';
      badge.className = 'sync-badge';
      document.body.appendChild(badge);
    }

    const pending = getQueue().length;
    const plural = pending > 1 ? 's' : '';
    if (!isOnline()) {
      badge.textContent = pending > 0 ? `Offline • ${pending} change${plural} waiting` : 'Offline';
      badge.classList.add('visible');
    } else if (pending > 0) {
      badge.textContent = flushing
        ? `Syncing ${pending} change${plural}…`
        : `${pending} change${plural} waiting to sync`;
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  }

  // ---------- short message at the bottom ("this needs internet") ----------
  let toastTimer;
  function toast(message) {
    if (typeof document === 'undefined' || !document.body) return;
    let el = document.getElementById('offline-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'offline-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = [
        'position:fixed', 'left:50%', 'transform:translateX(-50%)',
        'bottom:calc(env(safe-area-inset-bottom, 0px) + 90px)',
        'max-width:88vw', 'z-index:2000', 'padding:10px 16px', 'border-radius:14px',
        'background:rgba(15,23,42,.97)', 'border:1px solid rgba(148,163,184,.35)',
        'color:#f1f5f9', 'font-size:13px', 'font-weight:600', 'text-align:center',
        'box-shadow:0 8px 24px rgba(0,0,0,.4)', 'transition:opacity .25s ease',
        'opacity:0', 'pointer-events:none'
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
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

  // ---------- log ranges: the start date changes, so find the best stored copy ----------
  const RANGE_PREFIX = CACHE_PREFIX + 'logs_range:';

  function rangeStarts() {
    return storedKeys(RANGE_PREFIX).map((k) => k.slice(RANGE_PREFIX.length)).sort();
  }

  // Offline, a range that was never fetched exactly is cut out of the closest wider copy
  // (or, if there is none, out of the widest copy we have).
  function nearestRange(start) {
    const starts = rangeStarts();
    if (starts.length === 0) return undefined;

    const covering = starts.filter((s) => s <= start);
    const chosen = covering.length ? covering[covering.length - 1] : starts[0];
    const rows = read(RANGE_PREFIX + chosen);
    if (!Array.isArray(rows)) return undefined;
    return rows.filter((row) => row.log_date >= start);
  }

  // Keep the widest copy and the two newest ones, so storage does not grow every day.
  function pruneRanges() {
    const starts = rangeStarts();
    if (starts.length <= 3) return;
    const keep = new Set([starts[0], ...starts.slice(-2)]);
    starts.forEach((s) => { if (!keep.has(s)) remove(RANGE_PREFIX + s); });
  }

  // ---------- uploading the queue ----------
  let flushing = null;

  function flush() {
    if (flushing) return flushing;
    if (!isOnline() || getQueue().length === 0) return Promise.resolve();

    flushing = (async () => {
      let synced = 0;
      updateBadge();

      while (true) {
        const queue = getQueue();
        if (queue.length === 0) break;

        const op = queue[0];
        let result;
        try {
          result = await withTimeout(RAW[op.name](...op.args), WRITE_TIMEOUT_MS);
        } catch (err) {
          result = { error: err };
        }

        if (result && result.error) {
          const kind = classifyError(result.error, result.status);

          // Not the change's fault - keep it and try again later, in the same order.
          if (kind === 'network' || kind === 'auth') break;

          if (kind === 'unknown') {
            const tries = (op.tries || 0) + 1;
            if (tries < MAX_UNKNOWN_TRIES) {
              const fresh = getQueue();
              fresh[0] = { ...fresh[0], tries };
              write(QUEUE_KEY, fresh);
              break;
            }
          }

          if (kind !== 'duplicate') {
            console.warn('[Offline] Dropping change that the server rejected:', op, result.error);
          }
        }

        write(QUEUE_KEY, getQueue().slice(1));
        synced++;
      }

      if (synced > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('offline-sync-done', { detail: { synced } }));
      }
    })().finally(() => {
      flushing = null;
      updateBadge();
    });

    return flushing;
  }

  function enqueue(name, args) {
    write(QUEUE_KEY, [...getQueue(), { name, args, at: Date.now() }]);
    updateBadge();
  }

  // Upload what is waiting, then tell the app when it should reload its data.
  async function recover() {
    if (!isOnline()) return;
    await flush();
    if (stale && isOnline()) {
      stale = false;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('offline-reconnected'));
    }
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
      nearest: (s) => nearestRange(s),
      afterStore: pruneRanges,
      fallback: []
    },
    fetchTaskLogs: {
      key: () => 'task_logs',
      overlay: (rows) => overlayTaskLogs(rows),
      fallback: []
    }
  };

  // Check-ins: queued when there is no connection.
  const QUEUED_WRITES = ['addLog', 'removeLog', 'addTaskLog', 'removeTaskLogs'];

  // Changes the person makes on purpose - they need a connection and say so.
  const ONLINE_ONLY_WRITES = [
    'createHabit', 'updateHabit', 'softDeleteHabit', 'reactivateHabit',
    'createCategory', 'updateCategory', 'deleteCategory',
    'updateCategoryPositions', 'updateHabitCategory', 'updateHabitPositions',
    'sendBugReport',
    'createTaskCategory', 'updateTaskCategory', 'deleteTaskCategory',
    'createTask', 'updateTask', 'deleteTask',
    'updateConsent', 'updatePassword', 'resetPassword'
  ];

  // Housekeeping the app does on its own - fail quietly when offline (it is redone later).
  const BACKGROUND_WRITES = ['unlockAchievement', 'createStreakState', 'updateStreakState'];

  function install(api) {
    Object.keys(READS).forEach((name) => {
      if (typeof api[name] !== 'function') return;
      RAW[name] = api[name];
      const spec = READS[name];

      api[name] = async (...args) => {
        const key = CACHE_PREFIX + spec.key(...args);
        const overlay = (data) => (spec.overlay ? spec.overlay(data, ...args) : data);

        // Upload waiting changes first so the fresh read includes them - but never wait long.
        if (isOnline() && getQueue().length > 0) {
          await Promise.race([flush(), sleep(FLUSH_WAIT_MS)]);
        }

        let result;
        if (!isOnline()) {
          // Known to be offline: skip the request and go straight to the stored copy.
          result = { data: null, error: { message: 'offline' } };
        } else {
          // With a stored copy to fall back on, a hanging connection must not freeze the app.
          const timeout = read(key) !== undefined ? READ_TIMEOUT_MS : 0;
          try {
            result = await withTimeout(RAW[name].apply(api, args), timeout);
          } catch (err) {
            result = { data: null, error: err };
          }
        }

        if (result && !result.error) {
          write(key, result.data);
          if (spec.afterStore) spec.afterStore();
          return { ...result, data: overlay(result.data) };
        }

        const kind = classifyError(result && result.error, result && result.status);
        if (kind === 'network' || kind === 'auth') {
          let stored = read(key);
          if (stored === undefined && spec.nearest) stored = spec.nearest(...args);
          if (stored === undefined) stored = spec.fallback;

          if (stored !== undefined) {
            stale = true;
            return { data: overlay(stored), error: null, offline: true };
          }
        }

        return result;
      };
    });

    QUEUED_WRITES.forEach((name) => {
      if (typeof api[name] !== 'function') return;
      RAW[name] = api[name];

      api[name] = async (...args) => {
        // Anything already waiting must go up first to keep the order,
        // so while there is a queue (or an upload is running) new changes join it.
        if (!isOnline() || getQueue().length > 0 || flushing) {
          enqueue(name, args);
          flush();
          return { data: null, error: null, queued: true };
        }

        let result;
        try {
          result = await withTimeout(RAW[name].apply(api, args), WRITE_TIMEOUT_MS);
        } catch (err) {
          result = { data: null, error: err };
        }

        if (result && result.error) {
          const kind = classifyError(result.error, result.status);
          if (kind === 'network' || kind === 'auth') {
            enqueue(name, args);
            return { data: null, error: null, queued: true };
          }
        }
        return result;
      };
    });

    ONLINE_ONLY_WRITES.forEach((name) => {
      if (typeof api[name] !== 'function') return;
      const original = api[name];

      api[name] = (...args) => {
        if (!isOnline()) {
          toast(OFFLINE_WRITE_MESSAGE);
          return Promise.resolve({ data: null, error: { message: OFFLINE_WRITE_MESSAGE, offline: true } });
        }
        return original.apply(api, args);
      };
    });

    BACKGROUND_WRITES.forEach((name) => {
      if (typeof api[name] !== 'function') return;
      const original = api[name];

      api[name] = (...args) => {
        if (!isOnline()) {
          return Promise.resolve({ data: null, error: { message: OFFLINE_WRITE_MESSAGE, offline: true } });
        }
        return original.apply(api, args);
      };
    });

    // Never keep another person's data around after logging out.
    if (typeof api.logout === 'function') {
      const originalLogout = api.logout;
      api.logout = async (...args) => {
        let result;
        try {
          result = await originalLogout.apply(api, args);
        } catch (err) {
          result = { error: err };
        }

        // Offline the server call fails and the login would stay on the device - end it locally.
        if (result && result.error && typeof supabase !== 'undefined' && supabase) {
          try { await supabase.auth.signOut({ scope: 'local' }); } catch (_) {}
        }

        clearAll();
        return result;
      };
    }
  }

  function clearAll() {
    storedKeys('').forEach((k) => {
      if (k.startsWith(CACHE_PREFIX) || k === QUEUE_KEY || k === OWNER_KEY || k === USER_KEY) remove(k);
    });
    stale = false;
    updateBadge();
  }

  // Drop day-by-day caches older than ~60 days so storage does not grow forever.
  function pruneOldDays() {
    const prefix = CACHE_PREFIX + 'logs_date:';
    const limit = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    storedKeys(prefix)
      .filter((k) => k.slice(prefix.length) < limit)
      .forEach(remove);
  }

  // ---------- remembering who is logged in (so the app can start with no connection) ----------
  function rememberUser(user) {
    if (!user || !user.id) return;
    write(USER_KEY, { id: user.id, email: user.email, user_metadata: user.user_metadata || {} });
  }

  // For app start-up: when the login session could not be loaded only because
  // there is no (working) connection, return the remembered user; otherwise null.
  function getUserForOfflineStart(sessionError) {
    const saved = read(USER_KEY);
    if (!saved || !saved.id) return null;
    if (!isOnline() || isNetworkError(sessionError)) return saved;
    return null;
  }

  // Called once we know who is logged in.
  function setOwner(userId, user) {
    const previous = read(OWNER_KEY);
    if (previous && previous !== userId) clearAll();
    write(OWNER_KEY, userId);
    if (user) rememberUser(user);
    pruneOldDays();
    updateBadge();
    flush();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { updateBadge(); recover(); });
    window.addEventListener('offline', updateBadge);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') recover();
    });
    document.addEventListener('DOMContentLoaded', updateBadge);

    // "online" is not always fired (captive wifi, flaky mobile data) - check now and then.
    setInterval(() => {
      if (isOnline() && (getQueue().length > 0 || stale)) recover();
    }, RETRY_EVERY_MS);
  }

  if (typeof API !== 'undefined') install(API);

  return {
    install, flush, setOwner, clearAll, getQueue, updateBadge, isNetworkError,
    isOnline, toast, getUserForOfflineStart, isStale: () => stale
  };
})();
