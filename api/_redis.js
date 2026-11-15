const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEYS = {
  users: 'playarg:users',
  sessions: 'playarg:sessions',
  announcements: 'playarg:announcements',
  problems: 'playarg:problems',
  contests: 'playarg:contests',
  banner: 'playarg:banner',
  sponsors: 'playarg:sponsors',
  feed: 'playarg:feed',
  discussions: 'playarg:discussions',
  submissions: 'playarg:submissions',
  notifications: 'playarg:notifications',
  messages: 'playarg:messages',
};

const DEFAULT_ANNOUNCEMENTS = [
  { id: 1, title: 'PlayARG 2026 秋季赛报名开启', date: '2026-08-15', category: '平台', pinned: true, content: '2026 年秋季赛将于 9 月 12 日正式开赛。本次比赛面向初高中及高校 OIer，设置 Div.1 / Div.2 两个组别。', fullContent: '赛程安排：\n- 报名截止：9 月 10 日 23:59\n- 正式比赛：9 月 12 日 14:00 - 17:00\n- 赛后讲题：9 月 13 日 20:00' },
  { id: 2, title: '8 月 14 日凌晨系统维护通知', date: '2026-08-12', category: '维护', pinned: false, content: '为提升判题稳定性，平台将于 8 月 14 日 02:00 - 04:00 进行服务器维护。', fullContent: '维护内容：\n- 升级判题机内核\n- 优化编译缓存策略\n- 修复运行时内存统计异常' },
  { id: 3, title: '题解支持 Markdown 与 LaTeX 公式', date: '2026-08-08', category: '功能', pinned: false, content: '题目详情页的题解区现已支持完整 Markdown 渲染与 LaTeX 数学公式。', fullContent: '新增能力：\n- 支持行间公式 $$...$$ 与行内公式 $...$\n- 代码块一键复制\n- 题解目录自动锚点导航' },
  { id: 4, title: '暑期训练营积分榜公布', date: '2026-08-01', category: '比赛', pinned: false, content: '暑期训练营已圆满结束，综合积分榜与奖项名单已发布。', fullContent: '领奖说明：\n- 一等奖：机械键盘 × 3\n- 二等奖：算法书籍套装 × 10\n- 三等奖：平台月度会员 × 30' },
  { id: 5, title: '关于防范账号共享的提醒', date: '2026-07-25', category: '安全', pinned: false, content: '近期发现个别账号存在异常登录与代打行为，平台将加强风控检测。', fullContent: '违规判定标准：\n- 同一账号在短时间内多地登录\n- 提交代码风格与历史记录严重不符\n- 比赛中出现协同作弊特征' }
];

const DEFAULT_PROBLEMS = [
  { id: 'P1001', title: 'A + B Problem', difficulty: 'easy', passRate: 85.2, submissions: 12450, tags: ['math'] },
  { id: 'P1002', title: '数字三角形', difficulty: 'easy', passRate: 62.5, submissions: 8320, tags: ['dp'] },
  { id: 'P1003', title: '最长上升子序列', difficulty: 'popular', passRate: 48.3, submissions: 7650, tags: ['dp'] },
  { id: 'P1004', title: 'Dijkstra 最短路', difficulty: 'popular', passRate: 55.7, submissions: 6910, tags: ['graph'] },
  { id: 'P1005', title: '最小生成树', difficulty: 'advanced', passRate: 38.2, submissions: 5420, tags: ['graph'] },
  { id: 'P1006', title: '线段树区间修改', difficulty: 'advanced', passRate: 31.5, submissions: 4200, tags: ['data-structures'] },
  { id: 'P1007', title: 'KMP 字符串匹配', difficulty: 'popular', passRate: 44.8, submissions: 6100, tags: ['strings'] },
  { id: 'P1008', title: '贪心算法入门', difficulty: 'easy', passRate: 71.3, submissions: 9800, tags: ['greedy'] },
  { id: 'P1009', title: '快速排序', difficulty: 'easy', passRate: 78.9, submissions: 11200, tags: ['sorting'] },
  { id: 'P1010', title: '省选综合题', difficulty: 'provincial', passRate: 12.4, submissions: 1200, tags: ['dp', 'graph'] }
];

