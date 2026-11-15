const { getSession, readBody } = require('./_auth');
const { getUsers, setUsers } = require('./_redis');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_BASE64_LENGTH = 500000; // ~375KB original image

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session) {
    return send(res, 401, { ok: false, error: '请先登录' });
  }

  try {
    const body = JSON.parse(await readBody(req) || '{}');
    const avatar = String(body.avatar || '').trim();

    if (!avatar) {
      return send(res, 400, { ok: false, error: '请选择图片' });
    }

    if (!avatar.startsWith('data:image/')) {
      return send(res, 400, { ok: false, error: '只能上传图片' });
    }

    if (avatar.length > MAX_BASE64_LENGTH) {
      return send(res, 400, { ok: false, error: '图片太大，请压缩到 300KB 以下' });
    }

    const mime = avatar.slice(5, avatar.indexOf(';'));
    if (!ALLOWED_TYPES.includes(mime)) {
      return send(res, 400, { ok: false, error: '仅支持 jpg/png/gif/webp' });
    }

    const users = await getUsers();
    const uid = session.uid || session.userId;
    const idx = users.findIndex(u => u.id === uid || String(u.id) === String(uid));
    if (idx === -1) return send(res, 404, { ok: false, error: '用户不存在' });

    users[idx].avatar = avatar;
    if (!await setUsers(users)) return send(res, 500, { ok: false, error: '保存失败' });

    const { salt, passwordHash, ...safeUser } = users[idx];
    return send(res, 200, { ok: true, data: safeUser });
  } catch (err) {
    console.error('[avatar] error:', err);
    return send(res, 500, { ok: false, error: 'Internal server error' });
  }
};
