/* Live session sync for Midpoint.

   Talks only to the mp_* Postgres functions, never to tables directly — the
   anon key has no table access at all (see supabase/schema.sql).

   Updates arrive by polling rather than websockets. Supabase Realtime needs
   table-level read access to deliver changes, which is exactly what the
   security model forbids, so a 4-second poll buys privacy at the cost of a
   few seconds' latency. For a group of 4 deciding where to get coffee, that
   is the right trade. */

'use strict';

/* Spend guards. The free tier cannot bill you — it throttles instead — but a
   runaway poll could still burn the month's egress and take the app down, so
   the client caps itself in four ways:
     1. a hard floor on the interval, so no bug can poll faster than this
     2. polling pauses entirely while the tab is hidden
     3. only one request is ever in flight
     4. failures back off, and a session auto-ends after MAX_SESSION_MS
   Rough cost at these settings: 4 people for an hour is ~3.6 MB of a 5 GB
   monthly allowance, so roughly 1,400 hour-long meetups before it matters. */
const POLL_MS = 4000;
const POLL_FLOOR_MS = 2000;
const MAX_BACKOFF_MS = 60000;
const MAX_SESSION_MS = 2 * 60 * 60 * 1000;   // auto-leave after 2 hours

const STORE_KEY = 'midpoint.session';