const DEFAULT_CONTESTS = [];

const DEFAULT_BANNER = { enabled: false, imageUrl: '', linkUrl: '', altText: '' };

const DEFAULT_SPONSORS = [];

const DEFAULT_FEED = [
  { id: 1, userId: 1, username: 'PlayARG', content: '欢迎来到 PlayARG！在这里发射你的第一条犇犇吧 🚀', createdAt: '2026-08-19T08:00:00.000Z' }
];

const DEFAULT_DISCUSSIONS = [];

const DEFAULT_NOTIFICATIONS = [];

const DEFAULT_MESSAGES = [];

async function getUsers() {
  try {
    const data = await redis.get(KEYS.users);
    if (!data) return [];
    return Array.isArray(data) ? data : JSON.parse(data);
  } catch (err) {
    console.error('[redis] getUsers error:', err);
    return [];
  }
}

async function setUsers(users) {
  try {
    await redis.set(KEYS.users, JSON.stringify(users));
    return true;
  } catch (err) {
    console.error('[redis] setUsers error:', err);
    return false;
  }
}

async function getSessions() {
  try {
    const data = await redis.get(KEYS.sessions);
    if (!data) return {};
    return typeof data === 'object' && !Array.isArray(data) ? data : JSON.parse(data);
  } catch (err) {
    console.error('[redis] getSessions error:', err);
    return {};
  }
}

async function setSessions(sessions) {
  try {
    await redis.set(KEYS.sessions, JSON.stringify(sessions));
    return true;
  } catch (err) {
    console.error('[redis] setSessions error:', err);
    return false;
  }
}

// 通过 token 获取有效 session（自动清理已过期的 session）
async function getSessionByToken(token) {
  if (!token) return null;
  const sessions = await getSessions();
  const session = sessions[token];
  if (!session) return null;
  // 检查是否过期
  if (session.expiresAt && Date.now() > session.expiresAt) {
    delete sessions[token];
    await setSessions(sessions);
    return null;
  }
  return session;
}

async function getUserByUsername(username) {
  const users = await getUsers();
  return users.find(u => u.username === username) || null;
}

async function getUserById(id) {
  const users = await getUsers();
  return users.find(u => u.id === id) || null;
}

function parseJson(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch (e) {
    return fallback;
  }
}

async function getAnnouncements() {
  try {
    const data = await redis.get(KEYS.announcements);
    const list = parseJson(data, null);
    return Array.isArray(list) ? list : DEFAULT_ANNOUNCEMENTS;
  } catch (err) {
    console.error('[redis] getAnnouncements error:', err);
    return DEFAULT_ANNOUNCEMENTS;
  }
}

