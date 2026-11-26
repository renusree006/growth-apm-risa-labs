// Vercel serverless function: keeps the Gemini API key on the server.
// The browser app runs the tool loop; this endpoint only forwards one generateContent call.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ok: !!process.env.GEMINI_API_KEY, model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server' });
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'invalid JSON' }); }
  if (!body || !Array.isArray(body.contents)) return res.status(400).json({ error: 'contents[] required' });
  const payload = { systemInstruction: body.systemInstruction, contents: body.contents, tools: body.tools };
  if (JSON.stringify(payload).length > 600000) return res.status(413).json({ error: 'request too large' });
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload) });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) { res.status(502).json({ error: 'upstream failure: ' + (e && e.message) }); }
};
