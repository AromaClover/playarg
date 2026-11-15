const { getSession, readBody } = require('./_auth');
const { getProblems, getSubmissions, setSubmissions } = require('./_redis');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function normalizeAnswer(s) {
  return String(s || '').trim();
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
    const body = await readBody(req);
    const problemId = String(body.problemId || '').trim();
    const answer = normalizeAnswer(body.answer);

    if (!problemId) return send(res, 400, { ok: false, error: '缺少题目 ID' });

    const problems = await getProblems();
    const problem = problems.find(p => String(p.id).toLowerCase() === problemId.toLowerCase());
    if (!problem) return send(res, 404, { ok: false, error: '题目不存在' });

    const visibility = problem.visibility || 'public';
    if (visibility === 'hidden') return send(res, 404, { ok: false, error: '题目不存在' });

    const correctAnswer = normalizeAnswer(problem.answer);
    const isCorrect = correctAnswer && answer === correctAnswer;
    const status = isCorrect ? 'accepted' : 'wrong';

    const submissions = await getSubmissions();
    const newId = submissions.length ? Math.max(...submissions.map(s => s.id || 0)) + 1 : 1;
    const record = {
      id: newId,
      userId: session.userId || session.uid,
      username: session.username || '未知用户',
      problemId: problem.id,
      problemTitle: problem.title || problem.id,
      answer,
      status,
      createdAt: new Date().toISOString()
    };
    submissions.push(record);
    if (!await setSubmissions(submissions)) return send(res, 500, { ok: false, error: '保存失败' });

    return send(res, 200, {
      ok: true,
      data: {
        id: record.id,
        correct: isCorrect,
        status,
        answer: answer
      }
    });
  } catch (err) {
    console.error('[submit] error:', err);
    return send(res, 500, { ok: false, error: 'Internal server error' });
  }
};