async function setAnnouncements(list) {
  try {
    await redis.set(KEYS.announcements, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setAnnouncements error:', err);
    return false;
  }
}

async function getProblems() {
  try {
    const data = await redis.get(KEYS.problems);
    const list = parseJson(data, null);
    return Array.isArray(list) ? list : DEFAULT_PROBLEMS;
  } catch (err) {
    console.error('[redis] getProblems error:', err);
    return DEFAULT_PROBLEMS;
  }
}

async function setProblems(list) {
  try {
    await redis.set(KEYS.problems, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setProblems error:', err);
    return false;
  }
}

async function getContests() {
  try {
    const data = await redis.get(KEYS.contests);
    const list = parseJson(data, null);
    return Array.isArray(list) ? list : DEFAULT_CONTESTS;
  } catch (err) {
    console.error('[redis] getContests error:', err);
    return DEFAULT_CONTESTS;
  }
}

async function setContests(list) {
  try {
    await redis.set(KEYS.contests, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setContests error:', err);
    return false;
  }
}

async function getBanner() {
  try {
    const data = await redis.get(KEYS.banner);
    return parseJson(data, DEFAULT_BANNER);
  } catch (err) {
    console.error('[redis] getBanner error:', err);
    return DEFAULT_BANNER;
  }
}

async function setBanner(banner) {
  try {
    await redis.set(KEYS.banner, JSON.stringify(banner));
    return true;
  } catch (err) {
    console.error('[redis] setBanner error:', err);
    return false;
  }
}

async function getSponsors() {
  try {
    const data = await redis.get(KEYS.sponsors);
    const list = parseJson(data, null);
    return Array.isArray(list) ? list : DEFAULT_SPONSORS;
  } catch (err) {
    console.error('[redis] getSponsors error:', err);
    return DEFAULT_SPONSORS;
  }
}

async function setSponsors(list) {
  try {
    await redis.set(KEYS.sponsors, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setSponsors error:', err);
    return false;
  }
}

async function getFeed() {
  try {
    const data = await redis.get(KEYS.feed);
    const list = parseJson(data, null);
    return Array.isArray(list) ? list : DEFAULT_FEED;
  } catch (err) {
    console.error('[redis] getFeed error:', err);
    return DEFAULT_FEED;
  }
}

async function setFeed(list) {
  try {
    await redis.set(KEYS.feed, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setFeed error:', err);
    return false;
  }
}

function needsDiscussionMigration(list) {
  if (!Array.isArray(list) || !list.length) return false;
  return list.some(item => typeof item.replies === 'number' || item.content === undefined);
}

function migrateDiscussions(list) {
  return list.map(item => {
    const migrated = { ...item };
    if (typeof migrated.replies === 'number') migrated.replies = [];
    if (migrated.content === undefined) migrated.content = '';
    if (!Array.isArray(migrated.tags)) migrated.tags = [];
    return migrated;
  });
}

async function getDiscussions() {
  try {
    const data = await redis.get(KEYS.discussions);
    const list = parseJson(data, null);
    if (!Array.isArray(list)) return DEFAULT_DISCUSSIONS;
    if (needsDiscussionMigration(list)) {
      const migrated = migrateDiscussions(list);
      await redis.set(KEYS.discussions, JSON.stringify(migrated));
      return migrated;
    }
    return list;
  } catch (err) {
    console.error('[redis] getDiscussions error:', err);
    return DEFAULT_DISCUSSIONS;
  }
}

async function setDiscussions(list) {
  try {
    await redis.set(KEYS.discussions, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setDiscussions error:', err);
    return false;
  }
}

async function getSubmissions() {
  try {
    const data = await redis.get(KEYS.submissions);
    if (!data) return [];
    return Array.isArray(data) ? data : JSON.parse(data);
  } catch (err) {
    console.error('[redis] getSubmissions error:', err);
    return [];
  }
}

async function setSubmissions(list) {
  try {
    await redis.set(KEYS.submissions, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setSubmissions error:', err);
    return false;
  }
}

async function getNotifications() {
  try {
    const data = await redis.get(KEYS.notifications);
    const list = parseJson(data, null);
    return Array.isArray(list) ? list : DEFAULT_NOTIFICATIONS;
  } catch (err) {
    console.error('[redis] getNotifications error:', err);
    return DEFAULT_NOTIFICATIONS;
  }
}

async function setNotifications(list) {
  try {
    await redis.set(KEYS.notifications, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setNotifications error:', err);
    return false;
  }
}

async function getMessages() {
  try {
    const data = await redis.get(KEYS.messages);
    const list = parseJson(data, null);
    return Array.isArray(list) ? list : DEFAULT_MESSAGES;
  } catch (err) {
    console.error('[redis] getMessages error:', err);
    return DEFAULT_MESSAGES;
  }
}

async function setMessages(list) {
  try {
    await redis.set(KEYS.messages, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[redis] setMessages error:', err);
    return false;
  }
}

module.exports = {
  redis,
  getUsers,
  setUsers,
  getSessions,
  setSessions,
  getSessionByToken,
  getUserByUsername,
  getUserById,
  getAnnouncements,
  setAnnouncements,
  getProblems,
  setProblems,
  getContests,
  setContests,
  getBanner,
  setBanner,
  getSponsors,
  setSponsors,
  getFeed,
  setFeed,
  getDiscussions,
  setDiscussions,
  getSubmissions,
  setSubmissions,
  getNotifications,
  setNotifications,
  getMessages,
  setMessages,
};
