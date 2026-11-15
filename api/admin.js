const { requireAdmin, readBody } = require('./_auth');
const {
  getUsers, setUsers, getSessions, setSessions, getUserById,
  getAnnouncements, setAnnouncements,
  getProblems, setProblems,
  getContests, setContests,
  getBanner, setBanner,
  getSponsors, setSponsors,
  getFeed, setFeed,
  getDiscussions, setDiscussions,
  getSubmissions, setSubmissions,
  getNotifications, setNotifications,
  getMessages, setMessages,
} = require('./_redis');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function parsePath(req) {
  const url = new URL(req.url, 'https://localhost');
  return url.searchParams.get('path') || '';
}

const OWNER_UID = 3;

function readAnnouncementsBody(body) {
  const action = body.action;
  let list = [];
  return { action, item: body.item, id: body.id, list };
}

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const path = parsePath(req);

  try {
    const body = await readBody(req);

    // ---- delete-user ----
    if (path === 'delete-user') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const uid = Number(body.uid);
      if (!uid || isNaN(uid)) return send(res, 400, { ok: false, error: 'Missing or invalid uid' });
      if (uid === OWNER_UID) return send(res, 403, { ok: false, error: 'Cannot delete site owner' });
      const users = await getUsers();
      const index = users.findIndex(u => u.id === uid);
      if (index === -1) return send(res, 404, { ok: false, error: 'User not found' });
      users.splice(index, 1);
      if (!await setUsers(users)) return send(res, 500, { ok: false, error: 'Failed to update users' });
      const sessions = await getSessions();
      let changed = false;
      Object.keys(sessions).forEach(key => {
        if (sessions[key].userId === uid || sessions[key].uid === uid) {
          delete sessions[key];
          changed = true;
        }
      });
      if (changed) await setSessions(sessions);
      return send(res, 200, { ok: true, data: { deleted: uid } });
    }

    // ---- set-role ----
    if (path === 'set-role') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const uid = Number(body.uid);
      const role = String(body.role || '').trim();
      if (!uid || isNaN(uid)) return send(res, 400, { ok: false, error: 'Missing or invalid uid' });
      if (!['admin', 'user'].includes(role)) return send(res, 400, { ok: false, error: 'Role must be admin or user' });
      if (uid === OWNER_UID && role === 'user') return send(res, 403, { ok: false, error: 'Cannot demote site owner' });
      const users = await getUsers();
      const idx = users.findIndex(u => u.id === uid);
      if (idx === -1) return send(res, 404, { ok: false, error: 'User not found' });
      users[idx].role = role;
      if (await setUsers(users)) return send(res, 200, { ok: true, data: { id: uid, role } });
      return send(res, 500, { ok: false, error: 'Failed to save' });
    }

    // ---- set-admin-badge ----
    if (path === 'set-admin-badge') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const selfUid = admin.userId || admin.uid;
      if (selfUid !== OWNER_UID) return send(res, 403, { ok: false, error: 'Only site owner can set admin badge' });
      const uid = Number(body.uid);
      const text = String(body.text || '').trim();
      if (!uid || isNaN(uid)) return send(res, 400, { ok: false, error: 'Missing or invalid uid' });
      if (text.length > 20) return send(res, 400, { ok: false, error: 'Badge text too long (max 20)' });
      const users = await getUsers();
      const idx = users.findIndex(u => u.id === uid);
      if (idx === -1) return send(res, 404, { ok: false, error: 'User not found' });
      if (users[idx].role !== 'admin') return send(res, 400, { ok: false, error: 'Target user is not admin' });
      users[idx].adminBadgeText = text || undefined;
      if (await setUsers(users)) return send(res, 200, { ok: true, data: { id: uid, adminBadgeText: text } });
      return send(res, 500, { ok: false, error: 'Failed to save' });
    }

    // ---- banner ----
    if (path === 'banner') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const banner = {
        enabled: !!body.enabled,
        imageUrl: String(body.imageUrl || '').trim(),
        linkUrl: String(body.linkUrl || '').trim(),
        altText: String(body.altText || '').trim()
      };
      if (banner.enabled && !banner.imageUrl) return send(res, 400, { ok: false, error: 'Banner image URL required when enabled' });
      if (await setBanner(banner)) return send(res, 200, { ok: true, data: banner });
      return send(res, 500, { ok: false, error: 'Failed to save' });
    }

    // ---- sponsors ----
    if (path === 'sponsors') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const sponsors = (Array.isArray(body.sponsors) ? body.sponsors : []).map(s => ({
        name: String(s.name || '').trim(),
        url: String(s.url || '').trim(),
        level: String(s.level || '').trim()
      })).filter(s => s.name);
      if (await setSponsors(sponsors)) return send(res, 200, { ok: true, data: sponsors });
      return send(res, 500, { ok: false, error: 'Failed to save' });
    }

    // ---- announcements ----
    if (path === 'announcements') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const action = body.action;
      let list = await getAnnouncements();

      if (action === 'create' || action === 'update') {
        const item = body.item || {};
        if (!item.title || !item.title.trim()) return send(res, 400, { ok: false, error: 'Title required' });
        if (!item.date || !item.date.trim()) return send(res, 400, { ok: false, error: 'Date required' });
        if (!item.category || !item.category.trim()) return send(res, 400, { ok: false, error: 'Category required' });

        if (action === 'create') {
          const newId = list.length ? Math.max(...list.map(a => a.id || 0)) + 1 : 1;
          const newItem = {
            id: newId,
            title: item.title.trim(),
            date: item.date.trim(),
            category: item.category.trim(),
            pinned: !!item.pinned,
            content: (item.content || '').trim(),
            fullContent: (item.fullContent || '').trim()
          };
          list.push(newItem);
          if (await setAnnouncements(list)) return send(res, 201, { ok: true, data: newItem });
          return send(res, 500, { ok: false, error: 'Failed to save' });
        }

        if (!item.id) return send(res, 400, { ok: false, error: 'Announcement ID required' });
        const idx = list.findIndex(a => a.id === item.id);
        if (idx === -1) return send(res, 404, { ok: false, error: 'Announcement not found' });
        list[idx] = {
          ...list[idx],
          title: item.title.trim(),
          date: item.date.trim(),
          category: item.category.trim(),
          pinned: !!item.pinned,
          content: (item.content || '').trim(),
          fullContent: (item.fullContent || '').trim()
        };
        if (await setAnnouncements(list)) return send(res, 200, { ok: true, data: list[idx] });
        return send(res, 500, { ok: false, error: 'Failed to save' });
      }

      if (action === 'delete') {
        const id = body.id;
        if (!id) return send(res, 400, { ok: false, error: 'Announcement ID required' });
        list = list.filter(a => a.id !== id);
        if (await setAnnouncements(list)) return send(res, 200, { ok: true });
        return send(res, 500, { ok: false, error: 'Failed to delete' });
      }

      return send(res, 400, { ok: false, error: 'Invalid action' });
    }

    // ---- problems ----
    if (path === 'problems') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const action = body.action;
      let list = await getProblems();

      if (action === 'create' || action === 'update') {
        const item = body.item || {};
        if (!item.id || !String(item.id).trim()) return send(res, 400, { ok: false, error: 'Problem ID required' });
        if (!item.title || !item.title.trim()) return send(res, 400, { ok: false, error: 'Title required' });
        if (!item.difficulty || !item.difficulty.trim()) return send(res, 400, { ok: false, error: 'Difficulty required' });
        const id = String(item.id).trim();

        function normalizeSamples(raw) {
          if (Array.isArray(raw)) {
            return raw.map(s => ({ input: String(s.input || '').trim(), output: String(s.output || '').trim() })).filter(s => s.input || s.output);
          }
          const text = String(raw || '').trim();
          if (!text) return [];
          return text.split(/\n?=\s*=\s*=\s*\n?/).map(group => {
            const parts = group.split(/\n?-\s*-\s*-\s*\n?/);
            return { input: String(parts[0] || '').trim(), output: String(parts[1] || '').trim() };
          }).filter(s => s.input || s.output);
        }
        function normalizeAttachments(raw) {
          if (!Array.isArray(raw)) return [];
          return raw.map(a => ({
            name: String(a.name || '').trim() || '附件',
            url: String(a.url || '').trim()
          })).filter(a => a.url);
        }

      if (action === 'create') {
          if (list.some(p => String(p.id).toLowerCase() === id.toLowerCase())) {
            return send(res, 409, { ok: false, error: 'Problem ID already exists' });
          }
          const visibility = ['public', 'contest', 'hidden'].includes(String(item.visibility || '').trim()) ? String(item.visibility || '').trim() : 'public';
          const newItem = {
            id,
            title: item.title.trim(),
            difficulty: item.difficulty.trim(),
            tags: Array.isArray(item.tags) ? item.tags : [],
            description: String(item.description || '').trim(),
            inputFormat: String(item.inputFormat || item.input_format || '').trim(),
            outputFormat: String(item.outputFormat || item.output_format || '').trim(),
            samples: normalizeSamples(item.samples),
            constraints: String(item.constraints || '').trim(),
            timeLimit: String(item.timeLimit || item.time_limit || '1 s').trim() || '1 s',
            memoryLimit: String(item.memoryLimit || item.memory_limit || '128 MB').trim() || '128 MB',
            source: String(item.source || '').trim(),
            answer: String(item.answer || '').trim(),
            visibility,
            contestId: String(item.contestId || '').trim(),
            attachments: normalizeAttachments(item.attachments)
          };
          list.push(newItem);
          if (await setProblems(list)) return send(res, 201, { ok: true, data: newItem });
          return send(res, 500, { ok: false, error: 'Failed to save' });
        }

        const idx = list.findIndex(p => String(p.id).toLowerCase() === id.toLowerCase());
        if (idx === -1) return send(res, 404, { ok: false, error: 'Problem not found' });
        const visibilityUpdate = ['public', 'contest', 'hidden'].includes(String(item.visibility || '').trim()) ? String(item.visibility || '').trim() : (list[idx].visibility || 'public');
        list[idx] = {
          ...list[idx],
          title: item.title.trim(),
          difficulty: item.difficulty.trim(),
          tags: Array.isArray(item.tags) ? item.tags : [],
          description: String(item.description || '').trim(),
          inputFormat: String(item.inputFormat || item.input_format || '').trim(),
          outputFormat: String(item.outputFormat || item.output_format || '').trim(),
          samples: normalizeSamples(item.samples),
          constraints: String(item.constraints || '').trim(),
          timeLimit: String(item.timeLimit || item.time_limit || '1 s').trim() || '1 s',
          memoryLimit: String(item.memoryLimit || item.memory_limit || '128 MB').trim() || '128 MB',
          source: String(item.source || '').trim(),
          answer: String(item.answer || '').trim(),
          visibility: visibilityUpdate,
          contestId: String(item.contestId || '').trim(),
          attachments: normalizeAttachments(item.attachments)
        };
        if (await setProblems(list)) return send(res, 200, { ok: true, data: list[idx] });
        return send(res, 500, { ok: false, error: 'Failed to save' });
      }

      if (action === 'delete') {
        const id = body.id;
        if (!id) return send(res, 400, { ok: false, error: 'Problem ID required' });
        list = list.filter(p => String(p.id).toLowerCase() !== String(id).toLowerCase());
        if (await setProblems(list)) return send(res, 200, { ok: true });
        return send(res, 500, { ok: false, error: 'Failed to delete' });
      }

      return send(res, 400, { ok: false, error: 'Invalid action' });
    }

    // ---- contests ----
    if (path === 'contests') {
      let list = await getContests();

      if (req.method === 'GET') {
        return send(res, 200, { ok: true, data: list.filter(c => c.status === 'pending') });
      }

      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const action = body.action;
      const id = body.id;
      if (!id) return send(res, 400, { ok: false, error: 'Contest ID required' });
      const idx = list.findIndex(c => c.id === id);
      if (idx === -1) return send(res, 404, { ok: false, error: 'Contest not found' });
      if (action === 'approve') list[idx].status = 'approved';
      else if (action === 'reject') list[idx].status = 'rejected';
      else return send(res, 400, { ok: false, error: 'Invalid action' });
      if (await setContests(list)) return send(res, 200, { ok: true, data: list[idx] });
      return send(res, 500, { ok: false, error: 'Failed to save' });
    }

    // ---- set-status (ban/unban) ----
    if (path === 'set-status') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const uid = Number(body.uid);
      const status = String(body.status || '').trim();
      if (!uid || isNaN(uid)) return send(res, 400, { ok: false, error: 'Missing or invalid uid' });
      if (!['active', 'banned'].includes(status)) return send(res, 400, { ok: false, error: 'Status must be active or banned' });
      if (uid === OWNER_UID && status === 'banned') return send(res, 403, { ok: false, error: 'Cannot ban site owner' });
      const users = await getUsers();
      const idx = users.findIndex(u => u.id === uid);
      if (idx === -1) return send(res, 404, { ok: false, error: 'User not found' });
      users[idx].status = status;
      if (!await setUsers(users)) return send(res, 500, { ok: false, error: 'Failed to save' });
      if (status === 'banned') {
        const sessions = await getSessions();
        let changed = false;
        Object.keys(sessions).forEach(key => {
          if (sessions[key].userId === uid || sessions[key].uid === uid) {
            delete sessions[key];
            changed = true;
          }
        });
        if (changed) await setSessions(sessions);
      }
      return send(res, 200, { ok: true, data: { id: uid, status } });
    }

    // ---- users list ----
    if (path === 'users') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const action = body.action;
      if (action === 'list') {
        const users = await getUsers();
        const data = users.map(u => {
          const { salt, passwordHash, ...safe } = u;
          return safe;
        });
        return send(res, 200, { ok: true, data });
      }
      return send(res, 400, { ok: false, error: 'Invalid action' });
    }

    // ---- batch-delete-problems ----
    if (path === 'batch-delete-problems') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) return send(res, 400, { ok: false, error: 'No problem IDs provided' });
      let list = await getProblems();
      const before = list.length;
      list = list.filter(p => !ids.some(id => String(id).toLowerCase() === String(p.id).toLowerCase()));
      if (list.length === before) return send(res, 404, { ok: false, error: 'No matching problems found' });
      if (await setProblems(list)) return send(res, 200, { ok: true, data: { deleted: before - list.length } });
      return send(res, 500, { ok: false, error: 'Failed to delete problems' });
    }

    // ---- batch-set-status ----
    if (path === 'batch-set-status') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const uids = Array.isArray(body.uids) ? body.uids.map(Number).filter(Boolean) : [];
      const status = String(body.status || '').trim();
      if (!uids.length) return send(res, 400, { ok: false, error: 'No user IDs provided' });
      if (!['active', 'banned'].includes(status)) return send(res, 400, { ok: false, error: 'Status must be active or banned' });
      const users = await getUsers();
      let changed = false;
      const sessions = await getSessions();
      let sessionsChanged = false;
      uids.forEach(uid => {
        if (status === 'banned' && uid === OWNER_UID) return;
        const idx = users.findIndex(u => u.id === uid);
        if (idx === -1) return;
        users[idx].status = status;
        changed = true;
        if (status === 'banned') {
          Object.keys(sessions).forEach(key => {
            if (sessions[key].userId === uid || sessions[key].uid === uid) {
              delete sessions[key];
              sessionsChanged = true;
            }
          });
        }
      });
      if (!changed) return send(res, 404, { ok: false, error: 'No matching users found' });
      if (!await setUsers(users)) return send(res, 500, { ok: false, error: 'Failed to save users' });
      if (sessionsChanged) await setSessions(sessions);
      return send(res, 200, { ok: true, data: { count: uids.length, status } });
    }

    // ---- batch-set-role ----
    if (path === 'batch-set-role') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const uids = Array.isArray(body.uids) ? body.uids.map(Number).filter(Boolean) : [];
      const role = String(body.role || '').trim();
      if (!uids.length) return send(res, 400, { ok: false, error: 'No user IDs provided' });
      if (!['admin', 'user'].includes(role)) return send(res, 400, { ok: false, error: 'Role must be admin or user' });
      const users = await getUsers();
      let changed = false;
      uids.forEach(uid => {
        if (uid === OWNER_UID && role === 'user') return;
        const idx = users.findIndex(u => u.id === uid);
        if (idx === -1) return;
        users[idx].role = role;
        changed = true;
      });
      if (!changed) return send(res, 404, { ok: false, error: 'No matching users found' });
      if (await setUsers(users)) return send(res, 200, { ok: true, data: { count: uids.length, role } });
      return send(res, 500, { ok: false, error: 'Failed to save users' });
    }

    // ---- discussions moderation ----
    if (path === 'discussions') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const action = body.action;
      let list = await getDiscussions();

      if (action === 'list') {
        const users = await getUsers();
        const data = list.slice().sort((a, b) => {
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
        }).map(d => {
          const u = users.find(x => x.username === d.author);
          return {
            id: d.id,
            title: d.title,
            author: d.author,
            createdAt: d.createdAt,
            pinned: !!d.pinned,
            pinnedAt: d.pinnedAt,
            replyCount: Array.isArray(d.replies) ? d.replies.length : 0,
            views: d.views || 0,
            authorRole: u ? (u.role || 'user') : 'user',
            authorAdminBadgeText: u && u.role === 'admin' ? (u.adminBadgeText || '管理员') : '',
            authorIsOwner: u && (u.id === OWNER_UID || String(u.id) === String(OWNER_UID))
          };
        });
        return send(res, 200, { ok: true, data });
      }

      if (action === 'get') {
        const id = body.id;
        if (id == null) return send(res, 400, { ok: false, error: 'Discussion ID required' });
        const item = list.find(d => String(d.id) === String(id));
        if (!item) return send(res, 404, { ok: false, error: 'Discussion not found' });
        return send(res, 200, { ok: true, data: item });
      }

      if (action === 'update') {
        const id = body.id;
        const title = String(body.title || '').trim();
        const content = String(body.content || '').trim();
        if (id == null) return send(res, 400, { ok: false, error: 'Discussion ID required' });
        if (!title) return send(res, 400, { ok: false, error: 'Title required' });
        if (!content) return send(res, 400, { ok: false, error: 'Content required' });
        const idx = list.findIndex(d => String(d.id) === String(id));
        if (idx === -1) return send(res, 404, { ok: false, error: 'Discussion not found' });
        const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',').map(t => t.trim()).filter(Boolean);
        list[idx] = {
          ...list[idx],
          title,
          content,
          tags: tags.slice(0, 5)
        };
        if (await setDiscussions(list)) return send(res, 200, { ok: true, data: list[idx] });
        return send(res, 500, { ok: false, error: 'Failed to save' });
      }

      if (action === 'delete') {
        const id = body.id;
        if (id == null) return send(res, 400, { ok: false, error: 'Discussion ID required' });
        const next = list.filter(d => String(d.id) !== String(id));
        if (next.length === list.length) return send(res, 404, { ok: false, error: 'Discussion not found' });
        if (await setDiscussions(next)) return send(res, 200, { ok: true });
        return send(res, 500, { ok: false, error: 'Failed to delete' });
      }

      if (action === 'pin' || action === 'unpin') {
        const id = body.id;
        if (id == null) return send(res, 400, { ok: false, error: 'Discussion ID required' });
        const idx = list.findIndex(d => String(d.id) === String(id));
        if (idx === -1) return send(res, 404, { ok: false, error: 'Discussion not found' });
        list[idx].pinned = action === 'pin';
        if (action === 'pin') list[idx].pinnedAt = new Date().toISOString();
        else delete list[idx].pinnedAt;
        if (await setDiscussions(list)) return send(res, 200, { ok: true, data: list[idx] });
        return send(res, 500, { ok: false, error: 'Failed to save' });
      }

      return send(res, 400, { ok: false, error: 'Invalid action' });
    }

    // ---- feed moderation ----
    if (path === 'feed') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const action = body.action;
      let list = await getFeed();

      if (action === 'list') {
        const users = await getUsers();
        const data = list.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(f => {
          const u = users.find(x => x.username === f.username);
          return {
            ...f,
            usernameRole: u ? (u.role || 'user') : 'user',
            usernameAdminBadgeText: u && u.role === 'admin' ? (u.adminBadgeText || '管理员') : '',
            usernameIsOwner: u && (u.id === OWNER_UID || String(u.id) === String(OWNER_UID))
          };
        });
        return send(res, 200, { ok: true, data });
      }

      if (action === 'delete') {
        const id = body.id;
        if (id == null) return send(res, 400, { ok: false, error: 'Feed ID required' });
        const next = list.filter(f => String(f.id) !== String(id));
        if (next.length === list.length) return send(res, 404, { ok: false, error: 'Feed item not found' });
        if (await setFeed(next)) return send(res, 200, { ok: true });
        return send(res, 500, { ok: false, error: 'Failed to delete' });
      }

      return send(res, 400, { ok: false, error: 'Invalid action' });
    }

    // ---- fix-duplicate-uids ----
    if (path === 'fix-uids') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
      const users = await getUsers();

      // 找出所有重复的 UID
      const idMap = {};
      for (const u of users) {
        const id = Number(u.id) || 0;
        if (!idMap[id]) idMap[id] = [];
        idMap[id].push(u.username);
      }
      const duplicates = Object.entries(idMap)
        .filter(([, names]) => names.length > 1)
        .map(([id, names]) => ({ id: Number(id), usernames: names }));

      if (duplicates.length === 0) {
        return send(res, 200, { ok: true, data: { fixed: 0, message: 'No duplicate UIDs found', duplicates: [] } });
      }

      // 计算当前最大 ID
      let nextId = users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;
      const seenIds = new Set();
      const remapDetails = [];
      let totalFixed = 0;

      // 为重复的 UID 分配新 ID（保留第一个，其他重分配）
      for (const user of users) {
        const oldId = Number(user.id) || 0;
        if (seenIds.has(oldId)) {
          const newId = nextId++;
          remapDetails.push({ username: user.username, oldId, newId });
          user.id = newId;
          user.uid = newId;
          totalFixed++;
        } else {
          seenIds.add(oldId);
          // 确保 uid 字段和 id 一致
          if (user.uid === undefined || Number(user.uid) !== oldId) {
            user.uid = oldId;
          }
        }
      }

      await setUsers(users);

      // 更新所有关联数据（通过 username 匹配确保准确）
      let sessionUpdates = 0;
      let submissionUpdates = 0;
      let discussionUpdates = 0;
      let feedUpdates = 0;
      let contestUpdates = 0;

      const sessions = await getSessions();
      for (const [token, sess] of Object.entries(sessions)) {
        const user = users.find(u => u.username === sess.username);
        if (user) {
          const newUid = Number(user.id) || 0;
          const oldUid = Number(sess.userId || sess.uid) || 0;
          if (oldUid !== newUid) {
            sess.userId = newUid;
            sess.uid = newUid;
            sessionUpdates++;
          }
        }
      }
      await setSessions(sessions);

      const submissions = await getSubmissions();
      for (const sub of submissions) {
        const user = users.find(u => u.username === sub.username);
        if (user) {
          const newUid = Number(user.id) || 0;
          const oldUid = Number(sub.userId) || 0;
          if (oldUid !== newUid) {
            sub.userId = newUid;
            submissionUpdates++;
          }
        }
      }
      await setSubmissions(submissions);

      const discussions = await getDiscussions();
      for (const d of discussions) {
        const user = users.find(u => u.username === d.authorName);
        if (user) {
          const newUid = Number(user.id) || 0;
          if (String(d.authorId) !== String(newUid)) {
            d.authorId = newUid;
            discussionUpdates++;
          }
        }
        if (Array.isArray(d.replies)) {
          for (const r of d.replies) {
            const replyUser = users.find(u => u.username === r.authorName);
            if (replyUser) {
              const newUid = Number(replyUser.id) || 0;
              if (String(r.authorId) !== String(newUid)) {
                r.authorId = newUid;
                discussionUpdates++;
              }
            }
          }
        }
      }
      await setDiscussions(discussions);

      const feed = await getFeed();
      for (const f of feed) {
        const user = users.find(u => u.username === f.username);
        if (user) {
          const newUid = Number(user.id) || 0;
          if (String(f.userId) !== String(newUid)) {
            f.userId = newUid;
            feedUpdates++;
          }
        }
      }
      await setFeed(feed);

      const contests = await getContests();
      for (const c of contests) {
        if (c.createdByName) {
          const user = users.find(u => u.username === c.createdByName);
          if (user) {
            const newUid = Number(user.id) || 0;
            if (String(c.createdBy) !== String(newUid)) {
              c.createdBy = newUid;
              contestUpdates++;
            }
          }
        }
        if (Array.isArray(c.participants)) {
          for (const p of c.participants) {
            const user = users.find(u => u.username === p.username);
            if (user) {
              const newUid = Number(user.id) || 0;
              if (String(p.userId) !== String(newUid)) {
                p.userId = newUid;
                contestUpdates++;
              }
            }
          }
        }
      }
      await setContests(contests);

      return send(res, 200, {
        ok: true,
        data: {
          fixed: totalFixed,
          duplicates,
          nextUid: nextId,
          remapDetails,
          updates: {
            sessions: sessionUpdates,
            submissions: submissionUpdates,
            discussions: discussionUpdates,
            feed: feedUpdates,
            contests: contestUpdates,
          }
        }
      });
    }

    return send(res, 404, { ok: false, error: 'Invalid admin path' });
  } catch (err) {
    console.error('[admin] error:', err);
    return send(res, 500, { ok: false, error: 'Internal server error' });
  }
};
