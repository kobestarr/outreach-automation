// Stateful fake of the GHL v2 endpoints the tracker uses. No network.
function makeFakeGhl({ pipelines = true, failures = [] } = {}) {
  const state = { pipelines: {}, contacts: [], opps: [], notes: {}, calls: [], seq: 0 };
  const id = (p) => `${p}${++state.seq}`;
  const WRITES = /^(POST|PUT|DELETE|PATCH)$/;
  function ensureLoc(loc) {
    if (!state.pipelines[loc]) state.pipelines[loc] = [];
    return state.pipelines[loc];
  }
  if (pipelines) {
    for (const loc of ['LOC_K', 'LOC_S', 'LOC_D']) {
      ensureLoc(loc).push(coldEmailPipeline(loc, id));
    }
  }
  const json = (status, body, headers = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const auth = (opts.headers || {}).Authorization || '';
    const loc = u.searchParams.get('locationId') || (body && body.locationId) || tokenLoc(auth);
    state.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth, write: WRITES.test(method) });
    const f = failures.find((x) => x.times > 0 && x.match(method, u.pathname));
    if (f) { f.times--; return json(f.status, { message: 'injected' }, f.headers || {}); }
    let m;
    if (method === 'GET' && u.pathname === '/opportunities/pipelines') return json(200, { pipelines: ensureLoc(loc) });
    if (method === 'POST' && u.pathname === '/opportunities/pipelines') {
      const p = { id: id('pl'), name: body.name, locationId: loc,
        stages: body.stages.map((s, i) => ({ id: id('st'), name: s.name, position: i })) };
      ensureLoc(loc).push(p); return json(201, { pipeline: p });
    }
    if (method === 'POST' && u.pathname === '/contacts/upsert') {
      let c = state.contacts.find((x) => x.locationId === loc && x.email === body.email);
      const isNew = !c;
      if (!c) { c = { id: id('ct'), locationId: loc, tags: [] }; state.contacts.push(c); }
      Object.assign(c, { email: body.email, firstName: body.firstName, companyName: body.companyName });
      if (body.tags) c.tags = body.tags;
      return json(200, { new: isNew, contact: c });
    }
    if (method === 'GET' && u.pathname === '/contacts/search/duplicate') {
      const c = state.contacts.find((x) => x.locationId === loc && x.email === u.searchParams.get('email'));
      return json(200, c ? { contact: c } : {});
    }
    if ((m = u.pathname.match(/^\/contacts\/([^/]+)\/tags$/)) && method === 'POST') {
      const c = state.contacts.find((x) => x.id === m[1]);
      for (const t of body.tags) if (!c.tags.includes(t)) c.tags.push(t);
      return json(201, { tags: c.tags });
    }
    if ((m = u.pathname.match(/^\/contacts\/([^/]+)\/notes$/))) {
      const list = (state.notes[m[1]] = state.notes[m[1]] || []);
      if (method === 'GET') return json(200, { notes: list });
      const n = { id: id('nt'), body: body.body, contactId: m[1] }; list.push(n); return json(201, { note: n });
    }
    if (method === 'GET' && u.pathname === '/opportunities/search') {
      const q = u.searchParams; const st = q.get('status');
      const r = state.opps.filter((o) => o.locationId === loc && (!q.get('contactId') || o.contactId === q.get('contactId')) &&
        (!q.get('pipelineId') || o.pipelineId === q.get('pipelineId')) && (!st || st === 'all' || o.status === st));
      return json(200, { opportunities: r, meta: { total: r.length } });
    }
    if (method === 'POST' && u.pathname === '/opportunities/') {
      const o = { id: id('op'), locationId: loc, ...body }; state.opps.push(o); return json(201, { opportunity: o });
    }
    if ((m = u.pathname.match(/^\/opportunities\/([^/]+)$/)) && method === 'PUT') {
      const o = state.opps.find((x) => x.id === m[1]); Object.assign(o, body); return json(200, { opportunity: o });
    }
    return json(404, { message: `fake: no route ${method} ${u.pathname}` });
  }
  return { fetch, state, writes: () => state.calls.filter((c) => c.write) };
}
function tokenLoc(auth) { return { 'Bearer tok-k': 'LOC_K', 'Bearer tok-s': 'LOC_S', 'Bearer tok-d': 'LOC_D' }[auth]; }
const STAGES = ['Replied', 'Interested', 'Call booked', 'Proposal sent', 'Won', 'Not now', 'Lost'];
function coldEmailPipeline(loc, id) {
  return { id: `pl_${loc}`, name: 'Cold Email', locationId: loc, stages: STAGES.map((n, i) => ({ id: `${loc}_${n}`, name: n, position: i })) };
}
const FAKE_CREDS = {
  kobestarr: { token: 'tok-k', locationId: 'LOC_K' },
  stripped: { token: 'tok-s', locationId: 'LOC_S' },
  dealflow: { token: 'tok-d', locationId: 'LOC_D' },
};
module.exports = { makeFakeGhl, FAKE_CREDS, STAGES };
