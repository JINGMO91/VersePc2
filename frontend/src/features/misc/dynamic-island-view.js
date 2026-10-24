import { S } from './dynamic-island-state.js';
import { requestLazyLoad } from '../../core/lazy-loaders.js';

    function isEnabled() {
        try {
            var el = document.getElementById('vIsland');
            if (el) return !!el.checked;
            return document.body.classList.contains('v-island-enabled');
        } catch (_) { return false; }
    }

    function _clearHideTimer() {
        if (S._hideTimer) { clearTimeout(S._hideTimer); S._hideTimer = null; }
    }

    function _startHideTimer(delay) {
        _clearHideTimer();
        S._hideTimer = setTimeout(function () {
            if (S._state === 'idle' && !S._expanded && S._visible) _hide();
        }, delay || 1200);
    }

    function _ensureHoverZone() {
        if (S._hoverZone) return S._hoverZone;
        S._hoverZone = document.createElement('div');
        S._hoverZone.className = 'v-island-hover-zone';
        document.body.appendChild(S._hoverZone);

        S._hoverZone.addEventListener('mouseenter', function () {
            if (!isEnabled()) return;
            _clearHideTimer();
            if (S._hoverTimer) clearTimeout(S._hoverTimer);
            S._hoverTimer = setTimeout(function () {
                if (!S._visible && S._state === 'idle') _showIdle();
            }, 250);
        });

        S._hoverZone.addEventListener('mouseleave', function () {
            if (S._hoverTimer) { clearTimeout(S._hoverTimer); S._hoverTimer = null; }
            if (S._state === 'idle' && S._visible && !S._expanded) {
                _startHideTimer(800);
            }
        });

        return S._hoverZone;
    }

    function _ensureEl() {
        if (S._el) return S._el;
        S._el = document.createElement('div');
        S._el.id = 'v-island';
        S._el.className = 'v-island';
        S._el.innerHTML =
            '<div class="v-island__pill">' +
                '<div class="v-island__ring">' +
                    '<svg viewBox="0 0 36 36">' +
                        '<circle class="v-island__ring-track" cx="18" cy="18" r="15"/>' +
                        '<circle class="v-island__ring-fill" cx="18" cy="18" r="15"/>' +
                    '</svg>' +
                    '<img class="v-island__ring-icon" src="img/icon.svg" alt="">' +
                    '<span class="v-island__ring-num">0</span>' +
                '</div>' +
                '<div class="v-island__info">' +
                    '<div class="v-island__subtitle">点击展开</div>' +
                    '<input type="text" class="v-island__input" placeholder="问我点什么..." style="display:none">' +
                '</div>' +
                '<button class="v-island__close" title="关闭" style="display:none;">×</button>' +
                '<div class="v-island__detail"></div>' +
            '</div>';

        document.body.appendChild(S._el);

        var pill = S._el.querySelector('.v-island__pill');
        pill.addEventListener('click', function (e) {
            if (e.target.closest('.v-island__close')) {
                e.stopPropagation();
                _hide();
                return;
            }
            // 输入框已显示时，点击 pill 不切换状态（让用户能点输入框）
            if (e.target.classList && e.target.classList.contains('v-island__input')) return;
            _toggleExpand();
        });

        // 输入框回车触发对话
        var input = S._el.querySelector('.v-island__input');
        if (input) {
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.keyCode === 13) {
                    e.preventDefault();
                    e.stopPropagation();
                    var q = input.value.trim();
                    if (q) requestLazyLoad('island:ask', q);
                } else if (e.key === 'Escape' || e.keyCode === 27) {
                    _collapseChatInput();
                }
            });
            // 阻止输入框点击冒泡到 pill，并确保输入框获得焦点
            input.addEventListener('click', function (e) {
                e.stopPropagation();
                this.focus();
            });
        }

        S._el.addEventListener('mouseenter', function () {
            _clearHideTimer();
            if (S._leaveTimer) { clearTimeout(S._leaveTimer); S._leaveTimer = null; }
        });

        S._el.addEventListener('mouseleave', function () {
            if (S._state === 'idle' && S._expanded) {
                S._leaveTimer = setTimeout(function () {
                    if (S._state === 'idle' && S._expanded) _collapse();
                    if (S._state === 'idle' && S._visible) _startHideTimer(800);
                }, 600);
            } else if (S._state === 'idle' && !S._expanded && S._visible) {
                _startHideTimer(800);
            }
        });

        return S._el;
    }

    function _setRingProgress(pct) {
        if (!S._el) return;
        var offset = S._circumference - (Math.min(pct, 100) / 100) * S._circumference;
        var fill = S._el.querySelector('.v-island__ring-fill');
        if (fill) fill.style.strokeDashoffset = offset;
    }

    function _setRingNum(num) {
        if (!S._el) return;
        var numEl = S._el.querySelector('.v-island__ring-num');
        var iconEl = S._el.querySelector('.v-island__ring-icon');
        if (numEl) {
            numEl.textContent = num;
            numEl.style.display = num > 0 ? '' : 'none';
        }
        if (iconEl) {
            iconEl.style.display = num > 0 ? 'none' : '';
        }
    }

    function _getActiveTaskCount() {
        var count = 0;
        var keys = Object.keys(S._tasks);
        for (var i = 0; i < keys.length; i++) {
            var t = S._tasks[keys[i]];
            if (t.status === 'downloading') count++;
        }
        return count;
    }

    function _getTotalProgress() {
        var keys = Object.keys(S._tasks);
        if (keys.length === 0) return 0;
        var total = 0;
        var count = 0;
        for (var i = 0; i < keys.length; i++) {
            var t = S._tasks[keys[i]];
            if (t.status === 'downloading' || t.status === 'completed') {
                total += Math.max(0, Math.min(100, t.progress || 0));
                count++;
            }
        }
        return count > 0 ? Math.round(total / count) : 0;
    }

    function _esc(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _fmtSpeed(speed) {
        if (!speed || speed <= 0) return '';
        if (speed > 1024 * 1024) return (speed / 1024 / 1024).toFixed(1) + ' MB/s';
        return (speed / 1024).toFixed(0) + ' KB/s';
    }

    function _buildStageHistoryHtml(stages) {
        if (!stages || stages.length === 0) return '';
        var html = '<div class="v-island__stages">';
        for (var i = 0; i < stages.length; i++) {
            var s = stages[i];
            // 后端格式: { stage, message, progress }
            var name = s.message || s.stage || s.name || '';
            var pct = Math.round(s.progress || s.percent || 0);
            var dc = 'v-island__stage-dot';
            if (pct >= 100) dc += ' v-island__stage-dot--done';
            else if (pct > 0) dc += ' v-island__stage-dot--active';
            var pctText = pct > 0 && pct < 100 ? pct + '%' : '';
            html += '<div class="v-island__stage"><span class="' + dc + '"></span><span class="v-island__stage-name">' + _esc(name) + '</span><span class="v-island__stage-pct">' + pctText + '</span></div>';
        }
        return html + '</div>';
    }

    function _buildFilesHtml(files) {
        if (!files || files.length === 0) return '';
        var shown = files.slice(0, 8);
        var html = '<div class="v-island__files">';
        for (var i = 0; i < shown.length; i++) {
            var f = shown[i];
            // 兼容两种格式: { name, status, progress } 和 { n, s, p }
            var fname = f.name || f.n || f.filename || '';
            var fstatus = f.status || f.s || 'pending';
            var fprogress = Math.round(f.progress || f.p || 0);
            var st = '';
            if (fstatus === 'downloading') st = fprogress + '%';
            else if (fstatus === 'completed' || fstatus === 'done') st = '完成';
            else if (fstatus === 'failed') st = '失败';
            html += '<div class="v-island__file"><span class="v-island__file-name">' + _esc(fname) + '</span><span class="v-island__file-status">' + st + '</span></div>';
        }
        if (files.length > 8) {
            html += '<div class="v-island__file"><span class="v-island__file-name" style="color:var(--text-muted)">... 还有 ' + (files.length - 8) + ' 个文件</span></div>';
        }
        return html + '</div>';
    }

    function _buildTasksHtml() {
        var keys = Object.keys(S._tasks);
        if (keys.length === 0) {
            return '<div class="v-island__empty">暂无下载任务</div>';
        }

        var html = '<div class="v-island__tasks">';
        for (var i = 0; i < keys.length; i++) {
            var t = S._tasks[keys[i]];
            var pct = Math.max(0, Math.min(100, t.progress || 0));
            var statusText = '';
            var statusClass = '';

            if (t.status === 'downloading') {
                statusText = Math.round(pct) + '%';
                statusClass = 'task--downloading';
            } else if (t.status === 'completed') {
                statusText = '完成';
                statusClass = 'task--completed';
                pct = 100;
            } else if (t.status === 'failed') {
                statusText = '失败';
                statusClass = 'task--failed';
            }

            html += '<div class="v-island__task ' + statusClass + '">' +
                '<div class="v-island__task-head">' +
                    '<span class="v-island__task-name">' + _esc(t.name) + '</span>' +
                    '<span class="v-island__task-pct">' + statusText + '</span>' +
                '</div>' +
                '<div class="v-island__task-bar">' +
                    '<div class="v-island__task-bar-fill" style="width:' + pct + '%"></div>' +
                '</div>';

            // 失败时显示错误信息
            if (t.status === 'failed' && t.message) {
                html += '<div class="v-island__task-error">' + _esc(t.message) + '</div>';
            }

            // 下载中显示阶段步骤和文件列表
            if (t.status === 'downloading') {
                if (t.stageHistory && t.stageHistory.length > 0) html += _buildStageHistoryHtml(t.stageHistory);
                if (t.files && t.files.length > 0) html += _buildFilesHtml(t.files);
                else if (t.currentFile) html += '<div class="v-island__task-current">正在下载: ' + _esc(t.currentFile) + '</div>';
            }

            html += '</div>';
        }
        return html + '</div>';
    }

    function _updateDetail() {
        if (!S._expanded || !S._el) return;
        var detail = S._el.querySelector('.v-island__detail');
        if (!detail) return;
        detail.innerHTML = _buildTasksHtml();
    }

    function _refreshDisplay() {
        if (!S._el) return;
        var active = _getActiveTaskCount();
        var totalPct = _getTotalProgress();

        _setRingNum(active);
        _setRingProgress(totalPct);

        var subEl = S._el.querySelector('.v-island__subtitle');
        if (subEl) {
            if (active > 0) {
                subEl.textContent = active + ' 个任务进行中  ' + Math.round(totalPct) + '%';
            } else {
                subEl.textContent = '点击展开查看任务';
            }
        }

        if (S._expanded) _updateDetail();
    }

    function _expand() {
        S._expanded = true;
        _clearHideTimer();
        if (S._el) {
            S._el.classList.add('v-island--expanded');
            _updateDetail();
        }
    }

    function _collapse() {
        S._expanded = false;
        if (S._el) S._el.classList.remove('v-island--expanded');
    }

    function _toggleExpand() {
        // 空闲状态：点击切换对话输入框
        if (S._state === 'idle') {
            if (S._expanded) {
                _collapseChatInput();
            } else {
                _expandChatInput();
            }
            return;
        }
        // 有任务时：展开/收起进度详情（原行为）
        if (S._expanded) _collapse(); else _expand();
    }

    function _expandChatInput() {
        S._expanded = true;
        _clearHideTimer();
        if (!S._el) _ensureEl();
        S._el.classList.add('v-island--expanded', 'v-island--chat');
        var input = S._el.querySelector('.v-island__input');
        var sub = S._el.querySelector('.v-island__subtitle');
        if (sub) sub.style.display = 'none';
        if (input) {
            input.style.display = '';
            // 多次尝试聚焦，确保在 Tauri webview 中也能可靠激活输入框
            var focusAttempts = [50, 150, 300];
            focusAttempts.forEach(function (delay) {
                setTimeout(function () { input.focus(); }, delay);
            });
        }
        // 灵动岛弹出音效（Web Audio API 生成短促"啵"声）
        _playPopSound();
    }

    function _collapseChatInput() {
        if (!S._el) return;
        S._expanded = false;
        S._el.classList.remove('v-island--expanded', 'v-island--chat');
        var input = S._el.querySelector('.v-island__input');
        var sub = S._el.querySelector('.v-island__subtitle');
        if (input) { input.style.display = 'none'; input.value = ''; }
        if (sub) sub.style.display = '';
        // 回到圆环默认状态
        S._el.classList.remove('v-island--thinking');
    }

    function _getPopSoundCtx() {
        if (!S._popSoundCtx) {
            try {
                S._popSoundCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                S._popSoundCtx = null;
            }
        }
        // 浏览器可能因自动播放策略挂起 context，尝试恢复
        if (S._popSoundCtx && S._popSoundCtx.state === 'suspended') {
            S._popSoundCtx.resume().catch(function () {});
        }
        return S._popSoundCtx;
    }

    function _playPopSound() {
        try {
            var ctx = _getPopSoundCtx();
            if (!ctx) return;
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.2);
        } catch (e) {}
    }

    function _showIdle() {
        if (!isEnabled()) return;
        var el = _ensureEl();
        S._visible = true;
        S._state = 'idle';

        var subEl = el.querySelector('.v-island__subtitle');
        var closeBtn = el.querySelector('.v-island__close');
        if (subEl) {
            var active = _getActiveTaskCount();
            subEl.textContent = active > 0 ? active + ' 个任务进行中' : '点击展开查看任务';
        }
        if (closeBtn) closeBtn.style.display = 'none';

        _setRingNum(_getActiveTaskCount());
        _setRingProgress(_getTotalProgress());

        el.classList.remove('v-island--completed', 'v-island--failed', 'v-island--expanded', 'island--active');
        el.classList.add('island--idle');
        S._expanded = false;
        el.classList.add('v-island--visible');
    }

    function _hide() {
        _clearHideTimer();
        if (S._autoDismissTimer) { clearTimeout(S._autoDismissTimer); S._autoDismissTimer = null; }
        if (S._leaveTimer) { clearTimeout(S._leaveTimer); S._leaveTimer = null; }
        S._visible = false;
        S._expanded = false;
        S._state = 'idle';
        if (S._el) {
            S._el.classList.remove('v-island--visible', 'v-island--expanded', 'v-island--completed', 'v-island--failed', 'island--active', 'island--idle');
        }
    }

    function show(title) {
        if (!isEnabled()) return;
        var el = _ensureEl();
        var name = title || '导入中';
        S._currentName = name;

        // 添加任务
        if (!S._tasks[name]) {
            S._tasks[name] = { name: name, progress: 0, status: 'downloading' };
        } else {
            S._tasks[name].status = 'downloading';
            S._tasks[name].progress = 0;
        }

        S._visible = true;
        S._state = 'downloading';
        _clearHideTimer();
        if (S._autoDismissTimer) { clearTimeout(S._autoDismissTimer); S._autoDismissTimer = null; }
        if (S._leaveTimer) { clearTimeout(S._leaveTimer); S._leaveTimer = null; }

        el.classList.remove('v-island--completed', 'v-island--failed', 'v-island--expanded', 'island--idle');
        el.classList.add('v-island--visible', 'island--active');

        _refreshDisplay();
    }

    function update(data) {
        if (!isEnabled() || !S._el) return;
        if (!data) return;

        var name = data.name || S._currentName;
        if (!name || !S._tasks[name]) return;

        var task = S._tasks[name];
        if (data.progress != null) task.progress = Math.max(0, Math.min(100, data.progress));
        if (data.status) task.status = data.status;
        if (data.speed != null) task.speed = data.speed;
        if (data.message) task.message = data.message;
        if (data.stageHistory) task.stageHistory = data.stageHistory;
        if (data.files) task.files = data.files;
        if (data.currentFile) task.currentFile = data.currentFile;

        var el = S._el;

        if (data.status === 'completed') {
            task.progress = 100;
            task.status = 'completed';
            S._state = 'completed';
            el.classList.remove('v-island--failed', 'island--active', 'island--idle');
            el.classList.add('v-island--completed', 'v-island--visible');
            S._visible = true;

            var subEl = el.querySelector('.v-island__subtitle');
            if (subEl) subEl.textContent = '导入完成';
            var cb = el.querySelector('.v-island__close');
            if (cb) cb.style.display = '';

            // 3秒后移除任务并隐藏（如果没有其他活跃任务）
            (function (taskName) {
                S._autoDismissTimer = setTimeout(function () {
                    delete S._tasks[taskName];
                    if (_getActiveTaskCount() === 0) {
                        _hide();
                    } else {
                        S._state = 'downloading';
                        el.classList.remove('v-island--completed');
                        el.classList.add('island--active');
                        _refreshDisplay();
                    }
                }, 3000);
            })(name);
            _refreshDisplay();
            return;
        }

        if (data.status === 'failed') {
            task.status = 'failed';
            task.message = data.message || '未知错误';
            S._state = 'failed';
            el.classList.remove('v-island--completed', 'island--active', 'island--idle');
            el.classList.add('v-island--failed', 'v-island--visible');
            S._visible = true;

            var subEl2 = el.querySelector('.v-island__subtitle');
            if (subEl2) subEl2.textContent = (data.message || '导入失败');
            var cb2 = el.querySelector('.v-island__close');
            if (cb2) cb2.style.display = '';
            _refreshDisplay();
            return;
        }

        // 下载中
        S._state = 'downloading';
        el.classList.remove('island--idle', 'v-island--completed', 'v-island--failed');
        el.classList.add('island--active');
        _refreshDisplay();
    }

    function dismiss() {
        S._tasks = {};
        S._currentName = null;
        _hide();
    }

    function preview() {
        if (!isEnabled()) return;
        var el = _ensureEl();
        S._visible = true;
        el.classList.remove('v-island--visible', 'v-island--preview', 'v-island--completed', 'v-island--failed', 'island--active', 'island--idle');
        void el.offsetWidth;
        el.classList.add('v-island--preview', 'island--idle');

        _setRingNum(0);
        _setRingProgress(0);
        var subEl = el.querySelector('.v-island__subtitle');
        if (subEl) subEl.textContent = '鼠标移到顶部可唤出';

        el.addEventListener('animationend', function () {
            el.classList.remove('v-island--preview', 'island--idle');
            S._visible = false;
        }, { once: true });
    }

    function setupHoverZone() { _ensureHoverZone(); }

    function isVisible() { return S._visible; }

export { isEnabled, _clearHideTimer, _startHideTimer, _ensureHoverZone, _ensureEl, _setRingProgress, _setRingNum, _getActiveTaskCount, _getTotalProgress, _esc, _fmtSpeed, _buildStageHistoryHtml, _buildFilesHtml, _buildTasksHtml, _updateDetail, _refreshDisplay, _expand, _collapse, _toggleExpand, _expandChatInput, _collapseChatInput, _getPopSoundCtx, _playPopSound, _showIdle, _hide, show, update, dismiss, preview, setupHoverZone, isVisible };
