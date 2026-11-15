const { getProblems, getContests, getAnnouncements, getBanner, getSponsors, getFeed, setFeed, getDiscussions, setDiscussions, getNotifications, setNotifications, getMessages, setMessages, getUserByUsername, getUsers, getSubmissions } = require('./_redis');
const { getSession, readBody } = require('./_auth');

const OWNER_UID = 3;

function normalizeDiscussion(item) {
  const replies = Array.isArray(item.replies) ? item.replies : [];
  return { ...item, replies, replyCount: replies.length };
}

function normalizeDiscussionSummary(item) {
  const replies = Array.isArray(item.replies) ? item.replies : [];
  const { content, replies: _, ...summary } = item;
  return { ...summary, replies: replies.length, replyCount: replies.length };
}

function enrichWithUserInfo(items, usernameField, users) {
  return items.map(item => {
    const username = item[usernameField];
    if (!username) return item;
    const user = users.find(u => u.username === username);
    if (!user) return item;
    return {
      ...item,
      [`${usernameField}Role`]: user.role || 'user',
      [`${usernameField}AdminBadgeText`]: user.role === 'admin' ? (user.adminBadgeText || '管理员') : '',
      [`${usernameField}IsOwner`]: user.id === OWNER_UID || String(user.id) === String(OWNER_UID)
    };
  });
}

function enrichDiscussion(item, users) {
  const enriched = { ...item };
  const authorUser = users.find(u => u.username === item.author);
  if (authorUser) {
    enriched.authorRole = authorUser.role || 'user';
    enriched.authorAdminBadgeText = authorUser.role === 'admin' ? (authorUser.adminBadgeText || '管理员') : '';
    enriched.authorIsOwner = authorUser.id === OWNER_UID || String(authorUser.id) === String(OWNER_UID);
  }
  if (Array.isArray(enriched.replies)) {
    enriched.replies = enriched.replies.map(r => {
      const u = users.find(x => x.username === r.author);
      if (!u) return r;
      return {
        ...r,
        authorRole: u.role || 'user',
        authorAdminBadgeText: u.role === 'admin' ? (u.adminBadgeText || '管理员') : '',
        authorIsOwner: u.id === OWNER_UID || String(u.id) === String(OWNER_UID)
      };
    });
  }
  return enriched;
}

