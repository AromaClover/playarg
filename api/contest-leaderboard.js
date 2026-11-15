const { getSession } = require('./_auth');
const { getContests, getSubmissions, getUsers } = require('./_redis');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function formatElapsed(ms) {
  if (!ms || ms < 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function buildIndividualLeaderboard(contest, submissions, users, problemList, contestStart, contestMode, contestEnd) {
  const problemIds = new Set(problemList);
  const userMap = {};

  submissions.forEach(s => {
    if (!problemIds.has(String(s.problemId))) return;
    if (contestMode) {
      const submitTime = new Date(s.createdAt);
      if (submitTime < contestStart || submitTime > contestEnd) return;
    }
    const uid = String(s.userId);
    if (!userMap[uid]) {
      userMap[uid] = {
        userId: uid,
        username: s.username || '未知用户',
        problems: {}
      };
    }
    if (!userMap[uid].problems[s.problemId]) {
      userMap[uid].problems[s.problemId] = [];
    }
    userMap[uid].problems[s.problemId].push(s);
  });

  // First blood per problem (individual)
  const firstBlood = {};
  Object.values(userMap).forEach(st => {
    Object.entries(st.problems).forEach(([pid, list]) => {
      const acList = list
        .filter(s => String(s.status).toLowerCase() === 'accepted')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      if (!acList.length) return;
      const elapsed = new Date(acList[0].createdAt) - contestStart;
      if (!(pid in firstBlood) || elapsed < firstBlood[pid].timeMs) {
        firstBlood[pid] = { userId: st.userId, timeMs: elapsed };
      }
    });
  });

  const rows = Object.values(userMap).map(st => {
    const user = users.find(u => String(u.id) === st.userId);
    let solved = 0;
    let totalPenaltyMs = 0;
    const problemStats = problemList.map(pid => {
      const list = (st.problems[pid] || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const firstAcIdx = list.findIndex(s => String(s.status).toLowerCase() === 'accepted');
      if (firstAcIdx !== -1) {
        solved += 1;
        const wrongAttempts = firstAcIdx;
        const acTime = new Date(list[firstAcIdx].createdAt);
        const elapsed = acTime - contestStart;
        totalPenaltyMs += elapsed + wrongAttempts * 20 * 60 * 1000;
        const isFirstBlood = firstBlood[pid] && String(firstBlood[pid].userId) === String(st.userId);
        return {
          problemId: pid,
          accepted: true,
          firstTry: wrongAttempts === 0,
          attempts: wrongAttempts,
          timeMs: elapsed,
          time: formatElapsed(elapsed),
          firstBlood: isFirstBlood
        };
      }
      const wrongAttempts = list.filter(s => String(s.status).toLowerCase() !== 'accepted').length;
      return {
        problemId: pid,
        accepted: false,
        firstTry: false,
        attempts: wrongAttempts,
        timeMs: null,
        time: ''
      };
    });

    return {
      userId: st.userId,
      username: st.username,
      role: user ? (user.role || 'user') : 'user',
      adminBadgeText: user && user.role === 'admin' ? (user.adminBadgeText || '管理员') : '',
      isOwner: user && (user.id === 3 || String(user.id) === String(3)),
      solved,
      totalPenaltyMs,
      totalTime: formatElapsed(totalPenaltyMs),
      problems: problemStats
    };
  });

  rows.sort((a, b) => {
    if (b.solved !== a.solved) return b.solved - a.solved;
    return a.totalPenaltyMs - b.totalPenaltyMs;
  });

  rows.forEach((r, idx) => { r.rank = idx + 1; });

  return { isTeam: false, rows };
}

function buildTeamLeaderboard(contest, submissions, users, problemList, contestStart, contestMode, contestEnd) {
  const problemIds = new Set(problemList);
  const teams = Array.isArray(contest.teams) ? contest.teams : [];

  // Build userId -> teamId map
  const userTeamMap = {};
  teams.forEach(t => {
    if (Array.isArray(t.members)) {
      t.members.forEach(mid => { userTeamMap[String(mid)] = String(t.id); });
    }
  });

  // Collect per-team, per-problem submissions
  const teamMap = {};
  teams.forEach(t => {
    teamMap[String(t.id)] = {
      teamId: String(t.id),
      teamName: t.name,
      leader: t.leader,
      memberIds: Array.isArray(t.members) ? t.members.map(String) : [],
      problems: {} // pid -> array of submissions from any team member
    };
  });

  submissions.forEach(s => {
    if (!problemIds.has(String(s.problemId))) return;
    if (contestMode) {
      const submitTime = new Date(s.createdAt);
      if (submitTime < contestStart || submitTime > contestEnd) return;
    }
    const uid = String(s.userId);
    const teamId = userTeamMap[uid];
    if (!teamId || !teamMap[teamId]) return;
    if (!teamMap[teamId].problems[s.problemId]) {
      teamMap[teamId].problems[s.problemId] = [];
    }
    teamMap[teamId].problems[s.problemId].push(s);
  });

  // First blood per problem (team-level)
  const firstBlood = {}; // pid -> { teamId, timeMs }
  Object.values(teamMap).forEach(t => {
    Object.entries(t.problems).forEach(([pid, list]) => {
      const acList = list
        .filter(s => String(s.status).toLowerCase() === 'accepted')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      if (!acList.length) return;
      const elapsed = new Date(acList[0].createdAt) - contestStart;
      if (!(pid in firstBlood) || elapsed < firstBlood[pid].timeMs) {
        firstBlood[pid] = { teamId: t.teamId, timeMs: elapsed, userId: acList[0].userId };
      }
    });
  });

  const userMap = {};
  users.forEach(u => { userMap[String(u.id)] = u; });

  const rows = Object.values(teamMap).map(t => {
    let solved = 0;
    let totalPenaltyMs = 0;
    const problemStats = problemList.map(pid => {
      const list = (t.problems[pid] || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const firstAcIdx = list.findIndex(s => String(s.status).toLowerCase() === 'accepted');
      if (firstAcIdx !== -1) {
        solved += 1;
        // Count wrong attempts across all team members before the first AC
        const wrongAttempts = firstAcIdx;
        const acTime = new Date(list[firstAcIdx].createdAt);
        const elapsed = acTime - contestStart;
        totalPenaltyMs += elapsed + wrongAttempts * 20 * 60 * 1000;
        const isFirstBlood = firstBlood[pid] && String(firstBlood[pid].teamId) === String(t.teamId);
        const solverUid = list[firstAcIdx].userId;
        return {
          problemId: pid,
          accepted: true,
          firstTry: wrongAttempts === 0,
          attempts: wrongAttempts,
          timeMs: elapsed,
          time: formatElapsed(elapsed),
          firstBlood: isFirstBlood,
          solverUid: solverUid,
          solverUsername: list[firstAcIdx].username || '未知用户'
        };
      }
      const wrongAttempts = list.filter(s => String(s.status).toLowerCase() !== 'accepted').length;
      return {
        problemId: pid,
        accepted: false,
        firstTry: false,
        attempts: wrongAttempts,
        timeMs: null,
        time: ''
      };
    });

    // Build member info
    const members = t.memberIds.map(mid => {
      const u = userMap[mid];
      return {
        userId: mid,
        username: u ? (u.username || '未知用户') : '未知用户',
        role: u ? (u.role || 'user') : 'user',
        isLeader: String(t.leader) === mid
      };
    });

    return {
      teamId: t.teamId,
      teamName: t.teamName,
      members,
      solved,
      totalPenaltyMs,
      totalTime: formatElapsed(totalPenaltyMs),
      problems: problemStats
    };
  });

  rows.sort((a, b) => {
    if (b.solved !== a.solved) return b.solved - a.solved;
    return a.totalPenaltyMs - b.totalPenaltyMs;
  });

  rows.forEach((r, idx) => { r.rank = idx + 1; });

  return { isTeam: true, rows };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const url = new URL(req.url, 'https://localhost');
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) return send(res, 400, { ok: false, error: '缺少比赛 ID' });

    const [contests, submissions, users] = await Promise.all([getContests(), getSubmissions(), getUsers()]);
    const contest = contests.find(c => String(c.id).toLowerCase() === id.toLowerCase());
    if (!contest) return send(res, 404, { ok: false, error: '比赛不存在' });

    const problemList = (contest.problems || []).map(String);
    const problemIds = new Set(problemList);
    const contestMode = contest.contestMode !== false;
    const contestStart = new Date(contest.startTime);
    const contestEnd = new Date(contest.endTime);
    const isTeam = contest.isTeamContest === true;

    if (!problemIds.size) {
      return send(res, 200, { ok: true, data: { contestId: id, isTeam, problemIds: [], rows: [] } });
    }

    let result;
    if (isTeam) {
      result = buildTeamLeaderboard(contest, submissions, users, problemList, contestStart, contestMode, contestEnd);
    } else {
      result = buildIndividualLeaderboard(contest, submissions, users, problemList, contestStart, contestMode, contestEnd);
    }

    return send(res, 200, {
      ok: true,
      data: {
        contestId: id,
        isTeam: result.isTeam,
        problemIds: problemList,
        rows: result.rows
      }
    });
  } catch (err) {
    console.error('[contest-leaderboard] error:', err);
    return send(res, 500, { ok: false, error: 'Internal server error' });
  }
};
