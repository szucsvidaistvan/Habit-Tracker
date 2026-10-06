// Habit Tracker - "ical-proxy" Edge Function
//
// Browsers cannot read iCloud / Google calendar links directly (no CORS headers), so the app
// asks this function to fetch the .ics for it. Only logged-in users can call it (JWT is verified
// by Supabase), and only calendar hosts on the allow-list below are fetched.
//
// Deploy:  supabase functions deploy ical-proxy
// Body:    { "url": "https://p12-caldav.icloud.com/published/2/..." }
// Returns: { "ics": "BEGIN:VCALENDAR..." }

const ALLOWED_HOST_SUFFIXES = ['.icloud.com', 'calendar.google.com'];
const MAX_BYTES = 5 * 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function allowed(u: URL) {
  return u.protocol === 'https:' && ALLOWED_HOST_SUFFIXES.some(s => u.hostname === s.replace(/^\./, '') || u.hostname.endsWith(s));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { url } = await req.json();
    let target = new URL(String(url).replace(/^webcal:\/\//i, 'https://'));

    // follow redirects by hand so every hop is checked against the allow-list
    for (let hop = 0; hop < 4; hop++) {
      if (!allowed(target)) return json({ error: 'This calendar host is not allowed.' }, 400);
      const res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        target = new URL(res.headers.get('location')!, target);
        continue;
      }
      if (!res.ok) return json({ error: `Calendar returned ${res.status}` }, 502);
      const ics = await res.text();
      if (ics.length > MAX_BYTES) return json({ error: 'Calendar is too large.' }, 413);
      if (!ics.includes('BEGIN:VCALENDAR')) return json({ error: 'That link is not a calendar.' }, 422);
      return json({ ics });
    }
    return json({ error: 'Too many redirects.' }, 502);
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
