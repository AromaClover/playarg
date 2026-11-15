const crypto = require('crypto');
const { getUserByUsername, getSessions, setSessions } = require('./_redis');

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

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

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { username, password, remember } = JSON.parse(body || '{}');
      const user = await getUserByUsername(username);
      if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ ok: false, error: 'Invalid username or password' }));
      }
      if (user.status === 'banned') {
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok: false, error: '账号已被封禁' }));
      }
      const token = crypto.randomBytes(32).toString('hex');
      const role = user.role || 'user';
      const sessions = await getSessions();
      const now = Date.now();
      // 记住密码：30 天过期；否则：会话级（关闭浏览器失效）
      const expiresAt = remember ? now + 30 * 24 * 60 * 60 * 1000 : null;
      sessions[token] = { userId: user.id, uid: user.id, username: user.username, email: user.email, role, createdAt: now, expiresAt: expiresAt };
      const saved = await setSessions(sessions);
      if (!saved) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'Failed to create session' }));
      }
      const cookieParts = [`session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
      if (remember) {
        cookieParts.push('Max-Age=' + (30 * 24 * 60 * 60)); // 30 天
      }
      res.setHeader('Set-Cookie', cookieParts.join('; '));
      res.statusCode = 200;
      res.end(JSON.stringify({
        ok: true,
        data: { id: user.id, uid: user.id, username: user.username, email: user.email, role }
      }));
    } catch (err) {
      console.error('[login] error:', err);
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
    }
  });
};
