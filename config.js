/* Midpoint configuration.
   Leave these blank and the app works exactly as before: solo + share-a-link.
   Fill them in to enable live sessions, where everyone's pin updates in place.

   Both values are safe to commit. The client key is designed to be public — the
   database denies it all direct table access, so it can only call the mp_*
   functions in supabase/schema.sql, each of which requires a session code.

   Supabase renamed these keys. Use whichever your dashboard shows under
   Settings -> API Keys:
     - new projects:  "Publishable"  (sb_publishable_...)
     - older projects: "anon public" (a long JWT starting eyJ...)
   Both work here. NEVER use the "Secret" / service_role key: that one bypasses
   every protection above and must not be committed or shipped to a browser. */

window.MIDPOINT_CONFIG = {
  supabaseUrl: '',      // e.g. https://abcdefghijkl.supabase.co
  supabaseAnonKey: ''   // Publishable (or legacy anon) key — never the secret one
};
