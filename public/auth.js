/**
 * PlayARG shared auth UI
 * - Login / register modal (backend API)
 * - Admin mode toggle (role "admin" from server)
 * - Admin panel indicator
 * - Persists state in localStorage; session validated via /api/me
 */
(function () {
  'use strict';

  var USER_KEY = 'playarg_user';
  var ADMIN_MODE_KEY = 'playarg_admin_mode';
  var THEME_KEY = 'playarg_theme';
  var REMEMBERED_USER_KEY = 'playarg_remembered_username';

  // ---- Theme system ----
  function getTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    return saved === 'dark' ? 'dark' : 'light';
  }
  function setTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    applyTheme(theme);
  }
  function applyTheme(theme) {
    var html = document.documentElement;
    if (theme === 'dark') {
      html.setAttribute('data-theme', 'dark');
      html.classList.add('dark');
    } else {
      html.setAttribute('data-theme', 'light');
      html.classList.remove('dark');
    }
    var btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.innerHTML = theme === 'dark'
        ? '<i data-lucide="moon" class="h-4 w-4"></i>'
        : '<i data-lucide="sun" class="h-4 w-4"></i>';
      btn.title = theme === 'dark' ? '深色模式' : '亮色模式';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    // 派发主题变化事件，供页面内组件响应
    try {
      document.dispatchEvent(new CustomEvent('playarg-theme-change', { detail: { theme: theme } }));
    } catch (e) {}
  }
  function injectThemeStyles() {
    if (document.getElementById('playarg-theme-styles')) return;
    var style = document.createElement('style');
    style.id = 'playarg-theme-styles';
    style.textContent = [
      ':root[data-theme="light"] {',
      '  --playarg-background: #ffffff;',
      '  --playarg-foreground: #111827;',
      '  --playarg-card: #ffffff;',
      '  --playarg-card-foreground: #111827;',
      '  --playarg-popover: #ffffff;',
      '  --playarg-popover-foreground: #111827;',
      '  --playarg-primary: #0891b2;',
      '  --playarg-primary-foreground: #ffffff;',
      '  --playarg-primary-subtle: rgba(8, 145, 178, 0.1);',
      '  --playarg-primary-dim: rgba(8, 145, 178, 0.05);',
      '  --playarg-muted: #f3f4f6;',
      '  --playarg-muted-foreground: #4b5563;',
      '  --playarg-secondary: #e5e7eb;',
      '  --playarg-secondary-foreground: #111827;',
      '  --playarg-border: #d1d5db;',
      '  --playarg-input: #d1d5db;',
      '  --playarg-ring: rgba(8, 145, 178, 0.4);',
      '  --playarg-state-success: #15803d;',
      '  --playarg-state-warning: #b45309;',
      '  --playarg-state-error: #b91c1c;',
      '  --playarg-state-info: #1d4ed8;',
      '  --playarg-code-bg: #f3f4f6;',
      '  --playarg-code-fg: #111827;',
      '  --playarg-accent-purple: #7e22ce;',
      '  --playarg-accent-green: #15803d;',
      '}',
      ':root[data-theme="light"] body { color: var(--playarg-foreground); background: var(--playarg-background); }',
      ':root[data-theme="light"] .glow-text { text-shadow: none; }',
      ':root[data-theme="light"] pre, :root[data-theme="light"] code { background: var(--playarg-code-bg); color: var(--playarg-code-fg); }',
      '#theme-toggle-btn {',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  width: 36px; height: 36px; border-radius: 6px;',
      '  border: 1px solid var(--playarg-border);',
      '  color: var(--playarg-muted-foreground);',
      '  background: transparent; cursor: pointer;',
      '  transition: color 0.2s, border-color 0.2s;',
      '}',
      '#theme-toggle-btn:hover { color: var(--playarg-primary); border-color: var(--playarg-primary); }',
      '#theme-toggle-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--playarg-ring); }'
    ].join('\n');
    document.head.appendChild(style);
  }
  function renderThemeToggle() {
    var nav = document.querySelector('header nav');
    if (!nav) return;
    if (document.getElementById('theme-toggle-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.type = 'button';
    btn.title = '切换主题';
    btn.addEventListener('click', function () {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });
    // Insert before the first nav link ("规则")
    var firstLink = nav.querySelector('a[href="/rules"]');
    if (firstLink) {
      nav.insertBefore(btn, firstLink);
    } else {
      nav.insertBefore(btn, nav.firstChild);
    }
    applyTheme(getTheme());
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' } }, options || {}))
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        }).catch(function () {
          return { res: res, data: { ok: false, error: 'Invalid response' } };
        });
      })
      .catch(function (err) {
        return { res: { ok: false }, data: { ok: false, error: err && err.message ? err.message : 'Network error' } };
      });
  }

  function getUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setUser(user) {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }

  function isAdminMode() {
    return localStorage.getItem(ADMIN_MODE_KEY) === '1';
  }

  function setAdminMode(v) {
    localStorage.setItem(ADMIN_MODE_KEY, v ? '1' : '0');
  }

  function createModal() {
    if (document.getElementById('auth-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'fixed inset-0 z-[100] hidden items-center justify-center bg-black/60 p-4';
    modal.style.backdropFilter = 'blur(4px)';
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.innerHTML =
      '<div class="w-full max-w-md rounded-lg border border-[var(--playarg-border)] bg-[var(--playarg-card)] p-6 shadow-2xl">' +
        '<div class="mb-6 flex items-center justify-between">' +
          '<h3 id="auth-modal-title" class="text-lg font-semibold text-[var(--playarg-foreground)]">登录</h3>' +
          '<button id="auth-modal-close" class="flex h-8 w-8 items-center justify-center rounded-md text-[var(--playarg-muted-foreground)] transition-colors hover:bg-[var(--playarg-muted)] hover:text-[var(--playarg-foreground)]">' +
            '<i data-lucide="x" class="h-4 w-4"></i>' +
          '</button>' +
        '</div>' +
        '<div class="mb-6 flex rounded-md border border-[var(--playarg-border)] p-1">' +
          '<button id="tab-login" class="auth-tab flex-1 rounded-md py-1.5 text-sm font-medium transition-colors">登录</button>' +
          '<button id="tab-register" class="auth-tab flex-1 rounded-md py-1.5 text-sm font-medium transition-colors">注册</button>' +
        '</div>' +
        '<form id="auth-form" class="space-y-4">' +
          '<div id="auth-feedback" class="hidden rounded-md border px-3 py-2 text-sm"></div>' +
          '<div>' +
            '<label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">用户名</label>' +
            '<input id="auth-username" type="text" required class="h-10 w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 text-sm text-[var(--playarg-foreground)] placeholder:text-[var(--playarg-muted-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--playarg-ring)]" />' +
          '</div>' +
          '<div id="auth-email-group" class="hidden">' +
            '<label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">邮箱</label>' +
            '<input id="auth-email" type="email" class="h-10 w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 text-sm text-[var(--playarg-foreground)] placeholder:text-[var(--playarg-muted-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--playarg-ring)]" />' +
          '</div>' +
          '<div>' +
            '<label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">密码</label>' +
            '<input id="auth-password" type="password" required class="h-10 w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 text-sm text-[var(--playarg-foreground)] placeholder:text-[var(--playarg-muted-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--playarg-ring)]" />' +
          '</div>' +
          '<div id="auth-confirm-group" class="hidden">' +
            '<label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">确认密码</label>' +
            '<input id="auth-confirm" type="password" class="h-10 w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 text-sm text-[var(--playarg-foreground)] placeholder:text-[var(--playarg-muted-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--playarg-ring)]" />' +
          '</div>' +
          '<div id="auth-admin-secret-group" class="hidden">' +
            '<label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">管理员邀请码（可选）</label>' +
            '<input id="auth-admin-secret" type="password" class="h-10 w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 text-sm text-[var(--playarg-foreground)] placeholder:text-[var(--playarg-muted-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--playarg-ring)]" />' +
          '</div>' +
          '<div id="auth-remember-group" class="flex items-center">' +
            '<input id="auth-remember" type="checkbox" class="mr-2 h-4 w-4 rounded border-[var(--playarg-border)] accent-[var(--playarg-primary)] cursor-pointer" />' +
            '<label for="auth-remember" class="text-xs text-[var(--playarg-muted-foreground)] cursor-pointer select-none">记住密码 1 个月</label>' +
          '</div>' +
          '<button type="submit" id="auth-submit" class="mt-2 h-10 w-full rounded-md bg-[var(--playarg-primary)] text-sm font-medium text-[var(--playarg-primary-foreground)] transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--playarg-ring)]">登录</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(modal);
    bindModalEvents();
  }

  function bindModalEvents() {
    var modal = document.getElementById('auth-modal');
    var closeBtn = document.getElementById('auth-modal-close');
    var tabLogin = document.getElementById('tab-login');
    var tabRegister = document.getElementById('tab-register');
    var form = document.getElementById('auth-form');

    function switchTab(mode) {
      var isLogin = mode === 'login';
      var title = document.getElementById('auth-modal-title');
      var submit = document.getElementById('auth-submit');
      var emailGroup = document.getElementById('auth-email-group');
      var confirmGroup = document.getElementById('auth-confirm-group');
      var adminSecretGroup = document.getElementById('auth-admin-secret-group');
      var rememberGroup = document.getElementById('auth-remember-group');
      var emailInput = document.getElementById('auth-email');
      var confirmInput = document.getElementById('auth-confirm');

      title.textContent = isLogin ? '登录' : '注册';
      submit.textContent = isLogin ? '登录' : '注册';
      modal.dataset.mode = mode;

      if (isLogin) {
        tabLogin.className = 'auth-tab flex-1 rounded-md py-1.5 text-sm font-medium bg-[var(--playarg-primary)] text-[var(--playarg-primary-foreground)]';
        tabRegister.className = 'auth-tab flex-1 rounded-md py-1.5 text-sm font-medium text-[var(--playarg-muted-foreground)] hover:text-[var(--playarg-foreground)]';
        emailGroup.classList.add('hidden');
        confirmGroup.classList.add('hidden');
        adminSecretGroup.classList.add('hidden');
        rememberGroup.classList.remove('hidden');
        emailInput.removeAttribute('required');
        confirmInput.removeAttribute('required');
      } else {
        tabRegister.className = 'auth-tab flex-1 rounded-md py-1.5 text-sm font-medium bg-[var(--playarg-primary)] text-[var(--playarg-primary-foreground)]';
        tabLogin.className = 'auth-tab flex-1 rounded-md py-1.5 text-sm font-medium text-[var(--playarg-muted-foreground)] hover:text-[var(--playarg-foreground)]';
        emailGroup.classList.remove('hidden');
        confirmGroup.classList.remove('hidden');
        adminSecretGroup.classList.remove('hidden');
        rememberGroup.classList.add('hidden');
        emailInput.setAttribute('required', 'required');
        confirmInput.setAttribute('required', 'required');
      }
      hideFeedback();
    }

    tabLogin.addEventListener('click', function () { switchTab('login'); });
    tabRegister.addEventListener('click', function () { switchTab('register'); });
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      handleAuthSubmit();
    });

    modal._switchTab = switchTab;
    switchTab('login');
  }

  function showFeedback(message, type) {
    var el = document.getElementById('auth-feedback');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    if (type === 'error') {
      el.className = 'rounded-md border border-[var(--playarg-state-error)]/30 bg-[var(--playarg-state-error)]/10 px-3 py-2 text-sm text-[var(--playarg-state-error)]';
    } else {
      el.className = 'rounded-md border border-[var(--playarg-state-success)]/30 bg-[var(--playarg-state-success)]/10 px-3 py-2 text-sm text-[var(--playarg-state-success)]';
    }
  }

  function hideFeedback() {
    var el = document.getElementById('auth-feedback');
    if (el) el.classList.add('hidden');
  }

  function handleAuthSubmit() {
    var mode = document.getElementById('auth-modal').dataset.mode;
    var username = document.getElementById('auth-username').value.trim();
    var password = document.getElementById('auth-password').value;
    var email = document.getElementById('auth-email').value.trim();
    var confirm = document.getElementById('auth-confirm').value;
    var adminSecret = document.getElementById('auth-admin-secret').value.trim();

    var remember = document.getElementById('auth-remember')?.checked;

    if (!username || !password) {
      showFeedback('请填写用户名和密码', 'error');
      return;
    }

    if (mode === 'register') {
      if (!email) {
        showFeedback('请填写邮箱', 'error');
        return;
      }
      if (password !== confirm) {
        showFeedback('两次输入的密码不一致', 'error');
        return;
      }
      api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: username, email: email, password: password, adminSecret: adminSecret })
      }).then(function (result) {
        if (!result.data.ok) {
          showFeedback(result.data.error || '注册失败', 'error');
          return;
        }
        // Auto login after registration
        api('/api/login', {
          method: 'POST',
          body: JSON.stringify({ username: username, password: password, remember: true })
        }).then(function (loginResult) {
          if (!loginResult.data.ok) {
            showFeedback(loginResult.data.error || '注册成功，但自动登录失败', 'error');
            return;
          }
          setUser(loginResult.data.data);
          showFeedback('注册成功，已自动登录', 'success');
          setTimeout(function () {
            closeModal();
            renderAuth();
          }, 500);
        });
      });
      return;
    }

    api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: username, password: password, remember: !!remember })
    }).then(function (result) {
      if (!result.data.ok) {
        showFeedback(result.data.error || '登录失败', 'error');
        return;
      }
      // 保存或清除记住的用户名
      try {
        if (remember) {
          localStorage.setItem(REMEMBERED_USER_KEY, username);
        } else {
          localStorage.removeItem(REMEMBERED_USER_KEY);
        }
      } catch (e) {}
      setUser(result.data.data);
      showFeedback('登录成功', 'success');
      setTimeout(function () {
        closeModal();
        renderAuth();
      }, 400);
    });
  }

  function openModal(mode) {
    createModal();
    var modal = document.getElementById('auth-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (modal._switchTab) modal._switchTab(mode || 'login');
    // 自动填充记住的用户名
    try {
      var remembered = localStorage.getItem(REMEMBERED_USER_KEY);
      if (remembered) {
        document.getElementById('auth-username').value = remembered;
        document.getElementById('auth-remember').checked = true;
        document.getElementById('auth-password').focus();
        return;
      }
    } catch (e) {}
    document.getElementById('auth-username').focus();
  }

  function closeModal() {
    var modal = document.getElementById('auth-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  function showAdminToast(action) {
    var titles = {
      announcements: '发布公告',
      problems: '管理题目',
      permissions: '用户权限',
      contests: '审核比赛',
      banner: '设置 Banner',
      sponsors: '赞助鸣谢'
    };
    alert('管理员功能占位：' + (titles[action] || action));
  }

  // ---- Admin panels ----
  function createAdminModal() {
    if (document.getElementById('admin-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'admin-modal';
    modal.className = 'fixed inset-0 z-[110] hidden items-center justify-center bg-black/70 p-4';
    modal.style.backdropFilter = 'blur(4px)';
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.innerHTML =
      '<div class="flex h-full max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-[var(--playarg-border)] bg-[var(--playarg-card)] shadow-2xl">' +
        '<div class="flex items-center justify-between border-b border-[var(--playarg-border)] px-5 py-4">' +
          '<h3 id="admin-modal-title" class="text-base font-semibold text-[var(--playarg-foreground)]">管理面板</h3>' +
          '<button id="admin-modal-close" class="flex h-8 w-8 items-center justify-center rounded-md text-[var(--playarg-muted-foreground)] transition-colors hover:bg-[var(--playarg-muted)] hover:text-[var(--playarg-foreground)]">' +
            '<i data-lucide="x" class="h-4 w-4"></i>' +
          '</button>' +
        '</div>' +
        '<div id="admin-modal-body" class="flex-1 overflow-y-auto p-5"></div>' +
        '<div id="admin-modal-footer" class="flex items-center justify-end gap-2 border-t border-[var(--playarg-border)] px-5 py-3"></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('admin-modal-close').addEventListener('click', closeAdminModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeAdminModal(); });
  }

  function openAdminModal(title, bodyHtml, footerHtml) {
    createAdminModal();
    var modal = document.getElementById('admin-modal');
    document.getElementById('admin-modal-title').textContent = title || '管理面板';
    document.getElementById('admin-modal-body').innerHTML = bodyHtml || '';
    document.getElementById('admin-modal-footer').innerHTML = footerHtml || '<button id="admin-modal-done" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">完成</button>';
    var doneBtn = document.getElementById('admin-modal-done');
    if (doneBtn) doneBtn.addEventListener('click', closeAdminModal);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function closeAdminModal() {
    var modal = document.getElementById('admin-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  function adminFeedback(message, type) {
    var body = document.getElementById('admin-modal-body');
    if (!body) return;
    var color = type === 'error' ? 'text-[var(--playarg-state-error)]' : 'text-[var(--playarg-state-success)]';
    var el = document.createElement('div');
    el.className = 'mb-3 rounded-md border border-[var(--playarg-border)] px-3 py-2 text-sm ' + color;
    el.textContent = message;
    body.insertBefore(el, body.firstChild);
    setTimeout(function () { el.remove(); }, 3000);
  }

  function adminTextarea(name, label, value, rows) {
    return '<div class="mb-3"><label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">' + escapeHtml(label) + '</label>' +
      '<textarea id="' + name + '" rows="' + (rows || 3) + '" class="w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 py-2 text-sm text-[var(--playarg-foreground)] placeholder:text-[var(--playarg-muted-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none">' + escapeHtml(value || '') + '</textarea></div>';
  }

  function adminInput(name, label, value, type, disabled) {
    return '<div class="mb-3"><label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">' + escapeHtml(label) + '</label>' +
      '<input id="' + name + '" type="' + (type || 'text') + '" value="' + escapeHtml(value || '') + '"' + (disabled ? ' disabled' : '') + ' class="h-10 w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 text-sm text-[var(--playarg-foreground)] placeholder:text-[var(--playarg-muted-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none' + (disabled ? ' opacity-60' : '') + '" /></div>';
  }

  function adminSelect(name, label, options, value) {
    var opts = options.map(function (o) {
      return '<option value="' + escapeHtml(o.value) + '"' + (o.value === value ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
    }).join('');
    return '<div class="mb-3"><label class="mb-1 block text-xs font-medium text-[var(--playarg-muted-foreground)]">' + escapeHtml(label) + '</label>' +
      '<select id="' + name + '" class="h-10 w-full rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 text-sm text-[var(--playarg-foreground)] focus:border-[var(--playarg-primary)] focus:outline-none">' + opts + '</select></div>';
  }

  function adminCheckbox(name, label, checked) {
    return '<label class="mb-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--playarg-foreground)]">' +
      '<input id="' + name + '" type="checkbox"' + (checked ? ' checked' : '') + ' class="h-4 w-4 rounded border-[var(--playarg-border)] bg-[var(--playarg-background)] text-[var(--playarg-primary)] focus:ring-[var(--playarg-ring)]" />' +
      '<span>' + escapeHtml(label) + '</span></label>';
  }

  function formatSamplesForEdit(samples) {
    if (!Array.isArray(samples) || !samples.length) return '';
    return samples.map(function (s) {
      return String(s.input || '') + '\n---\n' + String(s.output || '');
    }).join('\n===\n');
  }

  function openAnnouncementsAdmin() {
    api('/api/announcements', { method: 'GET' }).then(function (result) {
      var list = (result.data && result.data.data) || [];
      var html = '<div class="mb-4 flex items-center justify-between"><h4 class="text-sm font-medium text-[var(--playarg-foreground)]">现有公告</h4><button id="admin-announcement-add" class="h-8 rounded-md bg-[var(--playarg-primary)] px-3 text-xs font-medium text-[var(--playarg-primary-foreground)]">新增公告</button></div>' +
        '<div id="admin-announcement-list" class="space-y-2">' + renderAnnouncementList(list) + '</div>' +
        '<div id="admin-announcement-form" class="mt-4 hidden rounded-lg border border-[var(--playarg-border)] p-4">' +
          '<h4 class="mb-3 text-sm font-medium text-[var(--playarg-foreground)]" id="admin-announcement-form-title">新增公告</h4>' +
          '<input id="admin-announcement-id" type="hidden" />' +
          adminInput('admin-announcement-title', '标题', '') +
          '<div class="grid grid-cols-2 gap-3">' + adminInput('admin-announcement-date', '日期', '') + adminInput('admin-announcement-category', '分类', '') + '</div>' +
          adminCheckbox('admin-announcement-pinned', '置顶', false) +
          adminTextarea('admin-announcement-content', '摘要', '', 2) +
          adminTextarea('admin-announcement-full', '正文（支持换行）', '', 5) +
          '<div class="flex gap-2"><button id="admin-announcement-save" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">保存</button>' +
          '<button id="admin-announcement-cancel" class="h-9 rounded-md border border-[var(--playarg-border)] px-4 text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]">取消</button></div>' +
        '</div>';
      openAdminModal('发布公告', html, '');
      bindAnnouncementAdmin(list);
    });
  }

  function renderAnnouncementList(list) {
    if (!list.length) return '<div class="rounded-md border border-[var(--playarg-border)] p-4 text-center text-sm text-[var(--playarg-muted-foreground)]">暂无公告</div>';
    return list.map(function (a) {
      return '<div class="flex items-center justify-between rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 py-2">' +
        '<div class="min-w-0 flex-1"><div class="truncate text-sm font-medium text-[var(--playarg-foreground)]">' + escapeHtml(a.title) + '</div>' +
        '<div class="text-xs text-[var(--playarg-muted-foreground)]">' + escapeHtml(a.date) + ' · ' + escapeHtml(a.category) + (a.pinned ? ' · 置顶' : '') + '</div></div>' +
        '<div class="ml-2 flex gap-1"><button class="admin-announcement-edit h-7 rounded-md border border-[var(--playarg-border)] px-2 text-xs text-[var(--playarg-foreground)] hover:bg-[var(--playarg-muted)]" data-id="' + a.id + '">编辑</button>' +
        '<button class="admin-announcement-delete h-7 rounded-md border border-[var(--playarg-state-error)]/30 px-2 text-xs text-[var(--playarg-state-error)] hover:bg-[var(--playarg-state-error)]/10" data-id="' + a.id + '">删除</button></div>' +
      '</div>';
    }).join('');
  }

  function bindAnnouncementAdmin(list) {
    document.getElementById('admin-announcement-add').addEventListener('click', function () {
      document.getElementById('admin-announcement-form').classList.remove('hidden');
      document.getElementById('admin-announcement-form-title').textContent = '新增公告';
      document.getElementById('admin-announcement-id').value = '';
      document.getElementById('admin-announcement-title').value = '';
      document.getElementById('admin-announcement-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('admin-announcement-category').value = '平台';
      document.getElementById('admin-announcement-pinned').checked = false;
      document.getElementById('admin-announcement-content').value = '';
      document.getElementById('admin-announcement-full').value = '';
    });
    document.getElementById('admin-announcement-cancel').addEventListener('click', function () {
      document.getElementById('admin-announcement-form').classList.add('hidden');
    });
    document.getElementById('admin-announcement-save').addEventListener('click', function () {
      var idVal = document.getElementById('admin-announcement-id').value;
      var item = {
        title: document.getElementById('admin-announcement-title').value.trim(),
        date: document.getElementById('admin-announcement-date').value.trim(),
        category: document.getElementById('admin-announcement-category').value.trim(),
        pinned: document.getElementById('admin-announcement-pinned').checked,
        content: document.getElementById('admin-announcement-content').value.trim(),
        fullContent: document.getElementById('admin-announcement-full').value.trim()
      };
      if (idVal) item.id = parseInt(idVal, 10);
      var action = idVal ? 'update' : 'create';
      api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ action: action, item: item }) }).then(function (result) {
        if (result.data.ok) {
          adminFeedback('保存成功', 'success');
          openAnnouncementsAdmin();
        } else {
          adminFeedback(result.data.error || '保存失败', 'error');
        }
      });
    });
    document.querySelectorAll('.admin-announcement-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = list.find(function (x) { return x.id == btn.dataset.id; });
        if (!a) return;
        document.getElementById('admin-announcement-form').classList.remove('hidden');
        document.getElementById('admin-announcement-form-title').textContent = '编辑公告';
        document.getElementById('admin-announcement-id').value = a.id;
        document.getElementById('admin-announcement-title').value = a.title || '';
        document.getElementById('admin-announcement-date').value = a.date || '';
        document.getElementById('admin-announcement-category').value = a.category || '';
        document.getElementById('admin-announcement-pinned').checked = !!a.pinned;
        document.getElementById('admin-announcement-content').value = a.content || '';
        document.getElementById('admin-announcement-full').value = a.fullContent || '';
      });
    });
    document.querySelectorAll('.admin-announcement-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('确定删除这条公告？')) return;
        api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ action: 'delete', id: parseInt(btn.dataset.id, 10) }) }).then(function (result) {
          if (result.data.ok) {
            adminFeedback('删除成功', 'success');
            openAnnouncementsAdmin();
          } else {
            adminFeedback(result.data.error || '删除失败', 'error');
          }
        });
      });
    });
  }

  function openProblemsAdmin() {
    api('/api/data?type=problems', { method: 'GET' }).then(function (result) {
      var list = (result.data && result.data.data) || [];
      var html = '<div class="mb-4 flex items-center justify-between"><h4 class="text-sm font-medium text-[var(--playarg-foreground)]">题目列表</h4><button id="admin-problem-add" class="h-8 rounded-md bg-[var(--playarg-primary)] px-3 text-xs font-medium text-[var(--playarg-primary-foreground)]">新增题目</button></div>' +
        '<div id="admin-problem-list" class="space-y-2">' + renderProblemList(list) + '</div>' +
        '<div id="admin-problem-form" class="mt-4 hidden rounded-lg border border-[var(--playarg-border)] p-4">' +
          '<h4 class="mb-3 text-sm font-medium text-[var(--playarg-foreground)]" id="admin-problem-form-title">新增题目</h4>' +
          adminInput('admin-problem-id', '题号', '') +
          adminInput('admin-problem-title', '标题', '') +
          adminSelect('admin-problem-difficulty', 'Level', [
            { value: 'easy', label: 'Level 1' },
            { value: 'popular', label: 'Level 2' },
            { value: 'advanced', label: 'Level 3' },
            { value: 'provincial', label: 'Level 4' }
          ], 'easy') +
          adminInput('admin-problem-tags', '标签（逗号分隔）', '') +
          adminInput('admin-problem-source', '来源', '') +
          '<div class="grid grid-cols-2 gap-3">' + adminInput('admin-problem-time', '时间限制', '1 s') + adminInput('admin-problem-memory', '内存限制', '128 MB') + '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            adminSelect('admin-problem-visibility', '可见性', [
              { value: 'public', label: '公开可见' },
              { value: 'contest', label: '仅当前比赛可见' },
              { value: 'hidden', label: '不可见' }
            ], 'public') +
            adminInput('admin-problem-answer', '标准答案', '') +
          '</div>' +
          adminTextarea('admin-problem-description', '题目描述', '', 5) +
          adminTextarea('admin-problem-input', '输入格式', '', 3) +
          adminTextarea('admin-problem-output', '输出格式', '', 3) +
          adminTextarea('admin-problem-samples', '样例（输入和输出用 --- 分隔，多组用 === 分隔）', '', 4) +
          adminTextarea('admin-problem-constraints', '数据范围与提示', '', 3) +
          '<div class="flex gap-2"><button id="admin-problem-save" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">保存</button>' +
          '<button id="admin-problem-cancel" class="h-9 rounded-md border border-[var(--playarg-border)] px-4 text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]">取消</button></div>' +
        '</div>';
      openAdminModal('添加/编辑题目', html, '');
      bindProblemAdmin(list);
    });
  }

  var VISIBILITY_LABEL = { public: '公开', contest: '比赛', hidden: '隐藏' };
  var VISIBILITY_CLASS = { public: 'bg-[var(--playarg-state-success)]/10 text-[var(--playarg-state-success)]', contest: 'bg-[var(--playarg-state-warning)]/10 text-[var(--playarg-state-warning)]', hidden: 'bg-[var(--playarg-state-error)]/10 text-[var(--playarg-state-error)]' };
  var DIFFICULTY_LABEL = { easy: 'Level 1', popular: 'Level 2', advanced: 'Level 3', provincial: 'Level 4' };

  function renderProblemList(list) {
    if (!list.length) return '<div class="rounded-md border border-[var(--playarg-border)] p-4 text-center text-sm text-[var(--playarg-muted-foreground)]">暂无题目</div>';
    return list.map(function (p) {
      var v = p.visibility || 'public';
      var vClass = VISIBILITY_CLASS[v] || VISIBILITY_CLASS.public;
      return '<div class="flex items-center justify-between rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 py-2">' +
        '<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="truncate text-sm font-medium text-[var(--playarg-foreground)]">' + escapeHtml(p.id) + ' - ' + escapeHtml(p.title) + '</span><span class="rounded px-1.5 py-0.5 text-[10px] font-medium ' + vClass + '">' + escapeHtml(VISIBILITY_LABEL[v] || v) + '</span></div>' +
        '<div class="text-xs text-[var(--playarg-muted-foreground)]">' + escapeHtml(DIFFICULTY_LABEL[p.difficulty] || p.difficulty) + ' · 提交 ' + (p.submissions || 0) + ' · 通过率 ' + (p.passRate || 0) + '%</div></div>' +
        '<div class="ml-2 flex gap-1"><button class="admin-problem-edit h-7 rounded-md border border-[var(--playarg-border)] px-2 text-xs text-[var(--playarg-foreground)] hover:bg-[var(--playarg-muted)]" data-id="' + escapeHtml(p.id) + '">编辑</button>' +
        '<button class="admin-problem-delete h-7 rounded-md border border-[var(--playarg-state-error)]/30 px-2 text-xs text-[var(--playarg-state-error)] hover:bg-[var(--playarg-state-error)]/10" data-id="' + escapeHtml(p.id) + '">删除</button></div>' +
      '</div>';
    }).join('');
  }

  function bindProblemAdmin(list) {
    document.getElementById('admin-problem-add').addEventListener('click', function () {
      document.getElementById('admin-problem-form').classList.remove('hidden');
      document.getElementById('admin-problem-form-title').textContent = '新增题目';
      document.getElementById('admin-problem-id').value = '';
      document.getElementById('admin-problem-id').disabled = false;
      document.getElementById('admin-problem-title').value = '';
      document.getElementById('admin-problem-difficulty').value = 'easy';
      document.getElementById('admin-problem-tags').value = '';
      document.getElementById('admin-problem-source').value = '';
      document.getElementById('admin-problem-time').value = '1 s';
      document.getElementById('admin-problem-memory').value = '128 MB';
      document.getElementById('admin-problem-description').value = '';
      document.getElementById('admin-problem-input').value = '';
      document.getElementById('admin-problem-output').value = '';
      document.getElementById('admin-problem-samples').value = '';
      document.getElementById('admin-problem-constraints').value = '';
      document.getElementById('admin-problem-answer').value = '';
      document.getElementById('admin-problem-visibility').value = 'public';
    });
    document.getElementById('admin-problem-cancel').addEventListener('click', function () {
      document.getElementById('admin-problem-form').classList.add('hidden');
    });
    document.getElementById('admin-problem-save').addEventListener('click', function () {
      var isEdit = document.getElementById('admin-problem-id').disabled;
      var item = {
        id: document.getElementById('admin-problem-id').value.trim(),
        title: document.getElementById('admin-problem-title').value.trim(),
        difficulty: document.getElementById('admin-problem-difficulty').value,
        tags: document.getElementById('admin-problem-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
        source: document.getElementById('admin-problem-source').value.trim(),
        timeLimit: document.getElementById('admin-problem-time').value.trim() || '1 s',
        memoryLimit: document.getElementById('admin-problem-memory').value.trim() || '128 MB',
        description: document.getElementById('admin-problem-description').value.trim(),
        inputFormat: document.getElementById('admin-problem-input').value.trim(),
        outputFormat: document.getElementById('admin-problem-output').value.trim(),
        samples: document.getElementById('admin-problem-samples').value.trim(),
        constraints: document.getElementById('admin-problem-constraints').value.trim(),
        answer: document.getElementById('admin-problem-answer').value.trim(),
        visibility: document.getElementById('admin-problem-visibility').value
      };
      var action = isEdit ? 'update' : 'create';
      api('/api/admin/problems', { method: 'POST', body: JSON.stringify({ action: action, item: item }) }).then(function (result) {
        if (result.data.ok) {
          adminFeedback('保存成功', 'success');
          openProblemsAdmin();
        } else {
          adminFeedback(result.data.error || '保存失败', 'error');
        }
      });
    });
    document.querySelectorAll('.admin-problem-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = list.find(function (x) { return String(x.id) === btn.dataset.id; });
        if (!p) return;
        document.getElementById('admin-problem-form').classList.remove('hidden');
        document.getElementById('admin-problem-form-title').textContent = '编辑题目';
        document.getElementById('admin-problem-id').value = p.id || '';
        document.getElementById('admin-problem-id').disabled = true;
        document.getElementById('admin-problem-title').value = p.title || '';
        document.getElementById('admin-problem-difficulty').value = p.difficulty || 'easy';
        document.getElementById('admin-problem-tags').value = (p.tags || []).join(', ');
        document.getElementById('admin-problem-source').value = p.source || '';
        document.getElementById('admin-problem-time').value = p.timeLimit || p.time_limit || '1 s';
        document.getElementById('admin-problem-memory').value = p.memoryLimit || p.memory_limit || '128 MB';
        document.getElementById('admin-problem-description').value = p.description || '';
        document.getElementById('admin-problem-input').value = p.inputFormat || p.input_format || '';
        document.getElementById('admin-problem-output').value = p.outputFormat || p.output_format || '';
        document.getElementById('admin-problem-samples').value = formatSamplesForEdit(p.samples);
        document.getElementById('admin-problem-constraints').value = p.constraints || '';
        document.getElementById('admin-problem-answer').value = p.answer || '';
        document.getElementById('admin-problem-visibility').value = p.visibility || 'public';
      });
    });
    document.querySelectorAll('.admin-problem-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('确定删除 ' + btn.dataset.id + '？')) return;
        api('/api/admin/problems', { method: 'POST', body: JSON.stringify({ action: 'delete', id: btn.dataset.id }) }).then(function (result) {
          if (result.data.ok) {
            adminFeedback('删除成功', 'success');
            openProblemsAdmin();
          } else {
            adminFeedback(result.data.error || '删除失败', 'error');
          }
        });
      });
    });
  }

  function openPermissionsAdmin() {
    var html = adminInput('admin-perm-uid', '用户 UID', '', 'number') +
      '<div class="grid grid-cols-2 gap-3">' +
      adminSelect('admin-perm-role', '角色', [{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }], 'user') +
      adminSelect('admin-perm-status', '状态', [{ value: 'active', label: '正常' }, { value: 'banned', label: '封禁' }], 'active') +
      '</div>' +
      '<div id="admin-perm-result" class="mt-2 text-sm"></div>';
    openAdminModal('管理用户权限', html, '<button id="admin-perm-save" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">保存</button>');
    document.getElementById('admin-perm-save').addEventListener('click', function () {
      var uid = parseInt(document.getElementById('admin-perm-uid').value, 10);
      var role = document.getElementById('admin-perm-role').value;
      var status = document.getElementById('admin-perm-status').value;
      if (!uid || isNaN(uid)) return adminFeedback('请输入有效的 UID', 'error');
      Promise.all([
        api('/api/admin/set-role', { method: 'POST', body: JSON.stringify({ uid: uid, role: role }) }),
        api('/api/admin/set-status', { method: 'POST', body: JSON.stringify({ uid: uid, status: status }) })
      ]).then(function (results) {
        var roleOk = results[0].data.ok;
        var statusOk = results[1].data.ok;
        var roleErr = results[0].data.error;
        var statusErr = results[1].data.error;
        if (roleOk && statusOk) {
          document.getElementById('admin-perm-result').className = 'mt-2 text-sm text-[var(--playarg-state-success)]';
          document.getElementById('admin-perm-result').textContent = 'UID ' + uid + ' 已更新：角色 ' + role + '，状态 ' + status;
        } else {
          document.getElementById('admin-perm-result').className = 'mt-2 text-sm text-[var(--playarg-state-error)]';
          document.getElementById('admin-perm-result').textContent = (roleErr || '') + (statusErr ? ' / ' + statusErr : '') || '设置失败';
        }
      });
    });
  }

  var CONTEST_STATUS_LABEL = { upcoming: '未开始', running: '进行中', ended: '已结束' };
  var CONTEST_STATUS_CLASS = { upcoming: 'text-[var(--playarg-state-warning)]', running: 'text-[var(--playarg-state-success)]', ended: 'text-[var(--playarg-muted-foreground)]' };

  function openContestsAdmin() {
    api('/api/contests', { method: 'GET' }).then(function (result) {
      var list = (result.data && result.data.data) || [];
      var html = '<div class="mb-4"><button id="admin-contest-add" class="h-9 rounded-md bg-[var(--playarg-primary)] px-3 text-sm font-medium text-[var(--playarg-primary-foreground)]">+ 新建比赛</button></div>' +
        '<div class="space-y-2">' + (list.length ? list.map(function (c) {
          var status = c.status || 'upcoming';
          return '<div class="rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] p-3">' +
            '<div class="flex items-center justify-between"><span class="text-sm font-medium text-[var(--playarg-foreground)]">' + escapeHtml(c.title || '未命名比赛') + '</span><span class="text-xs font-medium ' + (CONTEST_STATUS_CLASS[status] || '') + '">' + escapeHtml(CONTEST_STATUS_LABEL[status] || status) + '</span></div>' +
            '<div class="mb-2 text-xs text-[var(--playarg-muted-foreground)]">ID: ' + escapeHtml(c.id) + ' · ' + escapeHtml(c.startTime || '-') + ' 至 ' + escapeHtml(c.endTime || '-') + ' · 报名 ' + (c.participantCount || 0) + ' 人</div>' +
            '<div class="flex gap-2"><button class="admin-contest-edit h-8 rounded-md border border-[var(--playarg-border)] px-3 text-xs text-[var(--playarg-foreground)] hover:bg-[var(--playarg-muted)]" data-id="' + escapeHtml(c.id) + '">编辑</button>' +
            '<button class="admin-contest-delete h-8 rounded-md border border-[var(--playarg-state-error)]/30 px-3 text-xs text-[var(--playarg-state-error)] hover:bg-[var(--playarg-state-error)]/10" data-id="' + escapeHtml(c.id) + '">删除</button></div>' +
          '</div>';
        }).join('') : '<div class="rounded-md border border-[var(--playarg-border)] p-6 text-center text-sm text-[var(--playarg-muted-foreground)]">暂无比赛</div>') + '</div>';
      openAdminModal('管理比赛', html, '');

      document.getElementById('admin-contest-add').addEventListener('click', function () { openContestForm(); });
      document.querySelectorAll('.admin-contest-edit').forEach(function (btn) {
        btn.addEventListener('click', function () { openContestForm(btn.dataset.id); });
      });
      document.querySelectorAll('.admin-contest-delete').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('确认删除比赛 “' + btn.dataset.id + '”？')) return;
          api('/api/contests', { method: 'POST', body: JSON.stringify({ action: 'delete', id: btn.dataset.id }) }).then(function (result) {
            if (result.data.ok) { openContestsAdmin(); } else { adminFeedback(result.data.error || '删除失败', 'error'); }
          });
        });
      });
    });
  }

  function openContestForm(editId) {
    api('/api/contests' + (editId ? '?id=' + encodeURIComponent(editId) : ''), { method: 'GET' }).then(function (result) {
      var c = editId ? ((result.data && result.data.data) || {}) : {};
      var html = adminInput('admin-contest-title', '比赛标题', c.title || '') +
        adminTextarea('admin-contest-description', '比赛说明', c.description || '', 4) +
        '<div class="grid grid-cols-2 gap-3">' + adminInput('admin-contest-start', '开始时间', c.startTime ? c.startTime.slice(0, 16) : '', 'datetime-local') + adminInput('admin-contest-end', '结束时间', c.endTime ? c.endTime.slice(0, 16) : '', 'datetime-local') + '</div>' +
        adminTextarea('admin-contest-problems', '题目 ID（每行一个）', Array.isArray(c.problems) ? c.problems.join('\n') : '', 4) +
        adminCheckbox('admin-contest-mode', '比赛模式（只统计比赛时间内提交）', c.contestMode !== false);
      openAdminModal(editId ? '编辑比赛' : '新建比赛', html, '<button id="admin-contest-save" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">保存</button>');

      document.getElementById('admin-contest-save').addEventListener('click', function () {
        var titleVal = document.getElementById('admin-contest-title').value.trim();
        var startVal = document.getElementById('admin-contest-start').value;
        var endVal = document.getElementById('admin-contest-end').value;
        var problemsVal = document.getElementById('admin-contest-problems').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!titleVal || !startVal || !endVal) { adminFeedback('请填写完整信息', 'error'); return; }
        var item = {
          title: titleVal,
          description: document.getElementById('admin-contest-description').value.trim(),
          startTime: new Date(startVal).toISOString(),
          endTime: new Date(endVal).toISOString(),
          problems: problemsVal,
          contestMode: document.getElementById('admin-contest-mode').checked
        };
        if (editId) item.id = editId;
        api('/api/contests', {
          method: 'POST',
          body: JSON.stringify({ action: editId ? 'update' : 'create', item: item })
        }).then(function (result) {
          if (result.data.ok) { openContestsAdmin(); }
          else { adminFeedback(result.data.error || '保存失败', 'error'); }
        });
      });
    });
  }

  function openBannerAdmin() {
    api('/api/banner', { method: 'GET' }).then(function (result) {
      var b = (result.data && result.data.data) || {};
      var html = adminCheckbox('admin-banner-enabled', '启用首页 Banner', b.enabled) +
        adminInput('admin-banner-image', '图片 URL', b.imageUrl || '') +
        adminInput('admin-banner-link', '跳转链接', b.linkUrl || '') +
        adminInput('admin-banner-alt', '替代文本', b.altText || '');
      openAdminModal('设置首页 Banner/广告', html, '<button id="admin-banner-save" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">保存</button>');
      document.getElementById('admin-banner-save').addEventListener('click', function () {
        var banner = {
          enabled: document.getElementById('admin-banner-enabled').checked,
          imageUrl: document.getElementById('admin-banner-image').value.trim(),
          linkUrl: document.getElementById('admin-banner-link').value.trim(),
          altText: document.getElementById('admin-banner-alt').value.trim()
        };
        api('/api/admin/banner', { method: 'POST', body: JSON.stringify(banner) }).then(function (result) {
          if (result.data.ok) { adminFeedback('保存成功', 'success'); } else { adminFeedback(result.data.error || '保存失败', 'error'); }
        });
      });
    });
  }

  function openSponsorsAdmin() {
    api('/api/sponsors', { method: 'GET' }).then(function (result) {
      var list = (result.data && result.data.data) || [];
      var value = list.map(function (s) { return (s.name || '') + (s.level ? ' [' + s.level + ']' : '') + (s.url ? ' (' + s.url + ')' : ''); }).join('\n');
      var html = '<p class="mb-2 text-xs text-[var(--playarg-muted-foreground)]">每行一个赞助/鸣谢，格式：名称 [级别] (链接)。示例：阿里云 [钻石赞助] (https://aliyun.com)</p>' +
        adminTextarea('admin-sponsors-list', '赞助/鸣谢列表', value, 8);
      openAdminModal('设置赞助/鸣谢', html, '<button id="admin-sponsors-save" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">保存</button>');
      document.getElementById('admin-sponsors-save').addEventListener('click', function () {
        var lines = document.getElementById('admin-sponsors-list').value.split('\n');
        var sponsors = [];
        lines.forEach(function (line) {
          line = line.trim();
          if (!line) return;
          var match = line.match(/^(.+?)(?:\s*\[(.*?)\])?(?:\s*\((.*?)\))?\s*$/);
          if (match) {
            sponsors.push({ name: match[1].trim(), level: (match[2] || '').trim(), url: (match[3] || '').trim() });
          }
        });
        api('/api/admin/sponsors', { method: 'POST', body: JSON.stringify({ sponsors: sponsors }) }).then(function (result) {
          if (result.data.ok) { adminFeedback('保存成功', 'success'); } else { adminFeedback(result.data.error || '保存失败', 'error'); }
        });
      });
    });
  }

  function adminTag(item, keyPrefix) {
    var isOwner = item[keyPrefix + 'IsOwner'];
    var role = item[keyPrefix + 'Role'];
    var badgeText = item[keyPrefix + 'AdminBadgeText'];
    if (isOwner) return '<span class="ml-1 inline-flex items-center rounded-full bg-[var(--playarg-accent-purple)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--playarg-accent-purple)]">站主</span>';
    if (role === 'admin') return '<span class="ml-1 inline-flex items-center rounded-full bg-[var(--playarg-accent-purple)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--playarg-accent-purple)]">' + escapeHtml(badgeText || '管理员') + '</span>';
    return '';
  }
  function usernameClass(item, keyPrefix) {
    return (item[keyPrefix + 'IsOwner'] || item[keyPrefix + 'Role'] === 'admin') ? 'text-[var(--playarg-accent-purple)]' : 'text-[var(--playarg-primary)]';
  }

  function renderDiscussionList(list) {
    if (!list.length) return '<div class="rounded-md border border-[var(--playarg-border)] p-4 text-center text-sm text-[var(--playarg-muted-foreground)]">暂无讨论帖</div>';
    return list.map(function (d) {
      var pinnedLabel = d.pinned ? '<span class="mr-1 rounded bg-[var(--playarg-primary)] px-1 py-0.5 text-[10px] font-medium text-[var(--playarg-primary-foreground)]">置顶</span>' : '';
      return '<div class="flex items-center justify-between rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 py-2">' +
        '<div class="min-w-0 flex-1"><div class="truncate text-sm font-medium text-[var(--playarg-foreground)]">' + pinnedLabel + escapeHtml(d.title) + '</div>' +
        '<div class="text-xs text-[var(--playarg-muted-foreground)]">作者 <span class="font-medium ' + usernameClass(d, 'author') + '">' + escapeHtml(d.author) + adminTag(d, 'author') + '</span> · 回复 ' + (d.replyCount || 0) + '</div></div>' +
        '<div class="ml-2 flex flex-wrap justify-end gap-1"><button class="admin-discussion-pin h-7 rounded-md border border-[var(--playarg-border)] px-2 text-xs text-[var(--playarg-foreground)] hover:bg-[var(--playarg-muted)]" data-id="' + d.id + '" data-pinned="' + (d.pinned ? '1' : '0') + '">' + (d.pinned ? '取消置顶' : '置顶') + '</button>' +
        '<button class="admin-discussion-edit h-7 rounded-md border border-[var(--playarg-border)] px-2 text-xs text-[var(--playarg-foreground)] hover:bg-[var(--playarg-muted)]" data-id="' + d.id + '">编辑</button>' +
        '<button class="admin-discussion-delete h-7 rounded-md border border-[var(--playarg-state-error)]/30 px-2 text-xs text-[var(--playarg-state-error)] hover:bg-[var(--playarg-state-error)]/10" data-id="' + d.id + '">删除</button></div>' +
      '</div>';
    }).join('');
  }

  function openDiscussionsAdmin() {
    api('/api/admin/discussions', { method: 'POST', body: JSON.stringify({ action: 'list' }) }).then(function (result) {
      var list = (result.data && result.data.data) || [];
      var html = '<div id="admin-discussion-list" class="space-y-2">' + renderDiscussionList(list) + '</div>' +
        '<div id="admin-discussion-form" class="mt-4 hidden rounded-lg border border-[var(--playarg-border)] p-4">' +
          '<h4 class="mb-3 text-sm font-medium text-[var(--playarg-foreground)]" id="admin-discussion-form-title">编辑讨论帖</h4>' +
          '<input id="admin-discussion-id" type="hidden" />' +
          adminInput('admin-discussion-title', '标题', '') +
          adminTextarea('admin-discussion-content', '正文', '', 5) +
          adminInput('admin-discussion-tags', '标签（逗号分隔）', '') +
          '<div class="flex gap-2"><button id="admin-discussion-save" class="h-9 rounded-md bg-[var(--playarg-primary)] px-4 text-sm font-medium text-[var(--playarg-primary-foreground)]">保存</button>' +
          '<button id="admin-discussion-cancel" class="h-9 rounded-md border border-[var(--playarg-border)] px-4 text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]">取消</button></div>' +
        '</div>';
      openAdminModal('管理讨论帖', html, '');
      bindDiscussionAdmin(list);
    });
  }

  function bindDiscussionAdmin(list) {
    document.getElementById('admin-discussion-cancel').addEventListener('click', function () {
      document.getElementById('admin-discussion-form').classList.add('hidden');
    });
    document.getElementById('admin-discussion-save').addEventListener('click', function () {
      var id = document.getElementById('admin-discussion-id').value;
      var title = document.getElementById('admin-discussion-title').value.trim();
      var content = document.getElementById('admin-discussion-content').value.trim();
      var tags = document.getElementById('admin-discussion-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      api('/api/admin/discussions', { method: 'POST', body: JSON.stringify({ action: 'update', id: id, title: title, content: content, tags: tags }) }).then(function (result) {
        if (result.data.ok) {
          adminFeedback('保存成功', 'success');
          openDiscussionsAdmin();
        } else {
          adminFeedback(result.data.error || '保存失败', 'error');
        }
      });
    });
    document.querySelectorAll('.admin-discussion-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = list.find(function (x) { return String(x.id) === btn.dataset.id; });
        if (!d) return;
        document.getElementById('admin-discussion-form').classList.remove('hidden');
        document.getElementById('admin-discussion-id').value = d.id;
        document.getElementById('admin-discussion-title').value = d.title || '';
        document.getElementById('admin-discussion-content').value = d.content || '';
        document.getElementById('admin-discussion-tags').value = (d.tags || []).join(', ');
      });
    });
    document.querySelectorAll('.admin-discussion-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('确定删除该讨论帖？')) return;
        api('/api/admin/discussions', { method: 'POST', body: JSON.stringify({ action: 'delete', id: btn.dataset.id }) }).then(function (result) {
          if (result.data.ok) {
            adminFeedback('删除成功', 'success');
            openDiscussionsAdmin();
          } else {
            adminFeedback(result.data.error || '删除失败', 'error');
          }
        });
      });
    });
    document.querySelectorAll('.admin-discussion-pin').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.pinned === '1' ? 'unpin' : 'pin';
        api('/api/admin/discussions', { method: 'POST', body: JSON.stringify({ action: action, id: btn.dataset.id }) }).then(function (result) {
          if (result.data.ok) {
            adminFeedback(action === 'pin' ? '置顶成功' : '取消置顶成功', 'success');
            openDiscussionsAdmin();
          } else {
            adminFeedback(result.data.error || '操作失败', 'error');
          }
        });
      });
    });
  }

  function renderFeedList(list) {
    if (!list.length) return '<div class="rounded-md border border-[var(--playarg-border)] p-4 text-center text-sm text-[var(--playarg-muted-foreground)]">暂无犇犇</div>';
    return list.map(function (f) {
      return '<div class="flex items-center justify-between rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-background)] px-3 py-2">' +
        '<div class="min-w-0 flex-1"><div class="truncate text-sm font-medium text-[var(--playarg-foreground)]">' + escapeHtml(f.content) + '</div>' +
        '<div class="text-xs text-[var(--playarg-muted-foreground)]"><span class="font-medium ' + usernameClass(f, 'username') + '">' + escapeHtml(f.username) + adminTag(f, 'username') + '</span> · ' + escapeHtml(f.createdAt) + '</div></div>' +
        '<button class="admin-feed-delete h-7 rounded-md border border-[var(--playarg-state-error)]/30 px-2 text-xs text-[var(--playarg-state-error)] hover:bg-[var(--playarg-state-error)]/10" data-id="' + f.id + '">删除</button>' +
      '</div>';
    }).join('');
  }

  function openFeedAdmin() {
    api('/api/admin/feed', { method: 'POST', body: JSON.stringify({ action: 'list' }) }).then(function (result) {
      var list = (result.data && result.data.data) || [];
      var html = '<div id="admin-feed-list" class="space-y-2">' + renderFeedList(list) + '</div>';
      openAdminModal('管理犇犇', html, '');
      document.querySelectorAll('.admin-feed-delete').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('确定删除这条犇犇？')) return;
          api('/api/admin/feed', { method: 'POST', body: JSON.stringify({ action: 'delete', id: btn.dataset.id }) }).then(function (result) {
            if (result.data.ok) {
              adminFeedback('删除成功', 'success');
              openFeedAdmin();
            } else {
              adminFeedback(result.data.error || '删除失败', 'error');
            }
          });
        });
      });
    });
  }

  function renderAdminIndicator() {
    var user = getUser();
    var header = document.querySelector('header');
    if (!header) return;
    var existing = document.getElementById('admin-panel-badge');
    if (user && user.role === 'admin' && isAdminMode()) {
      if (!existing) {
        var badge = document.createElement('div');
        badge.id = 'admin-panel-badge';
        badge.className = 'mr-3 hidden items-center gap-1.5 rounded-md border border-[var(--playarg-accent-purple)]/30 bg-[var(--playarg-accent-purple)]/10 px-2.5 py-1 text-xs font-medium text-[var(--playarg-accent-purple)] md:flex';
        badge.innerHTML = '<i data-lucide="shield" class="h-3.5 w-3.5"></i> 管理面板';
        var nav = header.querySelector('nav');
        if (nav && nav.parentNode) nav.parentNode.insertBefore(badge, nav);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function updateNavBadges() {
    var user = getUser();
    var nb = document.getElementById('nav-notifications-badge');
    var mb = document.getElementById('nav-messages-badge');
    if (!user) {
      if (nb) nb.classList.add('hidden');
      if (mb) mb.classList.add('hidden');
      return;
    }
    api('/api/notifications').then(function (result) {
      if (result.data.ok) {
        if (nb) {
          if (result.data.unread) {
            nb.textContent = result.data.unread > 99 ? '99+' : result.data.unread;
            nb.classList.remove('hidden');
          } else {
            nb.classList.add('hidden');
          }
        }
      }
    }).catch(function () {});
    api('/api/messages?contacts=1').then(function (result) {
      if (result.data.ok) {
        var total = (result.data.data || []).reduce(function (s, c) { return s + (c.unread || 0); }, 0);
        if (mb) {
          if (total) {
            mb.textContent = total > 99 ? '99+' : total;
            mb.classList.remove('hidden');
          } else {
            mb.classList.add('hidden');
          }
        }
      }
    }).catch(function () {});
  }

  function renderAuth() {
    var root = document.getElementById('auth-root');
    if (!root) return;
    var user = getUser();

    if (user) {
      var userId = user.id || user.uid;
      var isOwner = user.isOwner || userId === 3 || String(userId) === '3';
      var isAdminOrOwner = user.role === 'admin' || isOwner;
      var nameClass = isAdminOrOwner ? 'text-[var(--playarg-accent-purple)]' : 'text-[var(--playarg-primary)]';
      var roleBadge = isOwner ? '<span class="ml-1 inline-flex items-center rounded-full bg-[var(--playarg-accent-purple)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--playarg-accent-purple)]">站主</span>' : (user.role === 'admin' ? '<span class="ml-1 inline-flex items-center rounded-full bg-[var(--playarg-accent-purple)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--playarg-accent-purple)]">' + escapeHtml(user.adminBadgeText || '管理员') + '</span>' : '');
      root.innerHTML =
        '<div class="relative" id="user-menu">' +
          '<button id="user-menu-btn" class="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-[var(--playarg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--playarg-ring)]">' +
            '<div class="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--playarg-muted)] text-[var(--playarg-foreground)]">' +
              '<i data-lucide="user" class="h-4 w-4"></i>' +
            '</div>' +
            '<span class="hidden max-w-[100px] truncate font-medium ' + nameClass + ' sm:inline">' + escapeHtml(user.username) + roleBadge + '</span>' +
            '<i data-lucide="chevron-down" class="h-3.5 w-3.5 text-[var(--playarg-muted-foreground)]"></i>' +
          '</button>' +
          '<div id="user-dropdown" class="absolute right-0 top-full mt-1 hidden w-52 rounded-md border border-[var(--playarg-border)] bg-[var(--playarg-card)] py-1 shadow-lg">' +
            '<div class="border-b border-[var(--playarg-border)] px-4 py-2">' +
              '<div class="flex items-center text-sm font-medium ' + nameClass + '">' + escapeHtml(user.username) + roleBadge + '</div>' +
              '<div class="font-mono text-xs text-[var(--playarg-muted-foreground)]">UID: ' + (userId || '—') + '</div>' +
            '</div>' +
            '<a id="profile-link" href="/user/' + (userId || '') + '" class="block px-4 py-2 text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]">个人主页</a>' +
            '<a href="/user/setting" class="block px-4 py-2 text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]">个人设置</a>' +
            (user.role === 'admin' ?
              '<button id="admin-mode-toggle" class="w-full px-4 py-2 text-left text-sm text-[var(--playarg-accent-purple)] transition-colors hover:bg-[var(--playarg-muted)]">' +
                (isAdminMode() ? '退出管理员模式' : '管理员模式') +
              '</button>' +
              '<a href="/admin" class="block px-4 py-2 text-sm text-[var(--playarg-accent-purple)] transition-colors hover:bg-[var(--playarg-muted)]">进入管理后台</a>' +
              '<div class="my-1 border-t border-[var(--playarg-border)]"></div>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="announcements">发布公告</button>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="problems">添加/编辑题目</button>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="permissions">管理用户权限</button>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="contests">审核比赛</button>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="banner">设置首页 Banner/广告</button>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="sponsors">设置赞助/鸣谢</button>' +
              '<div class="my-1 border-t border-[var(--playarg-border)]"></div>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="discussions">管理讨论帖</button>' +
              '<button class="admin-action w-full px-4 py-2 text-left text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)]" data-action="feed">管理犇犇</button>' +
              '<button id="admin-delete-user" class="w-full px-4 py-2 text-left text-sm text-[var(--playarg-state-error)] transition-colors hover:bg-[var(--playarg-muted)]">注销用户</button>'
            : '') +
            '<div class="my-1 border-t border-[var(--playarg-border)]"></div>' +
            '<button id="logout-btn" class="w-full px-4 py-2 text-left text-sm text-[var(--playarg-state-error)] transition-colors hover:bg-[var(--playarg-muted)]">退出登录</button>' +
          '</div>' +
        '</div>';
    } else {
      root.innerHTML =
        '<div class="flex items-center gap-2">' +
          '<button id="btn-login" class="h-9 rounded-md border border-[var(--playarg-border)] px-3 text-sm text-[var(--playarg-foreground)] transition-colors hover:bg-[var(--playarg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--playarg-ring)]">登录</button>' +
          '<button id="btn-register" class="h-9 rounded-md bg-[var(--playarg-primary)] px-3 text-sm font-medium text-[var(--playarg-primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--playarg-ring)]">注册</button>' +
        '</div>';
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    bindAuthEvents();
    renderAdminIndicator();
  }

  function bindAuthEvents() {
    var btnLogin = document.getElementById('btn-login');
    var btnRegister = document.getElementById('btn-register');
    var logoutBtn = document.getElementById('logout-btn');
    var userMenuBtn = document.getElementById('user-menu-btn');
    var dropdown = document.getElementById('user-dropdown');
    var adminToggle = document.getElementById('admin-mode-toggle');
    var adminDeleteUser = document.getElementById('admin-delete-user');
    var profileLink = document.getElementById('profile-link');

    if (btnLogin) btnLogin.addEventListener('click', function () { openModal('login'); });
    if (btnRegister) btnRegister.addEventListener('click', function () { openModal('register'); });

    if (profileLink) {
      profileLink.addEventListener('click', function (e) {
        var href = profileLink.getAttribute('href');
        if (!href || href === '/user/' || href === '/user/undefined' || href === '/user/null') {
          e.preventDefault();
          alert('无法获取用户 ID，请重新登录');
          return;
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        api('/api/logout', { method: 'POST' }).finally(function () {
          setUser(null);
          setAdminMode(false);
          renderAuth();
        });
      });
    }

    if (userMenuBtn && dropdown) {
      userMenuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', function (e) {
        if (!dropdown.contains(e.target) && e.target !== userMenuBtn) {
          dropdown.classList.add('hidden');
        }
      });
    }

    if (adminToggle) {
      adminToggle.addEventListener('click', function () {
        var next = !isAdminMode();
        setAdminMode(next);
        renderAuth();
      });
    }

    document.querySelectorAll('.admin-action').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.action;
        if (action === 'announcements') openAnnouncementsAdmin();
        else if (action === 'problems') openProblemsAdmin();
        else if (action === 'permissions') openPermissionsAdmin();
        else if (action === 'contests') openContestsAdmin();
        else if (action === 'banner') openBannerAdmin();
        else if (action === 'sponsors') openSponsorsAdmin();
        else if (action === 'discussions') openDiscussionsAdmin();
        else if (action === 'feed') openFeedAdmin();
        else showAdminToast(action);
      });
    });

    if (adminDeleteUser) {
      adminDeleteUser.addEventListener('click', function () {
        var input = prompt('请输入要注销的用户 UID（数字）:');
        if (!input) return;
        var uid = parseInt(input, 10);
        if (isNaN(uid)) {
          alert('UID 必须是数字');
          return;
        }
        api('/api/admin/delete-user', {
          method: 'POST',
          body: JSON.stringify({ uid: uid })
        }).then(function (result) {
          if (result.data.ok) {
            alert('用户 ' + uid + ' 已注销');
            var current = getUser();
            var currentId = current && (current.id || current.uid);
            if (currentId === uid) {
              setUser(null);
              setAdminMode(false);
            }
            renderAuth();
          } else {
            alert('注销失败: ' + (result.data.error || '未知错误'));
          }
        });
      });
    }
  }

  function init() {
    createModal();
    injectThemeStyles();
    applyTheme(getTheme());
    renderThemeToggle();
    api('/api/me', { method: 'GET' }).then(function (result) {
      if (result.data.ok && result.data.data) {
        setUser(result.data.data);
      } else {
        // Session expired or invalid: clear stale localStorage state
        setUser(null);
        setAdminMode(false);
      }
      renderAuth();
      updateNavBadges();
      setInterval(updateNavBadges, 30000);
    }).catch(function () {
      setUser(null);
      setAdminMode(false);
      renderAuth();
      updateNavBadges();
      setInterval(updateNavBadges, 30000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
