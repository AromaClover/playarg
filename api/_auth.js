const { getSessions, getUserById } = require('./_redis');

function getCookieToken(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

async function getSession(req) {
  const token = getCookieToken(req.headers.cookie);
  if (!token) return null;
  const sessions = await getSessions();
  const session = sessions[token] || null;
  if (!session) return null;
  const user = await getUserById(session.userId || session.uid || session.id);
  if (!user || user.status === 'banned') {
    return null;
  }
  return session;
}

async function requireAdmin(req, res) {
  const session = await getSession(req);
  if (!session) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'Not authenticated' }));
    return null;
  }
  if (session.role !== 'admin') {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'Admin required' }));
    return null;
  }
  return session;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { getSession, requireAdmin, readBody };
