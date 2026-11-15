const { getSessions, setSessions } = require('./_redis');

function getCookieToken(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }

  try {
    const token = getCookieToken(req.headers.cookie);
    if (token) {
      const sessions = await getSessions();
      if (sessions[token]) {
        delete sessions[token];
        await setSessions(sessions);
      }
    }
  } catch (err) {
    console.error('[logout] error:', err);
  }
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, data: { loggedOut: true } }));
};
