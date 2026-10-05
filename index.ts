// Habit Tracker - "send-reminders" Edge Function
//
// Runs on a schedule (every 5 minutes, via pg_cron - see migration_push_notifications.sql).
// For every habit / task with a reminder due right now, in the owner's own time zone, sends
// a real Web Push notification - this reaches the person even if the app/tab is closed.
//
// Required secrets (set once with `supabase secrets set`, see README further down):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Auto-provided by Supabase, no setup needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2.48.0';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';

// How wide a window (in the owner's local minutes-since-midnight) counts as "due now".
// Matches the 5-minute cron tick, with a little slack for cron jitter.
const WINDOW_MINUTES = 5;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function localParts(date: Date, timeZone: string) {
  // en-CA gives YYYY-MM-DD directly; hour12:false avoids the "24:00" edge case some locales use.
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  const [hh, mm] = timeStr.split(':').map(Number);
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday ... matches recurrence_days
  return { dateStr, minutes: hh * 60 + mm, weekday };
}

function timeStrToMinutes(t: string | null) {
  if (!t) return null;
  const [hh, mm] = t.split(':').map(Number);
  return hh * 60 + mm;
}

function isDueNow(reminderMinutes: number | null, nowMinutes: number) {
  if (reminderMinutes == null) return false;
  const diff = nowMinutes - reminderMinutes;
  return diff >= 0 && diff < WINDOW_MINUTES;
}

async function alreadySent(entityType: 'habit' | 'task', entityId: number, dateStr: string) {
  const { data } = await supabase
    .from('sent_reminders')
    .select('entity_id')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('reminder_date', dateStr)
    .maybeSingle();
  return !!data;
}

async function markSent(entityType: 'habit' | 'task', entityId: number, dateStr: string) {
  await supabase.from('sent_reminders').insert([{ entity_type: entityType, entity_id: entityId, reminder_date: dateStr }]);
}

async function sendToUser(userId: string, payload: Record<string, unknown>) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs || subs.length === 0) return false;

  let sentAny = false;
  await Promise.all(subs.map(async (sub) => {
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    try {
      await webpush.sendNotification(pushSub, JSON.stringify(payload));
      sentAny = true;
    } catch (err) {
      const status = err && (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The browser/OS dropped this subscription - stop trying to reach it.
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('[send-reminders] push failed for', sub.endpoint, err);
      }
    }
  }));
  return sentAny;
}

Deno.serve(async () => {
  const now = new Date();

  // One admin call covers every user; user_metadata.timezone is set by the app on login
  // (Intl.DateTimeFormat().resolvedOptions().timeZone), defaulting to UTC otherwise.
  const { data: userPage, error: usersError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) {
    console.error('[send-reminders] could not list users:', usersError);
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
  }
  const timezoneByUser = new Map<string, string>(
    (userPage?.users || []).map((u) => [u.id, (u.user_metadata as Record<string, unknown> | null)?.timezone as string || 'UTC'])
  );

  let habitsSent = 0;
  let tasksSent = 0;

  // ---------- Habits ----------
  const { data: habits, error: habitsError } = await supabase
    .from('habits')
    .select('id, user_id, title, reminder_time, reminder_enabled, is_active')
    .eq('is_active', true)
    .eq('reminder_enabled', true)
    .not('reminder_time', 'is', null);

  if (habitsError) console.error('[send-reminders] habits query error:', habitsError);

  for (const habit of habits || []) {
    const tz = timezoneByUser.get(habit.user_id) || 'UTC';
    const { minutes, dateStr } = localParts(now, tz);
    const reminderMinutes = timeStrToMinutes(habit.reminder_time);
    if (!isDueNow(reminderMinutes, minutes)) continue;

    const { data: log } = await supabase
      .from('daily_logs')
      .select('id')
      .eq('habit_id', habit.id)
      .eq('log_date', dateStr)
      .maybeSingle();
    if (log) continue; // already checked in today

    if (await alreadySent('habit', habit.id, dateStr)) continue;

    const sent = await sendToUser(habit.user_id, {
      title: 'Habit Tracker',
      body: `Don't forget: ${habit.title}`,
      tag: `habit-${habit.id}`,
      url: '/'
    });
    if (sent) { await markSent('habit', habit.id, dateStr); habitsSent++; }
  }

  // ---------- Tasks ----------
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('id, user_id, title, recurrence_type, due_date, end_date, recurrence_days, recurrence_month_day, start_time, reminder_enabled');

  if (tasksError) console.error('[send-reminders] tasks query error:', tasksError);

  for (const task of tasks || []) {
    if (task.reminder_enabled === false || !task.start_time) continue;

    const tz = timezoneByUser.get(task.user_id) || 'UTC';
    const { minutes, dateStr, weekday } = localParts(now, tz);
    const reminderMinutes = timeStrToMinutes(task.start_time);
    if (!isDueNow(reminderMinutes, minutes)) continue;

    let dueToday = false;
    if (task.recurrence_type === 'weekly') {
      dueToday = Array.isArray(task.recurrence_days) && task.recurrence_days.includes(weekday);
    } else if (task.recurrence_type === 'monthly') {
      const day = Number(dateStr.slice(8, 10));
      dueToday = day === (task.recurrence_month_day || 1);
    } else {
      // a task without a date is "due" every day until it is checked off
      dueToday = !task.due_date || task.due_date === dateStr;
    }
    if (!dueToday) continue;

    // one-time tasks: done once = done for good; repeating tasks: done today
    let logQuery = supabase.from('task_logs').select('id').eq('task_id', task.id);
    if (task.recurrence_type === 'weekly' || task.recurrence_type === 'monthly') {
      logQuery = logQuery.eq('log_date', dateStr);
    }
    const { data: logs } = await logQuery.limit(1);
    if (logs && logs.length > 0) continue; // already completed

    if (await alreadySent('task', task.id, dateStr)) continue;

    const sent = await sendToUser(task.user_id, {
      title: 'Habit Tracker',
      body: `Task due: ${task.title}`,
      tag: `task-${task.id}`,
      url: '/'
    });
    if (sent) { await markSent('task', task.id, dateStr); tasksSent++; }
  }

  return new Response(JSON.stringify({ ok: true, habitsSent, tasksSent }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
