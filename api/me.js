const crypto = require('crypto');
const { getSessions, getSessionByToken, setSessions, getUsers, setUsers } = require('./_redis');

function getCookieToken(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  const token = getCookieToken(req.headers.cookie);
  const session = await getSessionByToken(token);
  if (!session) {
    return send(res, 401, { ok: false, error: 'Not authenticated' });
  }

  if (req.method === 'GET') {
    const role = session.role || (session.username === 'admin' ? 'admin' : 'user');
    const uid = session.uid || session.userId;
    const users = await getUsers();
    const user = users.find(u => String(u.id) === String(uid)) || {};
    const isOwner = uid === 3 || uid === '3' || user.id === 3 || String(user.id) === '3';
    const adminBadgeText = role === 'admin' ? (user.adminBadgeText || '管理员') : '';
    return send(res, 200, {
      ok: true,
      data: { id: uid, username: session.username, email: session.email, role, isOwner, adminBadgeText }
    });
  }

  if (req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const users = await getUsers();
      const uid = session.uid || session.userId;
      const idx = users.findIndex(u => u.id === uid || String(u.id) === String(uid));
      if (idx === -1) return send(res, 404, { ok: false, error: 'User not found' });

      const action = body.action || 'update';

      // 修改用户名
      if (action === 'change-username') {
        const username = String(body.username || '').trim();
        if (!username) return send(res, 400, { ok: false, error: '用户名不能为空' });
        if (username.length < 3 || username.length > 20) {
          return send(res, 400, { ok: false, error: '用户名长度需在 3-20 个字符之间' });
        }
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
          return send(res, 400, { ok: false, error: '用户名只能包含字母、数字、下划线和中文' });
        }
        if (users.some((u, i) => i !== idx && u.username === username)) {
          return send(res, 409, { ok: false, error: '用户名已被使用' });
        }
        users[idx].username = username;
        session.username = username;

        if (!await setUsers(users)) return send(res, 500, { ok: false, error: '保存失败' });
        const sessions = await getSessions();
        sessions[token] = session;
        if (!await setSessions(sessions)) return send(res, 500, { ok: false, error: 'Failed to update session' });

        const { salt, passwordHash, ...safeUser } = users[idx];
        return send(res, 200, { ok: true, data: safeUser });
      }

      // 修改密码（需要验证当前密码）
      if (action === 'change-password') {
        const currentPassword = String(body.currentPassword || '');
        const newPassword = String(body.newPassword || '');
        if (!currentPassword) return send(res, 400, { ok: false, error: '请输入当前密码' });
        if (!newPassword || newPassword.length < 6) {
          return send(res, 400, { ok: false, error: '新密码至少 6 位' });
        }
        // 验证当前密码
        const currentHash = hashPassword(currentPassword, users[idx].salt || '');
        if (currentHash !== users[idx].passwordHash) {
          return send(res, 401, { ok: false, error: '当前密码不正确' });
        }
        const salt = crypto.randomBytes(16).toString('hex');
        users[idx].salt = salt;
        users[idx].passwordHash = hashPassword(newPassword, salt);

        if (!await setUsers(users)) return send(res, 500, { ok: false, error: '保存失败' });
        return send(res, 200, { ok: true, message: '密码修改成功' });
      }

      // 默认：更新邮箱/密码（兼容旧接口，不需要当前密码验证）
      if (body.email) {
        const email = String(body.email).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return send(res, 400, { ok: false, error: 'Invalid email' });
        }
        if (users.some((u, i) => i !== idx && u.email === email)) {
          return send(res, 409, { ok: false, error: 'Email already in use' });
        }
        users[idx].email = email;
        session.email = email;
      }

      if (body.password) {
        const password = String(body.password);
        if (password.length < 6) return send(res, 400, { ok: false, error: 'Password too short' });
        const salt = crypto.randomBytes(16).toString('hex');
        users[idx].salt = salt;
        users[idx].passwordHash = hashPassword(password, salt);
      }

      if (!await setUsers(users)) return send(res, 500, { ok: false, error: 'Failed to save user' });
      const sessions = await getSessions();
      sessions[token] = session;
      if (!await setSessions(sessions)) return send(res, 500, { ok: false, error: 'Failed to update session' });

      const { salt, passwordHash, ...safeUser } = users[idx];
      return send(res, 200, { ok: true, data: safeUser });
    } catch (err) {
      console.error('[me] update error:', err);
      return send(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
