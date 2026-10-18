// Stateful, strict fake of the GHL v2 endpoints the tracker uses. No network.
// Strictness: routes by token (403 when the token's location does not match the request or the entity),
// case-insensitive emails, status filter on search (absent = open only, like a careful reading of the docs),
// pipeline stages must be created in order with positions 1..n, stage ids must belong to the pipeline.
const STAGES = ['Replied', 'Interested', 'Call booked', 'Proposal sent', 'Won', 'Not now', 'Lost'];
const TOKEN_LOC = { 'tok-k': 'LOC_K', 'tok-s': 'LOC_S', 'tok-d': 'LOC_D' };
const LOC_NAMES = { LOC_K: 'Kobestarr Digital', LOC_S: 'Stripped Media', LOC_D: 'DealFlow Media' };

function makeFakeGhl({ pipelines = true, failures = [], locationNames = {}, locationIds = {} } = {}) {
  const state = { pipelines: {}, contacts: [], opps: [], notes: {}, calls: [], seq: 0, locationNames: { ...LOC_NAMES, ...locationNames } };
  const id = (p) => `${p}${++state.seq}`;
  const WRITES = /^(POST|PUT|DELETE|PATCH)$/;
  const lc = (s) => String(s || '').toLowerCase();
  const ensureLoc = (loc) => (state.pipelines[loc] = state.pipelines[loc] || []);
  if (pipelines) for (const loc of Object.keys(LOC_NAMES)) ensureLoc(loc).push(coldEmailPipeline(loc));
  const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });

  function handle(method, u, body, tokenLocation) {
    const reqLoc = u.searchParams.get('locationId') || (body && body.locationId);
    if (reqLoc && reqLoc !== tokenLocation) return [403, { message: 'token does not belong to this location' }];
    const loc = tokenLocation;
    let m;
    const own = (e) => e && e.locationId === loc;
    if ((m = u.pathname.match(/^\/locations\/([^/]+)$/)) && method === 'GET') {
      if (m[1] !== loc) return [403, { message: 'forbidden' }];
      return [200, { location: { id: locationIds[loc] || loc, name: state.locationNames[loc] } }];
    }
    if (method === 'GET' && u.pathname === '/opportunities/pipelines') return [200, { pipelines: ensureLoc(loc) }];
    if (method === 'POST' && u.pathname === '/opportunities/pipelines') {
      const ok = Array.isArray(body.stages) && body.stages.every((s, i) => s && typeof s.name === 'string' && s.position === i + 1);
      if (!ok) return [422, { message: 'stages must be objects with position 1..n in order' }];
      const p = { id: id('pl'), name: body.name, locationId: loc, stages: body.stages.map((s) => ({ id: id('st'), name: s.name, position: s.position })) };
      ensureLoc(loc).push(p); return [201, { pipeline: p }];
    }
    if (method === 'POST' && u.pathname === '/contacts/upsert') {
      let c = state.contacts.find((x) => x.locationId === loc && lc(x.email) === lc(body.email));
      const isNew = !c;
      if (!c) { c = { id: id('ct'), locationId: loc, tags: [] }; state.contacts.push(c); }
      Object.assign(c, { email: body.email, firstName: body.firstName || c.firstName, companyName: body.companyName || c.companyName });
      if (body.tags) c.tags = body.tags;
      return [200, { new: isNew, contact: c }];
    }
    if (method === 'GET' && u.pathname === '/contacts/search/duplicate') {
      const c = state.contacts.find((x) => x.locationId === loc && lc(x.email) === lc(u.searchParams.get('email')));
      return [200, c ? { contact: c } : {}];
    }
    if ((m = u.pathname.match(/^\/contacts\/([^/]+)$/)) && method === 'GET') {
      const c = state.contacts.find((x) => x.id === m[1]); if (!own(c)) return [403, { message: 'forbidden' }]; return [200, { contact: c }];
    }
    if ((m = u.pathname.match(/^\/contacts\/([^/]+)\/tags$/)) && method === 'POST') {
      const c = state.contacts.find((x) => x.id === m[1]); if (!own(c)) return [403, { message: 'forbidden' }];
      for (const t of body.tags) if (!c.tags.includes(t)) c.tags.push(t);
      return [201, { tags: c.tags }];
    }
    if ((m = u.pathname.match(/^\/contacts\/([^/]+)\/notes$/))) {
      const c = state.contacts.find((x) => x.id === m[1]); if (!own(c)) return [403, { message: 'forbidden' }];
      const list = (state.notes[m[1]] = state.notes[m[1]] || []);
      if (method === 'GET') return [200, { notes: list }];
      const n = { id: id('nt'), body: body.body, contactId: m[1] }; list.push(n); return [201, { note: n }];
    }
    if (method === 'GET' && u.pathname === '/opportunities/search') {
      const q = u.searchParams; const st = q.get('status') || 'open';
      const r = state.opps.filter((o) => o.locationId === loc && (!q.get('contactId') || o.contactId === q.get('contactId')) &&
        (!q.get('pipelineId') || o.pipelineId === q.get('pipelineId')) && (st === 'all' || o.status === st));
      return [200, { opportunities: r, meta: { total: r.length } }];
    }
    if (method === 'POST' && u.pathname === '/opportunities/') {
      for (const k of ['pipelineId', 'locationId', 'name', 'status', 'contactId']) if (!body[k]) return [422, { message: `${k} required` }];
      const p = ensureLoc(loc).find((x) => x.id === body.pipelineId);
      if (!p || (body.pipelineStageId && !p.stages.some((s) => s.id === body.pipelineStageId))) return [422, { message: 'bad pipeline/stage' }];
      const o = { id: id('op'), ...body, locationId: loc }; state.opps.push(o); return [201, { opportunity: o }];
    }
    if ((m = u.pathname.match(/^\/opportunities\/([^/]+)$/))) {
      const o = state.opps.find((x) => x.id === m[1]); if (!own(o)) return [403, { message: 'forbidden' }];
      if (method === 'GET') return [200, { opportunity: o }];
      if (method === 'PUT') {
        const p = ensureLoc(loc).find((x) => x.id === o.pipelineId);
        if (body.pipelineStageId && !p.stages.some((s) => s.id === body.pipelineStageId)) return [422, { message: 'bad stage' }];
        Object.assign(o, body); return [200, { opportunity: o }];
      }
    }
    return [404, { message: `fake: no route ${method} ${u.pathname}` }];
  }

  async function fetch(url, opts = {}) {
    const u = new URL(url); const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const auth = (opts.headers || {}).Authorization || '';
    state.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth, write: WRITES.test(method) });
    const tokenLocation = TOKEN_LOC[auth.replace(/^Bearer /, '')];
    if (!tokenLocation) return res(401, { message: 'invalid token' });
    const f = failures.find((x) => x.times > 0 && x.match(method, u.pathname));
    if (f) {
      f.times--;
      if (f.afterApply) handle(method, u, body, tokenLocation); // the write LANDED, but the client sees a failure
      if (f.abort) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return res(f.status, { message: f.message || 'injected' }, f.headers || {});
    }
    const [status, out] = handle(method, u, body, tokenLocation);
    return res(status, out);
  }
  return { fetch, state, writes: () => state.calls.filter((c) => c.write), dealsFor: (email) => {
    const c = state.contacts.find((x) => lc(x.email) === lc(email)); return c ? state.opps.filter((o) => o.contactId === c.id) : [];
  } };
}

