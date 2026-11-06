// Synthetic local stand-in for the documented Cloudflare Clef REST contract.
// This tests transport and errors, never model quality. Use synthetic credentials only.
const http = require('node:http');
let scenario = 'success';
let calls = 0;
http.createServer(async (request, response) => {
  const reply = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (request.url.startsWith('/__scenario/')) {
    scenario = request.url.slice('/__scenario/'.length);
    calls = 0;
    return reply(200, { scenario });
  }
  if (request.url === '/__stats') return reply(200, { calls, scenario });
  if (request.method !== 'POST' || !/^\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/run\/@cf\/cloudflare\/clef$/i.test(request.url)) {
    return reply(501, { error: 'Not modeled by this stand-in.' });
  }
  calls++;
  if (request.headers.authorization !== 'Bearer synthetic-test-token') return reply(401, { success: false });
  let body = request.body;
  if (!body) {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    try { body = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return reply(400, { success: false }); }
  }
  const question = body.questions && body.questions.selection;
  const criteria = question && question.criteria;
  if (Object.keys(body).sort().join(',') !== 'model,questions,state' || body.model !== 'clef' || typeof body.state !== 'string' ||
      !question || question.type !== 'choice' || !criteria || Object.keys(criteria).length < 2 || Object.keys(criteria).length > 255) {
    return reply(400, { success: false });
  }
  if (scenario === 'quota') return reply(429, { success: false, errors: [{ message: 'Synthetic quota fixture.' }] });
  if (scenario === 'failure') return reply(503, { success: false });
  if (scenario === 'timeout') return setTimeout(() => reply(200, {}), 12000);
  const ids = Object.keys(criteria);
  let chosen = ids.find(id => criteria[id] === 'Smileys & Emotion') || (ids.includes('e_1f60a') ? 'e_1f60a' : ids[0]);
  if (scenario === 'invalid') chosen = 'unknown';
  if (scenario === 'unsafe') chosen = 'e_1f44d_1f3ff';
  return reply(200, { success: true, result: { answers: { selection: { type: 'choice', choice: chosen, confidence: 1,
    probabilities: Object.fromEntries(ids.map(id => [id, id === chosen ? 1 : 0])) } }, usage: { input_tokens: 10 } } });
}).listen(process.env.PORT || 4010);