function sortDiscussions(list) {
  return list.slice().sort((a, b) => {
    const aPinned = !!a.pinned;
    const bPinned = !!b.pinned;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) {
      const aTime = a.pinnedAt ? new Date(a.pinnedAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.pinnedAt ? new Date(b.pinnedAt).getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.end(JSON.stringify(payload));
}

function extractMentions(text) {
  const regex = /@([A-Za-z0-9_\-]+)/g;
  const names = new Set();
  let m;
  while ((m = regex.exec(text)) !== null) names.add(m[1]);
  return Array.from(names);
}

async function createMentionNotifications({ content, sourceUserId, sourceUsername, contextType, contextId, link }) {
  const names = extractMentions(content);
  if (!names.length) return;
  const [list, users] = await Promise.all([getNotifications(), getUsers()]);
  const sourceUser = users.find(u => String(u.id) === String(sourceUserId)) || {};
  const sourceRole = sourceUser.role || 'user';
  const sourceAdminBadgeText = sourceRole === 'admin' ? (sourceUser.adminBadgeText || '管理员') : '';
  const sourceIsOwner = sourceUser.id === 3 || String(sourceUser.id) === String(3);
  const baseId = list.length ? Math.max(...list.map(n => n.id || 0)) : 0;
  let nextId = baseId + 1;
  for (const name of names) {
    const user = users.find(u => u.username === name);
    if (!user || String(user.id) === String(sourceUserId)) continue;
    const existing = list.find(n =>
      String(n.targetUserId) === String(user.id) &&
      n.contextType === contextType &&
      String(n.contextId) === String(contextId) &&
      String(n.sourceUserId) === String(sourceUserId) &&
      !n.read
    );
    if (existing) continue;
    list.push({
      id: nextId++,
      type: 'mention',
      sourceUserId,
      sourceUsername,
      sourceRole,
      sourceAdminBadgeText,
      sourceIsOwner,
      targetUserId: user.id,
      targetUsername: user.username,
      contextType,
      contextId,
      link,
      content: content.slice(0, 200),
      read: false,
      createdAt: new Date().toISOString()
    });
  }
  await setNotifications(list);
}

function isAdminSession(session) {
  return !!session && session.role === 'admin';
}

async function isProblemVisible(p, session) {
  const visibility = p.visibility || 'public';
  if (visibility === 'public') return true;
  if (visibility === 'hidden') return false;
  if (visibility === 'contest') {
    if (!session) return false;
    const contestId = p.contestId;
    if (!contestId) return false;
    const contests = await getContests();
    const contest = contests.find(c => String(c.id).toLowerCase() === String(contestId).toLowerCase());
    if (!contest) return false;
    const participants = Array.isArray(contest.participants) ? contest.participants : [];
    const uid = session.userId || session.uid;
    return participants.some(pid => pid === uid || String(pid) === String(uid));
  }
  return true;
}

function sanitizeProblem(p, session) {
  const admin = isAdminSession(session);
  const visible = { ...p };
  if (!admin) delete visible.answer;
  return visible;
}

function computeProblemStats(problem, submissions) {
  const related = (submissions || []).filter(s => String(s.problemId).toLowerCase() === String(problem.id).toLowerCase());
  const total = related.length;
  const accepted = related.filter(s => String(s.status).toLowerCase() === 'accepted').length;
  return {
    ...problem,
    submissions: total,
    passRate: total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0
  };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://localhost');
  const type = url.searchParams.get('type');

  if (req.method === 'GET') {
    try {
      if (type === 'problems') {
        const [problems, submissions] = await Promise.all([getProblems(), getSubmissions()]);
        const session = await getSession(req);
        const pid = url.searchParams.get('id');
        if (pid) {
          const item = problems.find(p => String(p.id).toLowerCase() === String(pid).toLowerCase());
          if (!item) return send(res, 404, { ok: false, error: '题目不存在' });
          if (!isAdminSession(session) && !(await isProblemVisible(item, session))) {
            return send(res, 404, { ok: false, error: '题目不存在' });
          }
          return send(res, 200, { ok: true, data: sanitizeProblem(computeProblemStats(item, submissions), session) });
        }
        const visible = [];
        for (const p of problems) {
          if (isAdminSession(session) || (await isProblemVisible(p, session))) {
            visible.push(sanitizeProblem(computeProblemStats(p, submissions), session));
          }
        }
        return send(res, 200, { ok: true, data: visible });
      }

      if (type === 'announcements') {
        const announcements = await getAnnouncements();
        const sorted = announcements.slice().sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return String(b.date).localeCompare(String(a.date));
        });
        return send(res, 200, { ok: true, data: sorted });
      }

      if (type === 'banner') {
        const banner = await getBanner();
        return send(res, 200, { ok: true, data: banner });
      }

      if (type === 'sponsors') {
        const sponsors = await getSponsors();
        return send(res, 200, { ok: true, data: sponsors });
      }

      if (type === 'feed') {
        const [list, users] = await Promise.all([getFeed(), getUsers()]);
        const enriched = enrichWithUserInfo(list, 'username', users);
        return send(res, 200, { ok: true, data: enriched.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50) });
      }

      if (type === 'discussions') {
        const id = url.searchParams.get('id');
        const [list, users] = await Promise.all([getDiscussions(), getUsers()]);
        if (id) {
          const item = list.find(d => String(d.id) === String(id));
          if (!item) return send(res, 404, { ok: false, error: '讨论不存在' });
          return send(res, 200, { ok: true, data: enrichDiscussion(normalizeDiscussion(item), users) });
        }
        const summaries = sortDiscussions(list).map(normalizeDiscussionSummary);
        return send(res, 200, { ok: true, data: enrichWithUserInfo(summaries, 'author', users) });
      }

      if (type === 'notifications') {
        const session = await getSession(req);
        if (!session) return send(res, 401, { ok: false, error: '请先登录' });
        const uid = session.userId || session.uid;
        const list = await getNotifications();
        const mine = list.filter(n => String(n.targetUserId) === String(uid));
        const sorted = mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const unread = sorted.filter(n => !n.read).length;
        return send(res, 200, { ok: true, data: sorted, unread });
      }

      if (type === 'messages') {
        const session = await getSession(req);
        if (!session) return send(res, 401, { ok: false, error: '请先登录' });
        const uid = session.userId || session.uid;
        if (url.searchParams.get('contacts') === '1') {
          const list = await getMessages();
          const contacts = {};
          list.forEach(m => {
            const isSender = String(m.senderId) === String(uid);
            const isReceiver = String(m.receiverId) === String(uid);
            if (!isSender && !isReceiver) return;
            const otherId = isSender ? String(m.receiverId) : String(m.senderId);
            const otherName = isSender ? m.receiverUsername : m.senderUsername;
            if (!contacts[otherId]) contacts[otherId] = { userId: otherId, username: otherName, lastMessage: null, unread: 0 };
            const t = new Date(m.createdAt).getTime();
            if (!contacts[otherId].lastMessage || t > new Date(contacts[otherId].lastMessage.createdAt).getTime()) {
              contacts[otherId].lastMessage = m;
            }
            if (isReceiver && !m.read) contacts[otherId].unread += 1;
          });
          const result = Object.values(contacts).sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));
          return send(res, 200, { ok: true, data: result });
        }
        const otherName = url.searchParams.get('user');
        if (!otherName) return send(res, 400, { ok: false, error: '缺少 user 参数' });
        const other = await getUserByUsername(otherName);
        if (!other) return send(res, 404, { ok: false, error: '用户不存在' });
        const oid = other.id;
        const list = await getMessages();
        const conversation = list.filter(m =>
          (String(m.senderId) === String(uid) && String(m.receiverId) === String(oid)) ||
          (String(m.senderId) === String(oid) && String(m.receiverId) === String(uid))
        ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        let changed = false;
        list.forEach(m => {
          if (String(m.receiverId) === String(uid) && String(m.senderId) === String(oid) && !m.read) {
            m.read = true;
            changed = true;
          }
        });
        if (changed) await setMessages(list);
        return send(res, 200, {
          ok: true,
          data: conversation,
          user: {
            id: other.id,
            username: other.username,
            role: other.role || 'user',
            adminBadgeText: other.role === 'admin' ? (other.adminBadgeText || '管理员') : '',
            isOwner: other.id === 3 || String(other.id) === String(3)
          }
        });
      }

      return send(res, 400, { ok: false, error: 'Invalid data type' });
    } catch (err) {
      console.error('[data] error:', err);
      return send(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  if (req.method === 'POST') {
    const session = await getSession(req);
    if (!session) {
      return send(res, 401, { ok: false, error: '请先登录' });
    }

    try {
      const body = await readBody(req);

      if (type === 'feed') {
        const content = String(body.content || '').trim();
        if (!content) return send(res, 400, { ok: false, error: '内容不能为空' });
        if (content.length > 280) return send(res, 400, { ok: false, error: '内容不能超过 280 字' });
        const list = await getFeed();
        const newId = list.length ? Math.max(...list.map(x => x.id || 0)) + 1 : 1;
        const item = {
          id: newId,
          userId: session.userId || session.uid || session.id,
          username: session.username || '未知用户',
          content,
          createdAt: new Date().toISOString()
        };
        list.push(item);
        if (await setFeed(list)) {
          createMentionNotifications({
            content,
            sourceUserId: item.userId,
            sourceUsername: item.username,
            contextType: 'feed',
            contextId: item.id,
            link: '/'
          }).catch(err => console.error('[feed] mention error:', err));
          return send(res, 201, { ok: true, data: item });
        }
        return send(res, 500, { ok: false, error: '保存失败' });
      }

      if (type === 'discussions') {
        // reply to existing discussion
        if (body.discussionId != null) {
          const content = String(body.content || '').trim();
          if (!content) return send(res, 400, { ok: false, error: '回复内容不能为空' });
          if (content.length > 2000) return send(res, 400, { ok: false, error: '回复内容不能超过 2000 字' });
          const list = await getDiscussions();
          const item = list.find(d => String(d.id) === String(body.discussionId));
          if (!item) return send(res, 404, { ok: false, error: '讨论不存在' });
          if (!Array.isArray(item.replies)) item.replies = [];
          const replyId = item.replies.length ? Math.max(...item.replies.map(r => r.id || 0)) + 1 : 1;
          const reply = {
            id: replyId,
            authorId: session.userId || session.uid || session.id,
            author: session.username || '未知用户',
            content,
            createdAt: new Date().toISOString()
          };
          item.replies.push(reply);
          if (await setDiscussions(list)) {
            createMentionNotifications({
              content,
              sourceUserId: reply.authorId,
              sourceUsername: reply.author,
              contextType: 'discussion',
              contextId: item.id,
              link: '/discussion/' + item.id
            }).catch(err => console.error('[discussion reply] mention error:', err));
            return send(res, 201, { ok: true, data: reply });
          }
          return send(res, 500, { ok: false, error: '保存失败' });
        }

        // create new discussion
        const title = String(body.title || '').trim();
        const content = String(body.content || '').trim();
        const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',').map(t => t.trim()).filter(Boolean);
        if (!title) return send(res, 400, { ok: false, error: '标题不能为空' });
        if (title.length > 120) return send(res, 400, { ok: false, error: '标题不能超过 120 字' });
        if (!content) return send(res, 400, { ok: false, error: '正文不能为空' });
        const list = await getDiscussions();
        const newId = list.length ? Math.max(...list.map(x => x.id || 0)) + 1 : 1;
        const item = {
          id: newId,
          title,
          content,
          authorId: session.userId || session.uid || session.id,
          author: session.username || '未知用户',
          createdAt: new Date().toISOString(),
          tags: tags.slice(0, 5),
          replies: [],
          views: 0
        };
        list.push(item);
        if (await setDiscussions(list)) {
          createMentionNotifications({
            content,
            sourceUserId: item.authorId,
            sourceUsername: item.author,
            contextType: 'discussion',
            contextId: item.id,
            link: '/discussion/' + item.id
          }).catch(err => console.error('[discussion] mention error:', err));
          return send(res, 201, { ok: true, data: normalizeDiscussion(item) });
        }
        return send(res, 500, { ok: false, error: '保存失败' });
      }

      if (type === 'notifications') {
        const action = String(body.action || '');
        const list = await getNotifications();
        if (action === 'mark-read') {
          let changed = false;
          const uid = session.userId || session.uid;
          list.forEach(n => {
            if (String(n.targetUserId) !== String(uid)) return;
            if (body.id != null && String(n.id) !== String(body.id)) return;
            if (!n.read) { n.read = true; changed = true; }
          });
          if (changed) await setNotifications(list);
          return send(res, 200, { ok: true });
        }
        return send(res, 400, { ok: false, error: 'Invalid action' });
      }

      if (type === 'messages') {
        const toUsername = String(body.to || '').trim();
        const content = String(body.content || '').trim();
        if (!toUsername) return send(res, 400, { ok: false, error: '缺少接收者' });
        if (!content) return send(res, 400, { ok: false, error: '内容不能为空' });
        if (content.length > 2000) return send(res, 400, { ok: false, error: '内容不能超过 2000 字' });
        const receiver = await getUserByUsername(toUsername);
        if (!receiver) return send(res, 404, { ok: false, error: '接收者不存在' });
        const uid = session.userId || session.uid;
        if (String(receiver.id) === String(uid)) return send(res, 400, { ok: false, error: '不能给自己发送私信' });
        const list = await getMessages();
        const newId = list.length ? Math.max(...list.map(m => m.id || 0)) + 1 : 1;
        const message = {
          id: newId,
          senderId: uid,
          senderUsername: session.username || '未知用户',
          receiverId: receiver.id,
          receiverUsername: receiver.username,
          content,
          read: false,
          createdAt: new Date().toISOString()
        };
        list.push(message);
        if (await setMessages(list)) return send(res, 201, { ok: true, data: message });
        return send(res, 500, { ok: false, error: '保存失败' });
      }

      return send(res, 400, { ok: false, error: 'Invalid data type' });
    } catch (err) {
      console.error('[data] post error:', err);
      return send(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