function coldEmailPipeline(loc) {
  return { id: `pl_${loc}`, name: 'Cold Email', locationId: loc, stages: STAGES.map((n, i) => ({ id: `${loc}_${n}`, name: n, position: i + 1 })) };
}
const FAKE_CREDS = {
  kobestarr: { token: 'tok-k', locationId: 'LOC_K' }, stripped: { token: 'tok-s', locationId: 'LOC_S' }, dealflow: { token: 'tok-d', locationId: 'LOC_D' },
};

// Fake of `ghlp <profile> --json <group> <cmd> ...`. Only the commands the real CLI has; unsupported ones throw,
// which proves the tracker never asks the CLI for something it cannot do. profileMap simulates a mis-pointed .env.
function makeFakeExec(fake, { failures = [], profileMap = {} } = {}) {
  const calls = [];
  const base = { kobestarr: ['tok-k', 'LOC_K'], stripped: ['tok-s', 'LOC_S'], dealflow: ['tok-d', 'LOC_D'] };
  async function exec(file, args) {
    calls.push({ file, args });
    const f = failures.find((x) => x.times > 0);
    if (f) { f.times--; const e = new Error('cli failed'); e.stderr = f.stderr; throw e; }
    const [profile, , group, cmd, ...rest] = args;
    const [token, loc] = base[profileMap[profile] || profile];
    const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
    const go = async (method, path, body) => {
      const r = await fake.fetch(`https://x${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify({ locationId: loc, ...body }) : undefined });
      const t = JSON.parse(await r.text()); if (!r.ok) { const e = new Error('http'); e.stderr = `API Error (${r.status}): ${t.message}`; throw e; } return t;
    };
    let out;
    if (group === 'opportunities' && cmd === 'pipelines') out = await go('GET', `/opportunities/pipelines?locationId=${loc}`);
    else if (group === 'opportunities' && cmd === 'get') out = await go('GET', `/opportunities/${rest[0]}`);
    else if (group === 'opportunities' && cmd === 'create') out = await go('POST', '/opportunities/', { pipelineId: opt('--pipeline-id'), pipelineStageId: opt('--stage-id'), name: opt('--name'), contactId: opt('--contact-id'), status: opt('--status') });
    else if (group === 'opportunities' && cmd === 'update') { const b = {}; if (opt('--stage-id')) b.pipelineStageId = opt('--stage-id'); if (opt('--status')) b.status = opt('--status'); out = await go('PUT', `/opportunities/${rest[0]}`, b); }
    else if (group === 'contacts' && cmd === 'add-tag') out = await go('POST', `/contacts/${rest[0]}/tags`, { tags: rest.slice(1) });
    else if (group === 'locations' && cmd === 'get') out = await go('GET', `/locations/${loc}`);
    else throw new Error(`fake exec: the real CLI has no such command: ${group} ${cmd}`);
    return { stdout: JSON.stringify(out, null, 2) };
  }
  return { exec, calls };
}
module.exports = { makeFakeExec, makeFakeGhl, FAKE_CREDS, STAGES };
