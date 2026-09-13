/* Midpoint configuration.
   Leave these blank and the app works exactly as before: solo + share-a-link.
   Fill them in to enable live sessions, where everyone's pin updates in place.

   Both values are safe to commit. The anon key is designed to be public — the
   database denies it all direct table access, so it can only call the mp_*
   functions in supabase/schema.sql, each of which requires a session code.
   Never put the *service_role* key here; that one bypasses every protection. */

window.MIDPOINT_CONFIG = {
  supabaseUrl: '',      // e.g. https://abcdefghijkl.supabase.co
  supabaseAnonKey: ''   // the "anon public" key, NOT service_role
};
