const { getSession } = require('./_auth');
const { getSubmissions, getUsers } = require('./_redis');

const OWNER_UID = 3;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const url = new URL(req.url, 'https://localhost');
    const problemId = String(url.searchParams.get('problemId') || '').trim();
    const requestedUid = url.searchParams.get('userId');

    const session = await getSession(req);
    const isAdmin = session && session.role === 'admin';
    const selfUid = session ? (session.userId || session.uid) : null;

    let targetUid = null;
    if (requestedUid != null && String(requestedUid).trim() !== '') {
      targetUid = requestedUid;
      // 登录用户可查看自己的；管理员可查看任何人的。
      if (!session) {
        return send(res, 401, { ok: false, error: '请先登录' });
      }
      if (!isAdmin && String(targetUid) !== String(selfUid)) {
        return send(res, 403, { ok: false, error: '无权查看' });
      }
    } else if (problemId) {
      // 题目详情页只返回当前登录用户的提交
      if (!session) return send(res, 200, { ok: true, data: [] });
      targetUid = selfUid;
    }

    const [all, users] = await Promise.all([getSubmissions(), getUsers()]);
    let list = all
      .filter(s => targetUid == null || s.userId === targetUid || String(s.userId) === String(targetUid))
      .filter(s => !problemId || String(s.problemId).toLowerCase() === problemId.toLowerCase())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(s => {
        // 公开列表不暴露答案；仅管理员或本人可查看答案
        let rest;
        if (targetUid == null && (!session || String(s.userId) !== String(selfUid)) && !isAdmin) {
          const { answer, ...r } = s;
          rest = r;
        } else {
          rest = { ...s };
        }
        const user = users.find(u => String(u.id) === String(s.userId));
        rest.role = user ? (user.role || 'user') : 'user';
        rest.adminBadgeText = user && user.role === 'admin' ? (user.adminBadgeText || '管理员') : '';
        rest.isOwner = user && (user.id === OWNER_UID || String(user.id) === String(OWNER_UID));
        return rest;
      });
    return send(res, 200, { ok: true, data: list });
  } catch (err) {
    console.error('[submissions] error:', err);
    return send(res, 500, { ok: false, error: 'Internal server error' });
  }
};
