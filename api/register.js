const crypto = require('crypto');
const { getUsers, setUsers } = require('./_redis');

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
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
      const payload = JSON.parse(body || '{}');
      const { username, email, password } = payload;
      if (!username || !email || !password) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Missing required fields' }));
      }
      const users = await getUsers();
      if (users.find(u => u.username === username)) {
        res.statusCode = 409;
        return res.end(JSON.stringify({ ok: false, error: 'Username already exists' }));
      }
      if (users.find(u => u.email === email)) {
        res.statusCode = 409;
        return res.end(JSON.stringify({ ok: false, error: 'Email already exists' }));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      const adminSecret = (process.env.ADMIN_SECRET || '').trim();
      let role = 'user';
      if (adminSecret && payload.adminSecret === adminSecret) {
        role = 'admin';
      }
      // 使用当前最大 ID + 1，避免删除用户后 ID 重复
      const maxId = users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0);
      const newId = maxId + 1;
      const user = {
        id: newId,
        uid: newId,
        username,
        email,
        role,
        status: 'active',
        salt,
        passwordHash,
        joinedAt: new Date().toISOString(),
        stats: { solved: 0, contests: 0, submissions: 0, passRate: '0.0%' },
        tags: [],
        skills: [],
        achievements: [],
        recentSubmissions: [],
        recentContests: []
      };
      users.push(user);
      const saved = await setUsers(users);
      if (!saved) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'Failed to save user' }));
      }
      res.statusCode = 201;
      res.end(JSON.stringify({
        ok: true,
        data: { id: user.id, uid: user.id, username: user.username, email: user.email, role: user.role }
      }));
    } catch (err) {
      console.error('[register] error:', err);
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
    }
  });
};
