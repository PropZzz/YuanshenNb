// “我的”页实时数据模块：按卡片顺序把档案头卡、趋势图、履约率环、
// 时间结构环、番茄钟偏好、免打扰策略、数据同步、外观快捷键与数据主权
// 卡接入后端真实接口（/profile/summary、/settings、/sync/status 等）。
//
// 遵循 calendar.js / focus.js 的契约：由 router 挂载到当前屏幕 iframe
// 的 document 上，传入已认证的 request 助手；挂载后立即渲染，无数据的
// 指标显示“暂无数据”，不回退到任何虚构数值。
((scope) => {
  const pad = (n) => String(n).padStart(2, '0');
  const AVATAR_HUES = 4;

  // 与后端 PREFERENCE_INT_RANGES 对齐的取值范围，用于 stepper 步进边界。
  const STEP_RANGES = {
    pomodoroShortBreakMinutes: [1, 30],
    pomodoroLongBreakMinutes: [5, 60],
    pomodoroCycles: [2, 8],
  };

  const styleText = `
    .profile-avatar { background: linear-gradient(135deg, #2f6d6b, #12302f); }
    .profile-avatar[data-avatar-hue="1"] { background: linear-gradient(135deg, #2b62a0, #12325e); }
    .profile-avatar[data-avatar-hue="2"] { background: linear-gradient(135deg, #2e7d4f, #143d26); }
    .profile-avatar[data-avatar-hue="3"] { background: linear-gradient(135deg, #5a6b74, #26333b); }
    .profile-stepper-btn { width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;
      background: #e3e2e7; color: #414848; font: 600 13px/1 Inter, system-ui, sans-serif; border: 0; cursor: pointer; }
    .profile-stepper-btn:hover { background: #dbd9df; color: #1a1b1f; }
    .profile-stepper-btn:disabled { opacity: .45; cursor: not-allowed; }
    .profile-mute-chip button { border: 0; background: none; cursor: pointer; padding: 0; display: inline-flex; color: #717978; }
    .profile-mute-chip button:hover { color: #ba1a1a; }
    #profile-badge-dialog, #profile-security-dialog { width: min(430px, calc(100vw - 32px)); border: 1px solid #c0c8c7; border-radius: 14px;
      padding: 24px; color: #1a1b1f; background: #fff; box-shadow: 0 16px 40px rgba(16,27,29,.22); }
    #profile-badge-dialog::backdrop, #profile-security-dialog::backdrop { background: rgba(16,27,29,.42); backdrop-filter: blur(4px); }
    [data-focus-chart-svg] rect, [data-focus-chart-svg] circle { transition: y 400ms ease, height 400ms ease, cy 400ms ease; }
  `;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function storedUser() {
    try {
      return JSON.parse(localStorage.getItem('ruanchuang_user') || '{}');
    } catch (_) {
      return {};
    }
  }

  function formatMinutes(minutes) {
    if (!minutes) return '0h';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours}h${rest ? ` ${pad(rest)}m` : ''}` : `${rest}m`;
  }

  function resistanceNote(value) {
    if (value == null) return '暂无数据';
    if (value >= 0.9) return '/ 1.00 (优异)';
    if (value >= 0.75) return '/ 1.00 (良好)';
    if (value >= 0.6) return '/ 1.00 (波动)';
    return '/ 1.00 (需改善)';
  }

  function mount(document, options = {}) {
    const request = options.request || (async () => { throw new Error('后端接口不可用'); });
    // 数据副本导出走 blob 下载，需要原始 API 地址（与 router 的 apiBase 同源）。
    const apiBase = String(options.apiBase || '/api').replace(/\/$/, '');
    const notify = options.notify || (() => {});
    const navigate = options.navigate || (() => {});
    let preferences = null;
    let summary = null;
    let security = null;
    let saveTimers = {};
    let disposed = false;

    if (!document.getElementById('ruanchuang-profile-inline-styles')) {
      const style = document.createElement('style');
      style.id = 'ruanchuang-profile-inline-styles';
      style.textContent = styleText;
      document.head.appendChild(style);
    }

    // ── 偏好保存：按键合并写入 /settings，滑杆等高频操作走防抖 ──
    async function savePreference(patch, { quiet = false } = {}) {
      try {
        const saved = await request('/settings', { method: 'PUT', body: { preferences: patch } });
        preferences = saved?.preferences || preferences;
        if (!quiet) notify('偏好已保存并同步到账户。');
        return true;
      } catch (error) {
        notify(`保存失败：${error.message || '后端不可用'}`);
        return false;
      }
    }

    function queuePreference(key, value, delay = 500) {
      clearTimeout(saveTimers[key]);
      saveTimers[key] = setTimeout(() => { if (!disposed) savePreference({ [key]: value }, { quiet: true }); }, delay);
    }

    // ── 卡片1：档案头卡 ──
    function renderIdentity() {
      const user = storedUser();
      const name = user.displayName || '访客';
      const accountId = String(user.id || security?.accountId || '');

      for (const avatar of document.querySelectorAll('[data-profile-avatar], [data-profile-avatar-mini]')) {
        avatar.dataset.avatarHue = String(
          [...name].reduce((acc, char) => acc + char.codePointAt(0), 0) % AVATAR_HUES,
        );
        const glyph = avatar.querySelector('[data-avatar-glyph]');
        if (glyph) glyph.textContent = [...name][0] || '时';
      }

      const uidChip = document.querySelector('[data-profile-uid]');
      if (uidChip) {
        uidChip.textContent = accountId ? `UID: TX-${accountId.slice(0, 6).toUpperCase()}` : 'UID: 本地访客';
      }

      const createdAt = security?.createdAt ? String(security.createdAt).slice(0, 10) : null;
      const subtitle = document.querySelector('[data-profile-subtitle]');
      if (subtitle) {
        subtitle.textContent = createdAt
          ? `本地优先账号 · ${createdAt.slice(0, 4)}年${Number(createdAt.slice(5, 7))}月加入`
          : '本地优先账号 · 专注 / 规划 / 复盘';
      }

      const level = summary?.level;
      const levelBadge = document.querySelector('[data-profile-level]');
      if (levelBadge && level) {
        levelBadge.textContent = `${level.title} Lv.${level.level}`;
        levelBadge.title = level.nextLevelHours == null
          ? '已达到当前最高等级'
          : `累计专注 ${level.nextLevelHours} 小时后升入下一等级`;
      }
    }

    function renderMetrics() {
      if (!summary) return;
      const setValue = (key, value, note) => {
        const node = document.querySelector(`[data-metric="${key}"] [data-metric-value]`);
        if (node) node.textContent = value;
        if (note !== undefined) {
          const noteNode = document.querySelector(`[data-metric="${key}"] [data-metric-note]`);
          if (noteNode) noteNode.textContent = note;
        }
      };
      setValue('streak', String(summary.streakDays), '按专注结算日连续统计');
      setValue('flow', summary.totalFocusHours.toLocaleString('zh-CN', { maximumFractionDigits: 1 }), '小时 · 累计结算');
      setValue('energy', `${summary.energy.batteryPercent}%`);
      const energyLabel = document.querySelector('[data-metric="energy"] [data-metric-energy-label]');
      if (energyLabel) {
        energyLabel.textContent = summary.energy.label;
        energyLabel.hidden = false;
        energyLabel.title = summary.energy.source === 'default'
          ? '暂无能量采样，显示默认基准值；可在“情绪与能量”页打卡后获得真实数值'
          : '来自最近一次能量采样';
      }
      setValue('resistance', summary.resistanceIndex == null ? '--' : summary.resistanceIndex.toFixed(2), resistanceNote(summary.resistanceIndex));
    }

    // ── 卡片2a：7 天趋势（柱状 + 维持率折线） ──
    function renderChart() {
      const svg = document.querySelector('[data-focus-chart-svg]');
      const labels = document.querySelector('[data-focus-chart-labels]');
      if (!svg || !summary) return;
      const series = summary.weeklySeries || [];
      const maxMinutes = Math.max(1, ...series.map((point) => point.minutes));
      const peakDay = summary.peakSession?.day;
      const namespace = 'http://www.w3.org/2000/svg';
      const build = (tag, attributes) => {
        const node = document.createElementNS(namespace, tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        return node;
      };

      svg.textContent = '';
      for (const y of [30, 80, 130]) {
        svg.appendChild(build('line', {
          x1: 0, x2: 540, y1: y, y2: y,
          stroke: 'currentColor', 'stroke-dasharray': '3 3',
          class: 'text-surface-variant',
        }));
      }

      const linePoints = [];
      series.forEach((point, index) => {
        const x = 25 + index * 75;
        const height = Math.round((point.minutes / maxMinutes) * 125);
        const bar = build('rect', {
          x, width: 28, rx: 4,
          y: 150 - height, height,
          class: point.minutes > 0
            ? (point.day === peakDay ? 'fill-primary-container' : 'fill-primary-container/80')
            : 'fill-surface-variant',
        });
        svg.appendChild(bar);

        if (point.retention != null) {
          const cy = 150 - (point.retention / 100) * 120;
          linePoints.push({ x: x + 14, y: Math.round(cy) });
        }

        const label = document.createElement('span');
        label.textContent = point.isToday ? `${point.label}★` : point.label;
        label.className = point.isToday ? 'text-primary font-bold' : '';
        labels?.appendChild(label);
      });

      if (linePoints.length > 1) {
        // 中点二次贝塞尔：与原设计的平滑曲线视觉一致，且对任意数据稳定。
        const path = [`M ${linePoints[0].x} ${linePoints[0].y}`];
        for (let index = 1; index < linePoints.length; index++) {
          const previous = linePoints[index - 1];
          const current = linePoints[index];
          const midX = (previous.x + current.x) / 2;
          const midY = (previous.y + current.y) / 2;
          path.push(`Q ${previous.x} ${previous.y}, ${midX} ${midY}`);
        }
        const last = linePoints[linePoints.length - 1];
        path.push(`L ${last.x} ${last.y}`);
        svg.appendChild(build('path', {
          d: path.join(' '), fill: 'none', stroke: 'currentColor',
          'stroke-linecap': 'round', 'stroke-width': 3, class: 'text-secondary',
        }));
        for (const [index, point] of linePoints.entries()) {
          svg.appendChild(build('circle', {
            cx: point.x, cy: point.y, r: index === linePoints.length - 1 ? 5 : 3.5,
            'stroke-width': 2, class: 'fill-surface stroke-secondary', stroke: 'currentColor',
          }));
        }
      }

      const banner = document.querySelector('[data-peak-banner]');
      const peakText = document.querySelector('[data-peak-text]');
      const peakMeta = document.querySelector('[data-peak-meta]');
      const peak = summary.peakSession;
      if (peak && peakText && peakMeta) {
        peakText.textContent = `${peak.weekday}${peak.start ? ` ${peak.start}` : ''}${peak.end ? ` - ${peak.end}` : ''} 记录到本周心流波峰`;
        peakMeta.textContent = `${peak.minutes} min · ${peak.interruptions ? `${peak.interruptions} 次中断` : '零干扰中断'}`;
        if (banner) banner.hidden = false;
      } else if (peakText && peakMeta) {
        peakText.textContent = '本周还没有专注结算记录，去专注页完成第一个番茄钟吧';
        peakMeta.textContent = '开始专注后自动生成';
      }
    }

    // ── 卡片2b：微任务履约率环 ──
    function renderCycle() {
      if (!summary) return;
      const cycle = summary.microtaskCycle;
      const thisWeek = cycle?.thisWeek || { created: 0, completed: 0, rate: null };
      const ratePath = document.querySelector('[data-cycle-rate-ring]');
      const center = document.querySelector('[data-cycle-rate-center]');
      const copy = document.querySelector('[data-cycle-rate-copy]');
      const delta = document.querySelector('[data-cycle-rate-delta]');

      const rateValue = document.querySelector('[data-cycle-rate-value]');
      if (ratePath) ratePath.setAttribute('stroke-dasharray', `${thisWeek.rate ?? 0}, 100`);
      if (rateValue) rateValue.textContent = thisWeek.rate == null ? '--' : `${thisWeek.rate}%`;
      if (center) center.textContent = thisWeek.created > 0 ? `${thisWeek.completed}/${thisWeek.created}` : '--';
      if (copy) {
        copy.innerHTML = thisWeek.created > 0
          ? `本周下发 <span class="font-bold text-on-surface">${thisWeek.created}</span> · 准时完结 <span class="font-bold text-secondary">${thisWeek.completed}</span>`
          : '本周还没有新建微任务，在微任务页添加后开始统计';
      }
      if (delta) {
        if (cycle?.rateDelta != null) {
          const up = cycle.rateDelta >= 0;
          delta.hidden = false;
          delta.innerHTML = `<span class="material-symbols-outlined text-[13px]">${up ? 'trending_up' : 'trending_down'}</span> 履约率较上周 ${up ? '+' : ''}${cycle.rateDelta}%`;
          delta.classList.toggle('text-tertiary-fixed-dim', up);
          delta.classList.toggle('text-error', !up);
        } else {
          delta.hidden = true;
        }
      }
    }

    // ── 卡片2c：认知时间结构环形图 ──
    function renderStructure() {
      if (!summary) return;
      const structure = summary.timeStructure;
      const donut = document.querySelector('[data-structure-donut]');
      const legend = document.querySelector('[data-structure-legend]');
      const total = document.querySelector('[data-structure-total]');
      const colors = ['text-primary-container', 'text-secondary', 'text-on-tertiary-container', 'text-outline-variant', 'text-primary'];
      const dots = ['bg-primary-container', 'bg-secondary', 'bg-on-tertiary-container', 'bg-outline-variant', 'bg-primary'];

      if (donut) {
        donut.textContent = '';
        const namespace = 'http://www.w3.org/2000/svg';
        const segments = structure?.segments || [];
        let offset = 0;
        segments.forEach((segment, index) => {
          const circle = document.createElementNS(namespace, 'circle');
          circle.setAttribute('cx', 18);
          circle.setAttribute('cy', 18);
          circle.setAttribute('r', 14);
          circle.setAttribute('fill', 'none');
          circle.setAttribute('stroke-width', 5);
          circle.setAttribute('stroke-dasharray', `${segment.percent} 100`);
          circle.setAttribute('stroke-dashoffset', String(-offset));
          circle.setAttribute('class', colors[index % colors.length]);
          circle.setAttribute('stroke', 'currentColor');
          donut.appendChild(circle);
          offset += segment.percent;
        });
        if (!segments.length) {
          const base = document.createElementNS(namespace, 'circle');
          base.setAttribute('cx', 18);
          base.setAttribute('cy', 18);
          base.setAttribute('r', 14);
          base.setAttribute('fill', 'none');
          base.setAttribute('stroke-width', 5);
          base.setAttribute('class', 'text-surface-container-high');
          base.setAttribute('stroke', 'currentColor');
          donut.appendChild(base);
        }
      }

      if (legend) {
        legend.textContent = '';
        const segments = structure?.segments || [];
        if (!segments.length) {
          const empty = document.createElement('div');
          empty.className = 'text-xs text-outline';
          empty.textContent = '本周暂无专注结算记录';
          legend.appendChild(empty);
        }
        segments.forEach((segment, index) => {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between';
          row.innerHTML = `
            <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${dots[index % dots.length]}"></span> ${escapeHtml(segment.tag)}</span>
            <span class="font-mono font-semibold text-on-surface">${segment.percent}%</span>`;
          row.title = `${formatMinutes(segment.minutes)} · ${segment.minutes} 分钟`;
          legend.appendChild(row);
        });
      }

      if (total) {
        total.textContent = (structure?.totalHours ?? 0) > 0
          ? `总计时 ${structure.totalHours}h`
          : '总计时 --';
      }
    }

    // ── 卡片3.1：番茄钟 ──
    function renderPomodoro() {
      if (!preferences) return;
      const slider = document.getElementById('profile-focus-slider');
      const valueLabel = document.getElementById('profile-focus-value');
      if (slider) {
        slider.disabled = false;
        slider.value = String(preferences.pomodoroFocusMinutes);
        if (valueLabel) valueLabel.textContent = `${preferences.pomodoroFocusMinutes} 分钟`;
      }
      for (const key of ['pomodoroShortBreakMinutes', 'pomodoroLongBreakMinutes', 'pomodoroCycles']) {
        const valueNode = document.querySelector(`[data-pref-value="${key}"]`);
        if (valueNode) valueNode.textContent = key === 'pomodoroCycles'
          ? `每 ${preferences[key]} 循环触发`
          : `${preferences[key]} 分钟`;
        const [minimum, maximum] = STEP_RANGES[key];
        for (const button of document.querySelectorAll(`[data-pref-step="${key}"]`)) {
          const step = Number(button.dataset.step || 1);
          const next = preferences[key] + step;
          button.disabled = next < minimum || next > maximum;
        }
      }
      const autoNext = document.getElementById('profile-auto-next');
      if (autoNext) autoNext.checked = preferences.pomodoroAutoStart === true;
      const sound = document.getElementById('profile-focus-sound');
      if (sound) sound.value = preferences.focusSound || 'deep-theta';
    }

    // ── 卡片3.2：免打扰与静默名单 ──
    function renderDnd() {
      if (!preferences) return;
      const dnd = document.getElementById('profile-dnd-toggle');
      if (dnd) dnd.checked = preferences.doNotDisturb === true;
      const push = document.getElementById('profile-push-toggle');
      if (push) push.checked = preferences.pushFilter === true;
      const list = document.querySelector('[data-mute-list]');
      if (list) {
        list.textContent = '';
        const apps = preferences.mutedApps || [];
        if (!apps.length) {
          const empty = document.createElement('span');
          empty.className = 'text-[11px] text-outline';
          empty.textContent = '暂无拦截项，点击“添加应用”创建';
          list.appendChild(empty);
        }
        for (const app of apps) {
          const chip = document.createElement('span');
          chip.className = 'profile-mute-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container text-xs text-on-surface-variant font-medium';
          chip.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-error"></span> ${escapeHtml(app)}
            <button type="button" title="移除 ${escapeHtml(app)}" aria-label="移除 ${escapeHtml(app)}">
              <span class="material-symbols-outlined text-[13px]">close</span>
            </button>`;
          chip.querySelector('button').addEventListener('click', async () => {
            const remaining = (preferences.mutedApps || []).filter((item) => item !== app);
            if (await savePreference({ mutedApps: remaining })) {
              preferences = { ...preferences, mutedApps: remaining };
              renderDnd();
            }
          });
          list.appendChild(chip);
        }
      }
    }

    // ── 卡片3.3：数据同步状态 ──
    async function renderSyncStatus() {
      const statusChip = document.querySelector('[data-sync-local-status]');
      const detail = document.querySelector('[data-sync-local-detail]');
      try {
        const status = await request('/sync/status');
        if (statusChip) {
          statusChip.textContent = status.changeCount > 0 ? `已记录 ${status.changeCount} 条变更` : '实时落库';
          statusChip.className = 'px-2.5 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-[11px] font-semibold';
        }
        if (detail) {
          detail.textContent = `同步游标 ${status.cursor} · 冲突 ${status.conflicts} · 供多端拉取`;
        }
      } catch (error) {
        if (statusChip) {
          statusChip.textContent = '状态不可用';
          statusChip.className = 'px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-[11px] font-semibold';
        }
        if (detail) detail.textContent = error.message || '无法读取同步状态';
      }
    }

    // ── 卡片3.4：快捷键展示 ──
    function renderShortcuts() {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      const map = {
        rescue: isMac ? '⌥ + S' : 'Alt + S',
        capture: isMac ? '⌘ + Shift + K' : 'Ctrl + Shift + K',
        board: isMac ? '⌘ + Shift + B' : 'Ctrl + Shift + B',
      };
      for (const [key, label] of Object.entries(map)) {
        const node = document.querySelector(`[data-shortcut="${key}"]`);
        if (node) node.textContent = label;
      }
    }

    // ── 卡片4：版本与指纹 ──
    async function renderFooter() {
      const versionNode = document.querySelector('[data-footer-version]');
      try {
        const health = await request('/health');
        if (versionNode) versionNode.textContent = `时序智配 Temporal Intelligence Core · 工作台内核 v${health.version}`;
      } catch (_) {
        if (versionNode) versionNode.textContent = '时序智配 Temporal Intelligence Core';
      }
      const fingerprint = document.querySelector('[data-footer-fingerprint]');
      if (fingerprint) fingerprint.textContent = '数据副本格式: ruanchuang.full-export/v1';
    }

    // ── 弹窗：数字工牌 / 安全审计 ──
    function openDialog(id, innerHtml, bind) {
      document.getElementById(id)?.remove();
      const dialog = document.createElement('dialog');
      dialog.id = id;
      dialog.innerHTML = innerHtml;
      const actions = document.createElement('div');
      actions.className = 'flex justify-end gap-2 mt-4';
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '关闭';
      close.className = 'px-4 py-2 rounded-lg bg-surface-container text-on-surface text-xs font-semibold';
      close.addEventListener('click', () => dialog.close());
      actions.appendChild(close);
      dialog.querySelector('[data-dialog-body]').appendChild(actions);
      document.body.appendChild(dialog);
      bind?.(dialog);
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      dialog.showModal();
    }

    function showBadge() {
      if (!summary) { notify('正在读取专注统计，请稍后再试'); return; }
      const user = storedUser();
      const name = user.displayName || '访客';
      const accountId = String(user.id || '');
      const createdAt = security?.createdAt ? String(security.createdAt).slice(0, 10) : '—';
      openDialog('profile-badge-dialog', `
        <div data-dialog-body class="space-y-4">
          <div class="flex items-center gap-3">
            <div data-profile-avatar class="profile-avatar w-14 h-14 rounded-full flex items-center justify-center text-on-primary font-headline font-bold text-2xl select-none" data-avatar-hue="0"><span data-avatar-glyph>${escapeHtml([...name][0] || '时')}</span></div>
            <div>
              <div class="font-headline font-bold text-lg text-on-surface">${escapeHtml(name)}</div>
              <div class="text-[11px] font-mono text-outline">${escapeHtml(accountId ? `TX-${accountId.slice(0, 6).toUpperCase()}` : '本地访客')} · ${escapeHtml(createdAt)} 签发</div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="p-3 rounded-lg bg-surface-container-low"><div class="text-outline text-[10px] uppercase tracking-wider">称号等级</div><div class="font-bold text-on-surface mt-1">${escapeHtml(summary.level.title)} Lv.${summary.level.level}</div></div>
            <div class="p-3 rounded-lg bg-surface-container-low"><div class="text-outline text-[10px] uppercase tracking-wider">连续打卡</div><div class="font-bold text-on-surface mt-1">${summary.streakDays} 天</div></div>
            <div class="p-3 rounded-lg bg-surface-container-low"><div class="text-outline text-[10px] uppercase tracking-wider">累计专注</div><div class="font-bold text-on-surface mt-1">${summary.totalFocusHours} 小时</div></div>
            <div class="p-3 rounded-lg bg-surface-container-low"><div class="text-outline text-[10px] uppercase tracking-wider">专注会话</div><div class="font-bold text-on-surface mt-1">${summary.sessionCount} 次</div></div>
          </div>
          <p class="text-[11px] text-outline leading-relaxed">工作台身份标识，全部字段来自本机账号的真实记录，不构成任何官方凭证。</p>
        </div>`, (dialog) => {
        renderIdentity();
      });
    }

    function showSecurityReport() {
      if (!security) { notify('正在读取账号信息，请稍后再试'); return; }
      const counts = security.dataCounts || {};
      const row = (label, value) => `
        <div class="flex items-center justify-between text-xs py-1.5 border-b border-surface-container last:border-0">
          <span class="text-on-surface-variant">${label}</span><span class="font-mono font-semibold text-on-surface">${escapeHtml(value == null || value === '' ? '—' : String(value))}</span>
        </div>`;
      openDialog('profile-security-dialog', `
        <div data-dialog-body class="space-y-3">
          <div class="font-headline font-bold text-lg">账号安全审计</div>
          <div>
            ${row('账号标识', security.accountId || '—')}
            ${row('登录账号', security.contactAddress || '—')}
            ${row('注册时间', security.createdAt || '—')}
            ${row('活跃会话 / 累计', `${security.activeSessions} / ${security.totalSessions}`)}
            ${row('最近会话', security.latestSessionCreatedAt || '—')}
            ${row('最近专注记录', security.lastEventAt || '—')}
            ${row('日程 / 微任务', `${counts.schedules ?? 0} / ${counts.microtasks ?? 0}`)}
            ${row('专注事件 / 目标', `${counts.task_events ?? 0} / ${counts.goals ?? 0}`)}
          </div>
          <p class="text-[11px] text-outline leading-relaxed">${escapeHtml(security.storage || '')}。所有数据可随时通过“导出完整数据副本”带走。</p>
        </div>`);
    }

    // ── 导出完整数据副本 ──
    async function exportData() {
      try {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${apiBase}/profile/export`, {
          headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `ruanchuang-export-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        notify('完整数据副本已导出为 JSON 文件。');
      } catch (error) {
        notify(`导出失败：${error.message || '后端不可用'}`);
      }
    }

    // ── ICS 日历导入 ──
    async function importIcs(file) {
      try {
        const ics = await file.text();
        const entries = await request('/schedule/import-ics', { method: 'POST', body: { ics } });
        notify(`已导入 ${Array.isArray(entries) ? entries.length : 0} 条日程，可在智能日历中查看。`);
        await renderSyncStatus();
      } catch (error) {
        notify(`导入失败：${error.message || '文件解析不通过'}`);
      }
    }

    // ── 事件绑定 ──
    function bind() {
      const slider = document.getElementById('profile-focus-slider');
      const valueLabel = document.getElementById('profile-focus-value');
      slider?.addEventListener('input', () => {
        if (valueLabel) valueLabel.textContent = `${slider.value} 分钟`;
      });
      slider?.addEventListener('change', () => {
        savePreference({ pomodoroFocusMinutes: Number(slider.value) });
      });

      for (const button of document.querySelectorAll('[data-pref-step]')) {
        button.addEventListener('click', async () => {
          if (!preferences) return;
          const key = button.dataset.prefStep;
          const step = Number(button.dataset.step || 1);
          const [minimum, maximum] = STEP_RANGES[key];
          const previous = preferences[key];
          const next = previous + step;
          if (next < minimum || next > maximum) return;
          // 乐观更新本地值，连续快速点击也能累加；保存失败时回滚重绘。
          preferences = { ...preferences, [key]: next };
          renderPomodoro();
          const ok = await savePreference({ [key]: next }, { quiet: true });
          if (!ok) {
            preferences = { ...preferences, [key]: previous };
            renderPomodoro();
          }
        });
      }

      document.getElementById('profile-auto-next')?.addEventListener('change', (event) => {
        savePreference({ pomodoroAutoStart: event.target.checked });
      });
      document.getElementById('profile-focus-sound')?.addEventListener('change', (event) => {
        savePreference({ focusSound: event.target.value });
      });

      document.getElementById('profile-dnd-toggle')?.addEventListener('change', (event) => {
        savePreference({ doNotDisturb: event.target.checked });
      });
      document.getElementById('profile-push-toggle')?.addEventListener('change', (event) => {
        savePreference({ pushFilter: event.target.checked });
      });
      document.getElementById('profile-mute-add')?.addEventListener('click', () => {
        if (!preferences) { notify('偏好尚未加载完成'); return; }
        const name = window.prompt('要拦截的应用或通知名称（最多 40 字）：');
        if (!name || !name.trim()) return;
        const trimmed = name.trim().slice(0, 40);
        if ((preferences.mutedApps || []).includes(trimmed)) { notify('该应用已在名单中'); return; }
        const next = [...(preferences.mutedApps || []), trimmed];
        savePreference({ mutedApps: next }).then((ok) => {
          if (ok) { preferences = { ...preferences, mutedApps: next }; renderDnd(); }
        });
      });

      document.querySelector('[data-sync-refresh]')?.addEventListener('click', () => {
        renderSyncStatus().then(() => notify('同步状态已刷新'));
      });

      document.getElementById('profile-ics-import')?.addEventListener('click', () => {
        document.querySelector('[data-ics-input]')?.click();
      });
      document.querySelector('[data-ics-input]')?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) importIcs(file);
        event.target.value = '';
      });

      document.getElementById('profile-badge-open')?.addEventListener('click', showBadge);
      document.getElementById('profile-security-audit')?.addEventListener('click', showSecurityReport);
      document.getElementById('profile-export-data')?.addEventListener('click', exportData);
      document.querySelector('[data-sync-now]')?.addEventListener('click', exportData);
    }

    // ── 装载 ──
    async function loadAll() {
      const identityTask = request('/profile/security')
        .then((report) => { security = report; renderIdentity(); })
        .catch(() => renderIdentity());
      const summaryTask = request('/profile/summary')
        .then((data) => { summary = data; renderIdentity(); renderMetrics(); renderChart(); renderCycle(); renderStructure(); })
        .catch(() => {
          const peakText = document.querySelector('[data-peak-text]');
          if (peakText) peakText.textContent = '专注统计暂时不可用（后端未连接或未登录）';
        });
      const settingsTask = request('/settings')
        .then((data) => { preferences = data?.preferences || null; renderPomodoro(); renderDnd(); })
        .catch(() => {
          for (const control of document.querySelectorAll(
            '#profile-focus-slider, #profile-auto-next, #profile-focus-sound, #profile-dnd-toggle, #profile-push-toggle, #profile-mute-add, [data-pref-step]',
          )) {
            control.disabled = true;
            control.title = '后端不可用时偏好开关暂停使用';
          }
        });
      renderShortcuts();
      renderFooter();
      renderSyncStatus();
      await Promise.allSettled([identityTask, summaryTask, settingsTask]);
    }

    bind();
    loadAll();

    return {
      refresh: loadAll,
      dispose() {
        disposed = true;
        for (const timer of Object.values(saveTimers)) clearTimeout(timer);
        document.getElementById('profile-badge-dialog')?.remove();
        document.getElementById('profile-security-dialog')?.remove();
      },
    };
  }

  scope.StitchProfile = Object.freeze({ mount });
})(typeof window === 'undefined' ? globalThis : window);