const Sync = {
  url: '', key: '', code: null, me: null,
  timer: null, onState: null, onWriteError: null, failures: 0,
  writeFailed: false, needsMigration: false, needsResults: false,
  inFlight: false, startedAt: 0, requests: 0, paused: false,

  get configured() { return !!(this.url && this.key); },
  get live() { return !!this.code; },

  init(cfg) {
    this.url = (cfg?.supabaseUrl || '').replace(/\/+$/, '');
    this.key = cfg?.supabaseAnonKey || '';
    if (this.configured && typeof document !== 'undefined') this.watchVisibility();
    return this.configured;
  },

  async rpc(fn, args) {
    this.requests++;
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`
      },
      body: JSON.stringify(args || {})
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch { /* non-JSON error */ }
      if (/session_not_found/.test(detail)) throw new Error('That session has expired or does not exist.');
      if (/session_full/.test(detail))      throw new Error('That session already has 8 people.');
      throw new Error(detail || `Server error ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  },

  /* Who you already are in a session, kept across reloads. Without this,
     refreshing a shared link joins again and again, filling the session with
     copies of one person. */
  remember() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ code: this.code, me: this.me })); }
    catch { /* private browsing */ }
  },
  recall(code) {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return v && v.code === code && v.me ? v.me : null;
    } catch { return null; }
  },
  forget() { try { localStorage.removeItem(STORE_KEY); } catch {} },

  /* Rejoin as yourself if the session still knows you. Returns the remote
     state on success, or null if you are not in it (left, expired, or a
     session this device never joined). */
  async resume(code) {
    const me = this.recall(code);
    if (!me) return null;
    const state = await this.rpc('mp_state', { p_code: code });
    if (!(state.people || []).some(p => p.id === me)) return null;
    this.code = code; this.me = me;
    this.start();
    return state;
  },

  /* PostgREST reports an unknown signature as PGRST202. The label column is
     added by supabase/fix-002; until that has been run, fall back to the
     original argument list so the app keeps working rather than failing
     silently on every write. */
  async rpcCompat(fn, withLabel, withoutLabel) {
    try {
      return await this.rpc(fn, withLabel);
    } catch (e) {
      if (!/PGRST202|Could not find the function|does not exist/i.test(e.message)) throw e;
      this.needsMigration = true;
      return await this.rpc(fn, withoutLabel);
    }
  },

  async create(name, label, lat, lon) {
    const r = await this.rpcCompat('mp_create',
      { p_name: name || '', p_label: label || '', p_lat: lat, p_lon: lon },
      { p_name: name || '', p_lat: lat, p_lon: lon });
    this.code = r.code; this.me = r.participant_id;
    this.remember();
    this.start();
    return r;
  },

  async join(code, name, label, lat, lon) {
    const r = await this.rpcCompat('mp_join',
      { p_code: code, p_name: name || '', p_label: label || '', p_lat: lat, p_lon: lon },
      { p_code: code, p_name: name || '', p_lat: lat, p_lon: lon });
    this.code = code.toLowerCase(); this.me = r.participant_id;
    this.remember();
    this.start();
    return r;
  },

  /* The place name travels too. Without it, everyone else saw a pin with no
     label, and on reload the person's own typed location looked lost. */
  push(name, label, lat, lon) {
    if (!this.live) return Promise.resolve();
    return this.rpcCompat('mp_update',
      { p_code: this.code, p_participant: this.me,
        p_name: name || '', p_label: label || '',
        p_lat: lat ?? null, p_lon: lon ?? null },
      { p_code: this.code, p_participant: this.me,
        p_name: name || '', p_lat: lat ?? null, p_lon: lon ?? null }
    ).then(() => { this.writeFailed = false; })
     .catch(e => {
       // Swallowing this meant everything typed after going live vanished on
       // reload, with nothing on screen to say so.
       this.writeFailed = true;
       this.onWriteError?.(e);
     });
  },

  prefs(cats, filters) {
    if (!this.live) return Promise.resolve();
    return this.rpc('mp_prefs',
      { p_code: this.code, p_cats: cats, p_filters: filters }).catch(() => {});
  },

  /* One search serves the session. The payload carries the participant ids it
     was computed for, so each device can map travel times to the right person
     even if the roster has changed since. */
  results(payload) {
    if (!this.live) return Promise.resolve();
    return this.rpc('mp_results',
      { p_code: this.code, p_participant: this.me, p_results: payload })
      .then(() => { this.needsResults = false; })
      /* A server without fix-003 has no mp_results at all. Reported as a
         generic write failure it read as "check your connection", which sent
         Sal looking at his wifi while the list quietly stayed private to one
         phone. Name the missing migration instead. */
      .catch(e => {
        if (/PGRST202|Could not find the function|does not exist/i.test(e.message))
          this.needsResults = true;
        this.onWriteError?.(e);
      });
  },

  vote(venueKey, dir) {
    if (!this.live) return Promise.resolve();
    return this.rpc('mp_vote', {
      p_code: this.code, p_participant: this.me, p_venue: venueKey, p_dir: dir
    }).catch(() => {});
  },

  async poll() {
    if (!this.live || this.paused) return;
    // Never stack requests: a slow network must not queue up a backlog.
    if (this.inFlight) return;

    if (Date.now() - this.startedAt > MAX_SESSION_MS) {
      this.onState?.(null, new Error('Session ended after 2 hours. Tap Go live to start a new one.'));
      this.leave();
      return;
    }

    this.inFlight = true;
    try {
      const state = await this.rpc('mp_state', { p_code: this.code });
      if (this.failures) this.schedule(POLL_MS);   // recovered: back to normal cadence
      this.failures = 0;
      this.onState?.(state);
    } catch (e) {
      // Tolerate a couple of blips (tunnel, sleeping phone) before giving up,
      // and slow down in between rather than hammering a failing server.
      if (++this.failures >= 5) { this.onState?.(null, e); this.stop(); }
      else this.schedule(Math.min(POLL_MS * 2 ** this.failures, MAX_BACKOFF_MS));
    } finally {
      this.inFlight = false;
    }
  },

  schedule(ms) {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(), Math.max(POLL_FLOOR_MS, ms));
  },

  start() {
    this.stop();
    this.startedAt = Date.now();
    this.poll();
    this.schedule(POLL_MS);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.inFlight = false;
  },

  /* A backgrounded tab costs requests for updates nobody is looking at, so
     stop entirely while hidden and refresh once on the way back. */
  watchVisibility() {
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
      if (!this.live) return;
      if (document.hidden) { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
      else { this.poll(); this.schedule(POLL_MS); }
    });
  },

  async leave() {
    if (!this.live) return;
    const { code, me } = this;
    this.stop(); this.forget();
    this.code = null; this.me = null; this.failures = 0; this.startedAt = 0;
    await this.rpc('mp_leave', { p_code: code, p_participant: me }).catch(() => {});
  },

  shareURL() {
    return this.live
      ? `${location.origin}${location.pathname}?s=${this.code}`
      : location.href;
  }
};

if (typeof window !== 'undefined') window.Sync = Sync;
if (typeof module !== 'undefined') module.exports = { Sync, POLL_MS };
