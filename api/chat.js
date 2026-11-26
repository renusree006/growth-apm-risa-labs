// Vercel serverless function: keeps the Gemini API key on the server.
// The browser app runs the tool loop; this endpoint only forwards one generateContent call.
// If a model is busy (429/5xx) or retired (404), it tries the next model in the list.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACKS = (process.env.GEMINI_FALLBACKS || 'gemini-3.8-flash,gemini-2.5-flash-lite').split(',').map(s => s.trim()).filter(Boolean);
const RETRY = [404, 429, 500, 502, 503, 504];
const wait = ms => new Promise(r => setTimeout(r, ms));
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ok: !!process.env.GEMINI_API_KEY, model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server' });
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'invalid JSON' }); }
  if (!body || !Array.isArray(body.contents)) return res.status(400).json({ error: 'contents[] required' });
  const payload = JSON.stringify({ systemInstruction: body.systemInstruction, contents: body.contents, tools: body.tools });
  if (payload.length > 600000) return res.status(413).json({ error: 'request too large' });
  const models = [MODEL].concat(FALLBACKS.filter(m => m !== MODEL));
  const attempts = models.concat([MODEL]); // one last retry of the main model
  let best = null; // most useful failure to report (a busy error beats "model not found")
  for (let i = 0; i < attempts.length; i++) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(attempts[i]) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: payload });
      const text = await r.text();
      if (r.ok) return res.status(200).setHeader('Content-Type', 'application/json').send(text);
      if (!best || (best.status === 404 && r.status !== 404)) best = { status: r.status, text };
      if (!RETRY.includes(r.status)) break;
    } catch (e) { if (!best) best = { status: 502, text: JSON.stringify({ error: { message: 'upstream failure: ' + (e && e.message) } }) }; }
    if (i < attempts.length - 1) await wait(i < 2 ? 600 : 1500);
  }
  best = best || { status: 502, text: JSON.stringify({ error: { message: 'no response from Gemini' } }) };
  res.status(best.status).setHeader('Content-Type', 'application/json').send(best.text);
};
