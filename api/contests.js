const { getSession, readBody } = require('./_auth');
const { getContests, setContests, getProblems, getSubmissions, getUsers } = require('./_redis');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function isAdmin(session) {
  return !!session && session.role === 'admin';
}

function computeStatus(contest) {
  const now = new Date();
  const start = new Date(contest.startTime);
  const end = new Date(contest.endTime);
  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'running';
}

function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function findUserTeam(contest, uid) {
  if (!Array.isArray(contest.teams)) return null;
  const suid = String(uid);
  return contest.teams.find(t => Array.isArray(t.members) && t.members.some(m => String(m) === suid)) || null;
}

function getTeamMemberUsers(team, users) {
  if (!team || !Array.isArray(team.members)) return [];
  return team.members.map(mid => {
    const u = users.find(uu => String(uu.id) === String(mid));
    return {
      userId: String(mid),
      username: u ? (u.username || '未知用户') : '未知用户',
      role: u ? (u.role || 'user') : 'user',
      isLeader: String(team.leader) === String(mid)
    };
  });
}

function sanitizeContest(c, session, users) {
  const admin = isAdmin(session);
  const obj = { ...c };
  if (!admin) {
    delete obj.participants;
    delete obj.teams;
  } else {
    obj.participantCount = Array.isArray(c.participants) ? c.participants.length : 0;
    obj.teamCount = Array.isArray(c.teams) ? c.teams.length : 0;
  }
  obj.status = computeStatus(c);
  obj.isTeamContest = c.isTeamContest === true;
  obj.teamSize = c.teamSize || 1;

  // Normalize organizer info
  if (c.organizerId) {
    const u = (users || []).find(uu => String(uu.id) === String(c.organizerId));
    obj.organizer = {
      id: c.organizerId,
      name: u ? (u.username || c.organizerName || '未知用户') : (c.organizerName || '未知用户'),
      role: u ? (u.role || c.organizerRole || 'user') : (c.organizerRole || 'user'),
      adminBadgeText: u && u.role === 'admin' ? (u.adminBadgeText || '管理员') : ''
    };
  } else if (c.organizer) {
    // Backward compat: old string organizer
    obj.organizer = {
      id: null,
      name: c.organizer,
      role: 'user',
      adminBadgeText: ''
    };
  } else {
    obj.organizer = { id: null, name: '未知', role: 'user', adminBadgeText: '' };
  }

  const uid = session ? (session.userId || session.uid) : null;
  if (uid) {
    if (obj.isTeamContest) {
      const team = findUserTeam(c, uid);
      if (team) {
        obj.myTeam = {
          id: team.id,
          name: team.name,
          leader: team.leader,
          inviteCode: team.inviteCode,
          members: getTeamMemberUsers(team, users || [])
        };
      } else {
        obj.myTeam = null;
      }
      obj.isRegistered = !!team;
    } else {
      obj.isRegistered = Array.isArray(c.participants) && c.participants.some(pid =>
        pid === uid || String(pid) === String(uid));
    }
  } else {
    obj.isRegistered = false;
  }
  return obj;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://localhost');
  const id = url.searchParams.get('id');

  if (req.method === 'GET') {
    const session = await getSession(req);
    try {
      const list = await getContests();
      const users = await getUsers();
      if (id) {
        const item = list.find(c => String(c.id).toLowerCase() === String(id).toLowerCase());
        if (!item) return send(res, 404, { ok: false, error: '比赛不存在' });
        const problems = await getProblems();
        const submissions = await getSubmissions();
        const contestStart = new Date(item.startTime);
        const contestEnd = new Date(item.endTime);
        const contestMode = item.contestMode !== false;
        const uid = session ? (session.userId || session.uid) : null;
        const acceptedProblemIds = uid ? submissions
          .filter(s => {
            if (String(s.userId) !== String(uid)) return false;
            if (String(s.status).toLowerCase() !== 'accepted') return false;
            if (!contestMode) return true;
            const t = new Date(s.createdAt);
            return t >= contestStart && t <= contestEnd;
          })
          .map(s => String(s.problemId)) : [];
        const problemItems = (item.problems || []).map(pid => problems.find(p => String(p.id).toLowerCase() === String(pid).toLowerCase())).filter(Boolean);
        const visibleProblems = isAdmin(session) ? problemItems : problemItems.filter(p => (p.visibility || 'public') !== 'hidden');
        return send(res, 200, { ok: true, data: { ...sanitizeContest(item, session, users), acceptedProblemIds, problemList: visibleProblems.map(p => ({ id: p.id, title: p.title, difficulty: p.difficulty })) } });
      }
      return send(res, 200, { ok: true, data: list.map(c => sanitizeContest(c, session, users)).sort((a, b) => new Date(b.startTime) - new Date(a.startTime)) });
    } catch (err) {
      console.error('[contests] get error:', err);
      return send(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  const session = await getSession(req);
  if (!session) return send(res, 401, { ok: false, error: '请先登录' });
  const uid = session.userId || session.uid;

  // ---- Team actions ----
  if (req.method === 'POST' && id) {
    const body = await readBody(req);
    const action = body && body.action;

    if (action && action.startsWith('team-')) {
      try {
        const list = await getContests();
        const idx = list.findIndex(c => String(c.id).toLowerCase() === String(id).toLowerCase());
        if (idx === -1) return send(res, 404, { ok: false, error: '比赛不存在' });
        const contest = list[idx];
        const status = computeStatus(contest);
        if (!contest.isTeamContest) return send(res, 400, { ok: false, error: '该比赛为个人赛' });
        if (status === 'ended') return send(res, 400, { ok: false, error: '比赛已结束' });

        if (!Array.isArray(contest.teams)) contest.teams = [];
        const teamSize = contest.teamSize || 4;
        const users = await getUsers();

        if (action === 'team-create') {
          const teamName = String(body.name || '').trim();
          if (!teamName) return send(res, 400, { ok: false, error: '队伍名称必填' });
          if (findUserTeam(contest, uid)) return send(res, 400, { ok: false, error: '你已经在队伍中了' });

          const existingIds = contest.teams.map(t => Number(t.id)).filter(n => Number.isInteger(n) && n > 0);
          const nextId = existingIds.length ? Math.max(...existingIds) + 1 : 1;
          let inviteCode;
          do { inviteCode = genInviteCode(); } while (contest.teams.some(t => t.inviteCode === inviteCode));

          const newTeam = {
            id: String(nextId),
            name: teamName,
            leader: uid,
            members: [uid],
            inviteCode,
            createdAt: new Date().toISOString()
          };
          contest.teams.push(newTeam);
          if (await setContests(list)) {
            return send(res, 200, { ok: true, data: { ...newTeam, members: getTeamMemberUsers(newTeam, users) } });
          }
          return send(res, 500, { ok: false, error: '保存失败' });
        }

        if (action === 'team-join') {
          const code = String(body.code || '').trim().toUpperCase();
          if (!code) return send(res, 400, { ok: false, error: '邀请码必填' });
          if (findUserTeam(contest, uid)) return send(res, 400, { ok: false, error: '你已经在队伍中了' });
          const team = contest.teams.find(t => t.inviteCode === code);
          if (!team) return send(res, 404, { ok: false, error: '邀请码无效' });
          if (!Array.isArray(team.members)) team.members = [];
          if (team.members.length >= teamSize) return send(res, 400, { ok: false, error: '队伍人数已满' });
          team.members.push(uid);
          if (await setContests(list)) {
            return send(res, 200, { ok: true, data: { ...team, members: getTeamMemberUsers(team, users) } });
          }
          return send(res, 500, { ok: false, error: '保存失败' });
        }

        if (action === 'team-leave') {
          const team = findUserTeam(contest, uid);
          if (!team) return send(res, 400, { ok: false, error: '你不在任何队伍中' });
          if (String(team.leader) === String(uid)) {
            if (team.members.length > 1) return send(res, 400, { ok: false, error: '队长请先转让队长或解散队伍' });
            // last member leaves -> delete team
            contest.teams = contest.teams.filter(t => String(t.id) !== String(team.id));
          } else {
            team.members = team.members.filter(m => String(m) !== String(uid));
          }
          if (await setContests(list)) return send(res, 200, { ok: true });
          return send(res, 500, { ok: false, error: '保存失败' });
        }

        if (action === 'team-kick') {
          const team = findUserTeam(contest, uid);
          if (!team) return send(res, 400, { ok: false, error: '你不在任何队伍中' });
          if (String(team.leader) !== String(uid)) return send(res, 403, { ok: false, error: '只有队长可以踢人' });
          const targetUid = String(body.userId || '');
          if (!targetUid) return send(res, 400, { ok: false, error: '缺少用户 ID' });
          if (targetUid === String(uid)) return send(res, 400, { ok: false, error: '不能踢自己' });
          if (!team.members.some(m => String(m) === targetUid)) return send(res, 400, { ok: false, error: '该用户不在队伍中' });
          team.members = team.members.filter(m => String(m) !== targetUid);
          if (await setContests(list)) {
            return send(res, 200, { ok: true, data: { ...team, members: getTeamMemberUsers(team, users) } });
          }
          return send(res, 500, { ok: false, error: '保存失败' });
        }

        if (action === 'team-transfer') {
          const team = findUserTeam(contest, uid);
          if (!team) return send(res, 400, { ok: false, error: '你不在任何队伍中' });
          if (String(team.leader) !== String(uid)) return send(res, 403, { ok: false, error: '只有队长可以转让' });
          const targetUid = String(body.userId || '');
          if (!targetUid) return send(res, 400, { ok: false, error: '缺少用户 ID' });
          if (!team.members.some(m => String(m) === targetUid)) return send(res, 400, { ok: false, error: '该用户不在队伍中' });
          if (targetUid === String(uid)) return send(res, 400, { ok: false, error: '不能转让给自己' });
          team.leader = targetUid;
          if (await setContests(list)) {
            return send(res, 200, { ok: true, data: { ...team, members: getTeamMemberUsers(team, users) } });
          }
          return send(res, 500, { ok: false, error: '保存失败' });
        }

        return send(res, 400, { ok: false, error: 'Invalid team action' });
      } catch (err) {
        console.error('[contests] team error:', err);
        return send(res, 500, { ok: false, error: 'Internal server error' });
      }
    }

    // Individual register
    try {
      const list = await getContests();
      const idx = list.findIndex(c => String(c.id).toLowerCase() === String(id).toLowerCase());
      if (idx === -1) return send(res, 404, { ok: false, error: '比赛不存在' });
      const contest = list[idx];
      const status = computeStatus(contest);
      if (status === 'ended') return send(res, 400, { ok: false, error: '比赛已结束' });
      if (contest.isTeamContest) return send(res, 400, { ok: false, error: '组队赛请创建或加入队伍' });
      if (!Array.isArray(contest.participants)) contest.participants = [];
      if (contest.participants.some(pid => pid === uid || String(pid) === String(uid))) {
        return send(res, 200, { ok: true, data: { registered: true } });
      }
      contest.participants.push(uid);
      if (await setContests(list)) return send(res, 200, { ok: true, data: { registered: true } });
      return send(res, 500, { ok: false, error: '保存失败' });
    } catch (err) {
      console.error('[contests] register error:', err);
      return send(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  // ---- Create/update/delete contest ----
  // - create: any logged-in user
  // - update/delete: admin or contest organizer
  if (req.method === 'POST' && !id && uid) {
    try {
      const body = await readBody(req);
      const action = body.action;
      let list = await getContests();
      const admin = isAdmin(session);

      if (action === 'create') {
        const item = body.item || {};
        if (!item.title || !String(item.title).trim()) return send(res, 400, { ok: false, error: '比赛标题必填' });
        if (!item.startTime || !item.endTime) return send(res, 400, { ok: false, error: '开始和结束时间必填' });

        const isTeam = item.isTeamContest === true || item.isTeamContest === 'true';
        const tSize = Math.max(2, Math.min(10, parseInt(item.teamSize, 10) || 4));

        const numericIds = list.map(c => Number(c.id)).filter(n => Number.isInteger(n) && n > 0);
        const nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
        const cid = String(nextId);
        const newItem = {
          id: cid,
          title: String(item.title).trim(),
          description: String(item.description || '').trim(),
          startTime: item.startTime,
          endTime: item.endTime,
          organizerId: String(uid),
          organizerName: session.username || '未知用户',
          organizerRole: session.role || 'user',
          mode: String(item.mode || 'checkpoint').trim(),
          contestMode: item.contestMode !== false,
          isTeamContest: isTeam,
          teamSize: isTeam ? tSize : 1,
          problems: Array.isArray(item.problems) ? item.problems.map(String) : [],
          participants: [],
          teams: [],
          createdAt: new Date().toISOString()
        };
        list.push(newItem);
        if (await setContests(list)) return send(res, 201, { ok: true, data: newItem });
        return send(res, 500, { ok: false, error: '保存失败' });
      }

      if (action === 'update') {
        const item = body.item || {};
        const cid = String(item.id || '').trim();
        if (!cid) return send(res, 400, { ok: false, error: '比赛 ID 必填' });
        if (!item.title || !String(item.title).trim()) return send(res, 400, { ok: false, error: '比赛标题必填' });
        if (!item.startTime || !item.endTime) return send(res, 400, { ok: false, error: '开始和结束时间必填' });

        const idx = list.findIndex(c => String(c.id).toLowerCase() === cid.toLowerCase());
        if (idx === -1) return send(res, 404, { ok: false, error: '比赛不存在' });

        const isOrganizer = list[idx].organizerId && String(list[idx].organizerId) === String(uid);
        if (!admin && !isOrganizer) return send(res, 403, { ok: false, error: '无权限编辑此比赛' });

        const isTeam = item.isTeamContest === true || item.isTeamContest === 'true';
        const tSize = Math.max(2, Math.min(10, parseInt(item.teamSize, 10) || 4));

        list[idx] = {
          ...list[idx],
          title: String(item.title).trim(),
          description: String(item.description || '').trim(),
          startTime: item.startTime,
          endTime: item.endTime,
          mode: String(item.mode || list[idx].mode || 'checkpoint').trim(),
          contestMode: item.contestMode !== undefined ? item.contestMode !== false : (list[idx].contestMode !== false),
          isTeamContest: item.isTeamContest !== undefined ? isTeam : list[idx].isTeamContest,
          teamSize: item.isTeamContest !== undefined ? (isTeam ? tSize : 1) : (list[idx].teamSize || 1),
          problems: Array.isArray(item.problems) ? item.problems.map(String) : (list[idx].problems || [])
        };
        if (await setContests(list)) return send(res, 200, { ok: true, data: list[idx] });
        return send(res, 500, { ok: false, error: '保存失败' });
      }

      if (action === 'delete') {
        const cid = String(body.id || '').trim();
        if (!cid) return send(res, 400, { ok: false, error: '比赛 ID 必填' });
        const target = list.find(c => String(c.id).toLowerCase() === cid.toLowerCase());
        if (!target) return send(res, 404, { ok: false, error: '比赛不存在' });

        const isOrganizer = target.organizerId && String(target.organizerId) === String(uid);
        if (!admin && !isOrganizer) return send(res, 403, { ok: false, error: '无权限删除此比赛' });

        const next = list.filter(c => String(c.id).toLowerCase() !== cid.toLowerCase());
        if (await setContests(next)) return send(res, 200, { ok: true });
        return send(res, 500, { ok: false, error: '删除失败' });
      }

      return send(res, 400, { ok: false, error: 'Invalid action' });
    } catch (err) {
      console.error('[contests] crud error:', err);
      return send(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
