// Vercel serverless function: keeps the Gemini API key on the server.
// The browser app runs the tool loop; this endpoint only forwards one generateContent call.
// If Google is busy (429/500/503) it waits briefly, retries, then tries a lighter model.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACKS = (process.env.GEMINI_FALLBACKS || 'gemini-2.5-flash-lite,gemini-2.0-flash').split(',').map(s => s.trim()).filter(Boolean);
const BUSY = [429, 500, 502, 503, 504];
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
  const attempts = [MODEL, MODEL].concat(FALLBACKS.filter(m => m !== MODEL));
  let last = { status: 502, text: JSON.stringify({ error: { message: 'no response from Gemini' } }) };
  for (let i = 0; i < attempts.length; i++) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(attempts[i]) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: payload });
      last = { status: r.status, text: await r.text() };
      if (r.ok) break;
      if (!BUSY.includes(r.status) && r.status !== 404) break;
    } catch (e) { last = { status: 502, text: JSON.stringify({ error: { message: 'upstream failure: ' + (e && e.message) } }) }; }
    if (i < attempts.length - 1) await wait(700);
  }
  res.status(last.status).setHeader('Content-Type', 'application/json').send(last.text);
};
