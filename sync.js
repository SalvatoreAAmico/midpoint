/* Live session sync for Midpoint.

   Talks only to the mp_* Postgres functions, never to tables directly — the
   anon key has no table access at all (see supabase/schema.sql).

   Updates arrive by polling rather than websockets. Supabase Realtime needs
   table-level read access to deliver changes, which is exactly what the
   security model forbids, so a 4-second poll buys privacy at the cost of a
   few seconds' latency. For a group of 4 deciding where to get coffee, that
   is the right trade. */

'use strict';

const POLL_MS = 4000;

const Sync = {
  url: '', key: '', code: null, me: null,
  timer: null, onState: null, failures: 0,

  get configured() { return !!(this.url && this.key); },
  get live() { return !!this.code; },

  init(cfg) {
    this.url = (cfg?.supabaseUrl || '').replace(/\/+$/, '');
    this.key = cfg?.supabaseAnonKey || '';
    return this.configured;
  },

  async rpc(fn, args) {
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
      if (/session_full/.test(detail))      throw new Error('That session already has 4 people.');
      throw new Error(detail || `Server error ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  },

  async create(name, lat, lon) {
    const r = await this.rpc('mp_create', { p_name: name || '', p_lat: lat, p_lon: lon });
    this.code = r.code; this.me = r.participant_id;
    this.start();
    return r;
  },

  async join(code, name, lat, lon) {
    const r = await this.rpc('mp_join',
      { p_code: code, p_name: name || '', p_lat: lat, p_lon: lon });
    this.code = code.toLowerCase(); this.me = r.participant_id;
    this.start();
    return r;
  },

  push(name, lat, lon) {
    if (!this.live) return Promise.resolve();
    return this.rpc('mp_update', {
      p_code: this.code, p_participant: this.me,
      p_name: name || '', p_lat: lat ?? null, p_lon: lon ?? null
    }).catch(() => {});
  },

  prefs(cats, filters) {
    if (!this.live) return Promise.resolve();
    return this.rpc('mp_prefs',
      { p_code: this.code, p_cats: cats, p_filters: filters }).catch(() => {});
  },

  vote(venueKey, dir) {
    if (!this.live) return Promise.resolve();
    return this.rpc('mp_vote', {
      p_code: this.code, p_participant: this.me, p_venue: venueKey, p_dir: dir
    }).catch(() => {});
  },

  async poll() {
    if (!this.live) return;
    try {
      const state = await this.rpc('mp_state', { p_code: this.code });
      this.failures = 0;
      this.onState?.(state);
    } catch (e) {
      // Tolerate a couple of blips (tunnel, sleeping phone) before giving up.
      if (++this.failures >= 3) { this.onState?.(null, e); this.stop(); }
    }
  },

  start() {
    this.stop();
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  },

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  async leave() {
    if (!this.live) return;
    const { code, me } = this;
    this.stop(); this.code = null; this.me = null; this.failures = 0;
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
