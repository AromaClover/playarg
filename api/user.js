const { getUsers, getSubmissions } = require('./_redis');

const OWNER_UID = 3;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function computeAchievements(solvedCount, totalSubmissions, acceptedCount) {
  const achievements = [];
  if (totalSubmissions > 0) {
    achievements.push({ name: '首次提交', icon: 'send' });
  }
  if (acceptedCount > 0) {
    achievements.push({ name: '首次通过', icon: 'check-circle' });
  }
  if (solvedCount >= 1) achievements.push({ name: '初出茅庐', icon: 'zap' });
  if (solvedCount >= 10) achievements.push({ name: '解题新手', icon: 'target' });
  if (solvedCount >= 50) achievements.push({ name: '解题达人', icon: 'award' });
  if (solvedCount >= 100) achievements.push({ name: '百题斩', icon: 'crown' });
  if (totalSubmissions >= 100) achievements.push({ name: '百次提交', icon: 'flame' });
  if (acceptedCount >= 50) achievements.push({ name: 'AC 大师', icon: 'star' });
  return achievements;
}

async function buildProfile(user) {
  const submissions = await getSubmissions();
  const userSubs = submissions
    .filter(s => s.userId === user.id || String(s.userId) === String(user.id))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const total = userSubs.length;
  const accepted = userSubs.filter(s => s.status === 'accepted').length;
  const solvedSet = {};
  userSubs.forEach(s => {
    if (s.status === 'accepted' && s.problemId) {
      solvedSet[s.problemId] = true;
    }
  });
  const solvedCount = Object.keys(solvedSet).length;
  const passRate = total ? ((accepted / total) * 100).toFixed(1) + '%' : '0.0%';

  const recentSubmissions = userSubs.slice(0, 10).map(s => ({
    time: formatDate(s.createdAt),
    problem: s.problemTitle || s.problemId || '',
    result: s.status === 'accepted' ? '通过' : (s.status === 'wrong' ? '答案错误' : String(s.status || '')),
    language: s.language || '-',
    duration: '-'
  }));

  const achievements = computeAchievements(solvedCount, total, accepted);

  const isOwner = user.id === OWNER_UID || user.id === String(OWNER_UID);
  const adminBadgeText = isOwner
    ? '站主'
    : (user.role === 'admin' ? (user.adminBadgeText || '管理员') : '');

  return {
    ...user,
    joinedAt: user.joinedAt || new Date().toISOString(),
    isOwner: isOwner,
    adminBadgeText,
    stats: {
      solved: solvedCount,
      contests: user.stats && user.stats.contests ? user.stats.contests : 0,
      submissions: total,
      passRate
    },
    tags: [],
    skills: [],
    achievements,
    recentSubmissions,
    recentContests: Array.isArray(user.recentContests) ? user.recentContests : []
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  let uid = req.query && req.query.uid;
  let search = req.query && req.query.search;
  if (!uid && !search && req.url) {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      uid = params.get('uid');
      search = params.get('search');
    } catch (e) {
      uid = null;
      search = null;
    }
  }

  try {
    const users = await getUsers();

    if (search != null) {
      const keyword = String(search).trim().toLowerCase();
      if (!keyword) return send(res, 200, { ok: true, data: [] });
      const result = users
        .filter(u => String(u.username).toLowerCase().includes(keyword))
        .map(u => ({
          id: u.id,
          username: u.username,
          role: u.role || 'user',
          adminBadgeText: u.role === 'admin' ? (u.adminBadgeText || '管理员') : '',
          isOwner: u.id === OWNER_UID || u.id === String(OWNER_UID)
        }))
        .slice(0, 20);
      return send(res, 200, { ok: true, data: result });
    }

    if (!uid) {
      return send(res, 400, { ok: false, error: 'Missing uid parameter' });
    }

    const uidNum = parseInt(uid, 10);
    if (isNaN(uidNum)) {
      return send(res, 400, { ok: false, error: 'Invalid uid' });
    }

    const user = users.find(u => u.id === uidNum || u.id === String(uidNum));
    if (!user) {
      return send(res, 404, { ok: false, error: 'User not found' });
    }

    const profile = await buildProfile(user);
    const { salt, passwordHash, ...safeProfile } = profile;

    send(res, 200, { ok: true, data: safeProfile });
  } catch (err) {
    console.error('[user] error:', err);
    send(res, 500, { ok: false, error: 'Internal server error' });
  }
};
