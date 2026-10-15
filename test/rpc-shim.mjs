/* A stand-in for PostgREST, for testing clients against the REAL schema.

   Supabase exposes each public function as POST /rest/v1/rpc/<name> with a JSON
   object of named arguments. This does the same against the throwaway Postgres
   from test/pg-up.sh, running every call AS THE anon ROLE -- the role the
   publishable key maps to -- so a client that passes here can do exactly what a
   phone can do, and nothing a phone cannot.

     node test/rpc-shim.mjs [port]     (default 8097; prints "listening <port>")

   It checks the apikey header, because a client that forgets it would pass
   here and fail in production. Errors come back as {"message": ...} with the
   Postgres exception text, which is where PostgREST puts it and what both
   clients match on ("session_not_found", "session_full"). */
import http from 'http';
import { execFile } from 'child_process';

const PORT = +(process.argv[2] || process.env.PORT || 8097);
const KEY = process.env.MP_ANON_KEY || 'anon-key';
const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', process.env.MPDB || 'mp', '-qAt', '-v', 'ON_ERROR_STOP=1'];

const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const TYPES = {
  p_lat: v => v == null ? 'null::double precision' : `${Number(v)}::double precision`,
  p_lon: v => v == null ? 'null::double precision' : `${Number(v)}::double precision`,
  p_dir: v => `${Math.trunc(Number(v))}::int`,
  p_participant: v => `${lit(v)}::uuid`,
  p_cats: v => v == null ? 'null::jsonb' : `${lit(JSON.stringify(v))}::jsonb`,
  p_filters: v => v == null ? 'null::jsonb' : `${lit(JSON.stringify(v))}::jsonb`,
  p_results: v => v == null ? 'null::jsonb' : `${lit(JSON.stringify(v))}::jsonb`,
};
const arg = ([k, v]) => {
  if (!/^p_[a-z_]+$/.test(k)) throw new Error('bad argument name');
  return `${k} := ${(TYPES[k] || (x => x == null ? 'null::text' : `${lit(x)}::text`))(v)}`;
};

const run = sql => new Promise(res => execFile('psql', [...PSQL, '-c', sql], { maxBuffer: 1 << 24 },
  (err, out, errOut) => res({ err, out: out.trim(), errOut })));

http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body ?? ''); };
  const m = req.url.match(/^\/rest\/v1\/rpc\/(mp_[a-z_]+)$/);
  if (req.method !== 'POST' || !m) return send(404, JSON.stringify({ message: 'not found' }));
  if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) {
    return send(401, JSON.stringify({ message: 'Invalid API key' }));
  }
  let body = '';
  for await (const c of req) body += c;
  let args;
  try { args = JSON.parse(body || '{}'); } catch { return send(400, JSON.stringify({ message: 'bad json' })); }
  let sql;
  try { sql = `set role anon; select public.${m[1]}(${Object.entries(args).map(arg).join(', ')});`; }
  catch (e) { return send(400, JSON.stringify({ message: e.message })); }

  const { err, out, errOut } = await run(sql);
  if (err) {
    // psql prints "ERROR:  session_full" (and sometimes a CONTEXT line after it).
    const msg = (errOut.match(/ERROR:\s+(.*)/) || [, errOut.trim()])[1];
    const missing = /function .* does not exist/.test(msg);
    return send(missing ? 404 : 400, JSON.stringify({ code: missing ? 'PGRST202' : 'P0001', message: msg }));
  }
  // A void function prints one empty line: PostgREST answers 204.
  return out === '' ? send(204) : send(200, out);
}).listen(PORT, '127.0.0.1', () => console.log('listening ' + PORT));
