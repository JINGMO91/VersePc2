import { S } from './dynamic-island-state.js';
import { _esc, _ensureEl, _collapseChatInput, isEnabled, _clearHideTimer, _getActiveTaskCount } from './dynamic-island-view.js';
import { speak } from './dynamic-island-tts.js';
import { chatWithAI } from './dynamic-island-config.js';
import { registerLazyLoader } from '../../core/lazy-loaders.js';
import { _tools } from './dynamic-island-tools.js';



    function _buildToolPrompt() {
        var toolList = _tools.map(function (t) {
            var params = Object.keys(t.params).map(function (k) {
                return k + '(' + t.params[k] + ')';
            }).join(', ');
            return t.name + (t.danger ? '[确认]' : '') + ':' + params;
        }).join(',');
        return '你是V岛，启动器助手。可用操作：' + toolList + '。用户想操作时回复{{ACTION:{"name":"名","args":{}}}提示语。需确认的操作先问用户。其他正常回复。';
    }

    function _parseAction(reply) {
        var marker = '{{ACTION:';
        var idx = reply.indexOf(marker);
        if (idx === -1) return null;
        var start = idx + marker.length;
        var depth = 0;
        var jsonEnd = -1;
        for (var i = start; i < reply.length; i++) {
            if (reply[i] === '{') depth++;
            else if (reply[i] === '}') {
                depth--;
                if (depth === 0) { jsonEnd = i; break; }
            }
        }
        if (jsonEnd === -1) return null;
        var jsonStr = reply.substring(start, jsonEnd + 1);
        try {
            var action = JSON.parse(jsonStr);
            // 跳过 JSON 后的 }} 标记结尾
            var textStart = jsonEnd + 1;
            if (reply[textStart] === '}') textStart++;
            if (reply[textStart] === '}') textStart++;
            var text = reply.substring(0, idx) + reply.substring(textStart).trim();
            return { name: action.name, args: action.args || {}, text: text };
        } catch (e) {
            console.warn('[V岛] 解析操作指令失败:', e.message, 'json:', jsonStr);
            return null;
        }
    }

    function _executeAction(action) {
        var tool = _tools.find(function (t) { return t.name === action.name; });
        if (!tool) return '未知操作：' + action.name;
        try {
            return tool.run(action.args || {});
        } catch (e) {
            return '执行出错：' + (e.message || e);
        }
    }

    function _showConfirmDialog(action, question, reply) {
        if (!S._el) return;
        var detail = S._el.querySelector('.v-island__detail');
        if (!detail) return;

        S._el.classList.remove('v-island--thinking');
        S._el.classList.add('v-island--expanded');
        S._expanded = true;

        var sub = S._el.querySelector('.v-island__subtitle');
        if (sub) {
            sub.style.display = '';
            sub.textContent = '需要确认';
        }

        var tool = _tools.find(function (t) { return t.name === action.name; });
        var actionDesc = tool ? tool.desc : action.name;

        detail.innerHTML =
            '<div class="v-island__reply">' +
                '<div class="v-island__reply-a">' + _esc(reply || actionDesc) + '</div>' +
                '<div style="margin-top:12px;display:flex;gap:8px;">' +
                    '<button class="btn btn-primary v-island__confirm-yes" style="flex:1;padding:8px 12px;font-size:13px;">确认执行</button>' +
                    '<button class="btn btn-ghost v-island__confirm-no" style="flex:1;padding:8px 12px;font-size:13px;">取消</button>' +
                '</div>' +
            '</div>';

        var yesBtn = detail.querySelector('.v-island__confirm-yes');
        var noBtn = detail.querySelector('.v-island__confirm-no');
        if (yesBtn) {
            yesBtn.onclick = function () {
                var result = _executeAction(action);
                _showReply(question, result);
            };
        }
        if (noBtn) {
            noBtn.onclick = function () {
                _showReply(question, '已取消操作');
            };
        }

        // 朗读确认提示
        speak(reply || actionDesc);
    }

    function _snapshotUI() {
        var selector = 'button, a, input, [onclick], [role="button"], .version-item, .mod-card, .modpack-item, .search-result, [data-clickable], .clickable, .nav-item, .vset-nav-item, .tab-btn';
        var els = document.querySelectorAll(selector);
        var items = [];
        var visibleEls = [];
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            // 跳过不可见元素
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (el.offsetParent === null && el.style.position !== 'fixed') continue;
            // 跳过 V 岛自身元素
            if (el.closest('#v-island')) continue;

            var text = (el.textContent || '').trim().substring(0, 60);
            var placeholder = el.getAttribute('placeholder') || '';
            var title = el.getAttribute('title') || '';
            var type = el.getAttribute('type') || '';
            var value = el.value || '';
            var desc = text || placeholder || title || value || type;
            if (!desc) continue;

            var tag = el.tagName.toLowerCase();
            var action = 'click';
            if (tag === 'input' || tag === 'textarea') {
                action = (type === 'checkbox' || type === 'radio') ? 'click' : 'input';
            }

            var idx = visibleEls.length;
            visibleEls.push(el);
            items.push({
                id: idx,
                tag: tag,
                action: action,
                desc: desc,
                placeholder: placeholder,
                value: value.substring(0, 30)
            });
        }
        // 把元素存到全局变量，执行时用
        S._snapshotElements = visibleEls;

        // 生成文字清单
        var lines = items.map(function (it) {
            var line = '[' + it.id + '] ' + it.action + ' "' + it.desc + '"';
            if (it.placeholder) line += ' (placeholder:' + it.placeholder + ')';
            if (it.value && it.action === 'input') line += ' (current:' + it.value + ')';
            return line;
        });
        return lines.join('\n');
    }

    function _executeUIAction(action) {
        if (action.type === 'click') {
            var el = S._snapshotElements[action.target];
            if (!el) return '元素' + action.target + '不存在';
            try {
                el.scrollIntoView({ block: 'center' });
                el.click();
                return '已点击"' + (el.textContent || '').trim().substring(0, 30) + '"';
            } catch (e) {
                return '点击失败：' + e.message;
            }
        } else if (action.type === 'input') {
            var el2 = S._snapshotElements[action.target];
            if (!el2) return '元素' + action.target + '不存在';
            try {
                el2.scrollIntoView({ block: 'center' });
                el2.focus();
                el2.value = action.value;
                el2.dispatchEvent(new Event('input', { bubbles: true }));
                el2.dispatchEvent(new Event('change', { bubbles: true }));
                if (action.enter) {
                    el2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                    el2.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                    el2.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                }
                return '已输入"' + action.value + '"';
            } catch (e) {
                return '输入失败：' + e.message;
            }
        } else if (action.type === 'done') {
            return null; // 表示任务完成
        }
        return '未知操作类型：' + action.type;
    }

    function _parseUIAction(reply) {
        var marker = '{{UI:';
        var idx = reply.indexOf(marker);
        if (idx === -1) return null;
        var start = idx + marker.length;
        var depth = 0;
        var jsonEnd = -1;
        for (var i = start; i < reply.length; i++) {
            if (reply[i] === '{') depth++;
            else if (reply[i] === '}') {
                depth--;
                if (depth === 0) { jsonEnd = i; break; }
            }
        }
        if (jsonEnd === -1) return null;
        var jsonStr = reply.substring(start, jsonEnd + 1);
        try {
            var action = JSON.parse(jsonStr);
            if (typeof action.target === 'string') action.target = parseInt(action.target);
            return action;
        } catch (e) {
            console.warn('[V岛] 解析UI指令失败:', e.message, 'json:', jsonStr);
            return null;
        }
    }

    async function _runAgentTask(userRequest) {
        if (!S._el) _ensureEl();
        var sub = S._el.querySelector('.v-island__subtitle');
        var detail = S._el.querySelector('.v-island__detail');

        var toolPrompt = '回复格式{{UI:{"type":"click/input/done","target":编号,"value":"文字","think":"用一句话说正在干什么"}}}}。click点按钮，input填输入框(可加enter:true回车)，done表示完成。元素编号是[]里的数字。think描述这一步在做什么。每次只返回一个操作。';

        var MAX_STEPS = 5;
        var history = [];
        var stepLogs = [];
        var lastAction = null;

        // 实时显示操作进度的函数
        function _renderProgress(currentStep, currentDesc, isThinking) {
            if (!detail) return;
            var stepsHtml = '';
            for (var i = 0; i < stepLogs.length; i++) {
                stepsHtml += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;color:var(--text-muted);">' +
                    '<span style="width:6px;height:6px;border-radius:50%;background:#4caf50;flex-shrink:0;"></span>' +
                    '<span>' + _esc(stepLogs[i]) + '</span>' +
                '</div>';
            }
            var currentHtml = '';
            if (currentDesc) {
                var dotStyle = isThinking
                    ? 'width:6px;height:6px;border-radius:50%;background:var(--text-muted);flex-shrink:0;animation:v-island-pulse 1s ease-in-out infinite;'
                    : 'width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0;';
                var color = isThinking ? 'var(--text-muted)' : 'var(--accent)';
                currentHtml = '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;color:' + color + ';">' +
                    '<span style="' + dotStyle + '"></span>' +
                    '<span>' + _esc(currentDesc) + '</span>' +
                '</div>';
            }
            detail.innerHTML =
                '<div class="v-island__reply">' +
                    '<div style="font-size:12px;line-height:1.6;">' + stepsHtml + currentHtml + '</div>' +
                '</div>';
            detail.scrollTop = detail.scrollHeight;
        }

        // 带重试的AI调用（最多重试3次）
        async function _chatWithRetry(messages) {
            for (var retry = 0; retry < 3; retry++) {
                try {
                    var reply = await chatWithAI(messages);
                    if (reply && reply !== '(空回复)' && reply.trim() !== '') {
                        return reply;
                    }
                } catch (e) {
                    console.warn('[V岛] AI请求失败(第' + (retry + 1) + '次):', e.message);
                }
                await new Promise(function (r) { setTimeout(r, 1200); });
            }
            return null;
        }

        // 任务完成后的结果验证：快照当前界面，让AI根据界面状态生成结果报告
        async function _verifyTaskResult(doneHint) {
            if (sub) sub.textContent = '正在检查任务结果...';
            _renderProgress(stepLogs.length, '正在检查任务结果...', true);
            try {
                var verifySnapshot = _snapshotUI();
                var verifyMsg = '用户的需求是：' + userRequest + '。你已经执行了一些操作。请根据当前界面状态，用一句话告诉用户任务的结果。如果任务成功完成，说明结果；如果没完成或有问题，说明原因。只回复结果，不要返回操作指令。';
                var verifyMessages = [{ role: 'user', content: verifyMsg + '\n\n当前界面元素：\n' + verifySnapshot }];
                var verifyReply = await _chatWithRetry(verifyMessages);
                if (verifyReply && verifyReply !== '(空回复)') {
                    return verifyReply;
                }
            } catch (e) {
                console.warn('[V岛] 任务验证失败:', e.message);
            }
            return doneHint || _generateSummary(userRequest, stepLogs, _snapshotUI());
        }

        for (var step = 0; step < MAX_STEPS; step++) {
            S._el.classList.add('v-island--thinking');
            S._el.classList.add('v-island--expanded');
            S._el.classList.remove('v-island--chat');
            S._expanded = true;
            if (sub) {
                sub.style.display = '';
                sub.textContent = '正在操作（第' + (step + 1) + '/' + MAX_STEPS + '步）';
            }
            _renderProgress(step + 1, '思考下一步操作...', true);

            // 快照当前界面
            var snapshot = _snapshotUI();
            var pageId = (document.querySelector('.page.active')?.id || '').replace(/^page-/, '');
            var pageDesc = '当前页面：' + (pageId || '未知');

            // 把提示词放到user消息里，不用system消息（避免mimo空回复bug）
            var userMsg = '你是V岛，通过操作界面元素帮用户完成任务。' + toolPrompt + '\n\n' +
                pageDesc + '\n用户需求：' + userRequest + '\n\n界面元素：\n' + snapshot;
            if (history.length > 0) {
                userMsg = '上一步结果：' + history[history.length - 1] + '\n' + userMsg;
            }

            var messages = [{ role: 'user', content: userMsg }];

            var reply = await _chatWithRetry(messages);
            if (!reply) {
                // AI连续空回复，根据界面状态自己生成结果
                var currentSnapshot = _snapshotUI();
                var summary = _generateSummary(userRequest, stepLogs, currentSnapshot);
                _showReply(userRequest, summary);
                return;
            }

            var action = _parseUIAction(reply);
            if (!action) {
                // AI没返回操控指令，直接显示回复
                _showReply(userRequest, reply);
                return;
            }

            // 任务完成 - 验证结果后再回复
            if (action.type === 'done') {
                var doneHint = action.think || '任务完成';
                var verifiedResult = await _verifyTaskResult(doneHint);
                _showReply(userRequest, verifiedResult);
                return;
            }

            // 重复操作检测：如果连续两步操作相同，说明卡住了
            if (lastAction && lastAction.type === action.type && lastAction.target === action.target) {
                var stuckSummary = _generateSummary(userRequest, stepLogs, _snapshotUI());
                _showReply(userRequest, stuckSummary);
                return;
            }

            // 显示这一步的操作描述（实时）
            var stepDesc = action.think || ('执行' + action.type + '操作');
            _renderProgress(step + 1, stepDesc, false);

            // 执行操作
            var result = _executeUIAction(action);
            if (result === null) {
                var doneHint2 = action.think || '任务完成';
                var verifiedResult2 = await _verifyTaskResult(doneHint2);
                _showReply(userRequest, verifiedResult2);
                return;
            }

            lastAction = action;
            stepLogs.push(stepDesc);
            history.push(result + (action.think ? ' (' + action.think + ')' : ''));
            _renderProgress(step + 1, null, false);

            await new Promise(function (r) { setTimeout(r, 1200); });
        }

        // 跑满步数后，生成有用的总结而不是简单的"已执行N步"
        var finalSummary = _generateSummary(userRequest, stepLogs, _snapshotUI());
        _showReply(userRequest, finalSummary);
    }

    function _generateSummary(userRequest, stepLogs, snapshot) {
        var steps = stepLogs.length;
        if (steps === 0) return '操作未能完成，请稍后重试';

        // 从快照里提取有用信息
        var lines = snapshot.split('\n');
        var resultItems = [];
        for (var i = 0; i < lines.length; i++) {
            // 找搜索结果、卡片等
            if (lines[i].match(/\d+\] click ".*"/) && lines[i].length > 30) {
                var m = lines[i].match(/\d+\] click "(.*)"/);
                if (m && m[1]) {
                    var desc = m[1].substring(0, 40);
                    if (desc.indexOf('安装') !== -1 || desc.indexOf('下载') !== -1) continue;
                    resultItems.push(desc);
                }
            }
        }

        var summary = '已完成 ' + steps + ' 步操作：' + stepLogs[steps - 1];
        if (resultItems.length > 0) {
            summary += '。当前界面显示' + resultItems.length + '个结果，如：' + resultItems.slice(0, 2).join('、');
            if (resultItems.length > 2) summary += '等';
        }
        summary += '。你可以告诉我要安装哪个，或继续其他操作。';
        return summary;
    }

    function _shouldUseAgentMode(q) {
        var keywords = ['找', '搜索', '下载', '安装', '打开', '去', '点击', '帮我', '操作', '切换', '启动'];
        var lowerQ = q.toLowerCase();
        for (var i = 0; i < keywords.length; i++) {
            if (lowerQ.indexOf(keywords[i]) !== -1) return true;
        }
        return false;
    }

    async function _askQuestion(q) {
        if (!S._el) _ensureEl();
        var input = S._el.querySelector('.v-island__input');
        var sub = S._el.querySelector('.v-island__subtitle');
        // 隐藏输入框，显示思考状态
        if (input) input.style.display = 'none';
        S._el.classList.add('v-island--thinking');
        if (sub) {
            sub.style.display = '';
            sub.textContent = '思考中...';
        }

        // 检查是否是"确认执行"的回复（用户之前被要求确认）
        if (S._pendingConfirm && q.match(/^(确认|确定|yes|ok|好|可以)/i)) {
            var pendingAction = S._pendingConfirm;
            S._pendingConfirm = null;
            var result = _executeAction(pendingAction);
            S._dialogHistory.push({ role: 'assistant', content: result });
            if (S._dialogHistory.length > 10) S._dialogHistory = S._dialogHistory.slice(-10);
            _showReply(q, result);
            return;
        }

        // 判断是否进入操控模式
        if (_shouldUseAgentMode(q)) {
            await _runAgentTask(q);
            return;
        }

        // 构建带工具提示的消息
        var messages = [{ role: 'system', content: _buildToolPrompt() }];
        S._dialogHistory.push({ role: 'user', content: q });
        if (S._dialogHistory.length > 10) S._dialogHistory = S._dialogHistory.slice(-10);
        messages = messages.concat(S._dialogHistory);

        try {
            var reply = await chatWithAI(messages);

            // 解析操作指令
            var action = _parseAction(reply);
            if (action) {
                var tool = _tools.find(function (t) { return t.name === action.name; });
                if (tool && tool.danger) {
                    // 危险操作：先确认
                    S._pendingConfirm = action;
                    _showConfirmDialog(action, q, action.text || tool.desc);
                    S._dialogHistory.push({ role: 'assistant', content: action.text || tool.desc });
                } else {
                    // 安全操作：直接执行
                    var execResult = _executeAction(action);
                    var displayText = action.text || execResult;
                    if (execResult && execResult.indexOf('出错') === -1 && execResult.indexOf('无法') === -1) {
                        displayText = (action.text ? action.text + ' ' : '') + execResult;
                    }
                    S._dialogHistory.push({ role: 'assistant', content: displayText });
                    if (S._dialogHistory.length > 10) S._dialogHistory = S._dialogHistory.slice(-10);
                    _showReply(q, displayText);
                }
            } else {
                // 普通对话
                S._dialogHistory.push({ role: 'assistant', content: reply });
                if (S._dialogHistory.length > 10) S._dialogHistory = S._dialogHistory.slice(-10);
                _showReply(q, reply);
            }
        } catch (e) {
            _showReply(q, '出错了：' + (e.message || e));
        }
    }

    function _showReply(question, reply) {
        if (!S._el) return;
        S._el.classList.remove('v-island--thinking');
        S._el.classList.remove('v-island--chat');  // 切回展开态展示回复
        S._el.classList.add('v-island--expanded');
        S._expanded = true;
        var sub = S._el.querySelector('.v-island__subtitle');
        var detail = S._el.querySelector('.v-island__detail');
        if (sub) {
            sub.style.display = '';
            sub.textContent = 'V 岛回复';
        }
        if (detail) {
            detail.innerHTML =
                '<div class="v-island__reply">' +
                    '<div class="v-island__reply-a"><span class="v-typing-text"></span><span class="v-typing-cursor"></span></div>' +
                '</div>';
            _typewriter(detail.querySelector('.v-typing-text'), reply, 30);
        }
        // TTS 朗读回复
        speak(reply);

        // 打字机结束后 10 秒自动收起（时间按字数动态计算）
        var typingDuration = Math.min(reply.length * 30 + 500, 8000);
        var totalDelay = typingDuration + 10000;
        if (S._replyHideTimer) clearTimeout(S._replyHideTimer);
        S._replyHideTimer = setTimeout(function () {
            if (S._state === 'idle' && S._expanded) _collapseChatInput();
        }, totalDelay);
    }

    function _typewriter(el, text, speed) {
        if (!el) return;
        var i = 0;
        el.textContent = '';
        var timer = setInterval(function () {
            if (i >= text.length) {
                clearInterval(timer);
                // 打字结束，移除光标
                var cursor = el.parentNode.querySelector('.v-typing-cursor');
                if (cursor) cursor.remove();
                return;
            }
            el.textContent += text.charAt(i);
            i++;
        }, speed);
    }

    function fixCrash(crashInfo) {
        if (!isEnabled()) return;
        if (!crashInfo || !crashInfo.fixType) return;
        if (!S._el) _ensureEl();

        S._visible = true;
        S._state = 'idle';
        S._expanded = true;
        _clearHideTimer();
        if (S._autoDismissTimer) { clearTimeout(S._autoDismissTimer); S._autoDismissTimer = null; }
        S._el.classList.add('v-island--visible', 'v-island--expanded');
        S._el.classList.remove('v-island--chat', 'v-island--thinking');

        var sub = S._el.querySelector('.v-island__subtitle');
        if (sub) {
            sub.style.display = '';
            sub.textContent = '检测到可自动修复的问题';
        }

        var detail = S._el.querySelector('.v-island__detail');
        if (!detail) return;

        var problemText = crashInfo.reason || '游戏启动失败';
        var fixText = crashInfo.fixDesc || crashInfo.solution || '';
        detail.innerHTML =
            '<div class="v-island__reply">' +
                '<div class="v-island__reply-a" style="font-size:13px;line-height:1.7;">' +
                    '<div style="font-weight:600;margin-bottom:4px;">' + _esc(problemText) + '</div>' +
                    (fixText ? '<div style="color:var(--text-muted);font-size:12px;">' + _esc(fixText) + '</div>' : '') +
                '</div>' +
                '<div style="margin-top:12px;display:flex;gap:8px;">' +
                    '<button class="btn btn-primary v-island__fix-accept" style="flex:1;padding:8px 12px;font-size:13px;">交给V岛修复</button>' +
                    '<button class="btn btn-ghost v-island__fix-cancel" style="flex:1;padding:8px 12px;font-size:13px;">我自己处理</button>' +
                '</div>' +
            '</div>';

        speak('检测到游戏启动失败，这个问题我可以帮你自动修复，要交给我处理吗？');

        var acceptBtn = detail.querySelector('.v-island__fix-accept');
        var cancelBtn = detail.querySelector('.v-island__fix-cancel');
        if (acceptBtn) {
            acceptBtn.onclick = function () {
                _runAgentTask(_buildFixInstruction(crashInfo));
            };
        }
        if (cancelBtn) {
            cancelBtn.onclick = function () {
                _showReply('', '好的，如果需要帮助随时叫我');
            };
        }
    }

    function _buildFixInstruction(info) {
        var base = '游戏「' + (info.versionId || '') + '」启动失败了。失败原因：' + (info.reason || '未知') + '。';
        switch (info.fixType) {
            case 'memory':
                return base + '这是内存不足导致的。请帮我修复：进入"设置"页面，找到内存分配（最大内存）设置，把内存调大到 4096MB（如果已经是 4096 就调到 6144MB），保存后告诉我结果。';
            case 'missing-dep':
                return base + '这是缺少前置模组导致的。缺失的依赖：' + (info.modName || '见崩溃日志') + '。请帮我修复：进入"模组"或"下载"页面，搜索并安装缺失的前置模组，注意要与当前游戏版本匹配。';
            case 'mod-crash':
                return base + '问题模组：' + (info.modName || '未知') + '。请帮我修复：进入"模组管理"页面，找到这个模组，将它禁用或卸载。';
            case 'duplicate-mod':
                return base + '请帮我修复：进入模组管理页面，找到重复安装的模组' + (info.modName ? '（' + info.modName + '）' : '') + '，删除多余的副本，只保留一个。';
            case 'mod-conflict':
                return base + '请帮我修复：进入模组管理页面，找到互相冲突的模组，移除其中一个。';
            case 'file-corrupt':
            case 'file-missing':
                return base + '请帮我修复：进入版本设置页面，找到"文件修复"功能并执行修复，重新下载损坏或缺失的文件。';
            case 'loader-missing':
                return base + '请帮我修复：重新安装该版本的模组加载器（Forge/Fabric），或者重新安装这个游戏版本。';
            default:
                return base + '建议的修复方案：' + (info.solution || '无') + '。请按方案帮我操作完成修复。';
        }
    }

export { _buildToolPrompt, _parseAction, _executeAction, _showConfirmDialog, _snapshotUI, _executeUIAction, _parseUIAction, _runAgentTask, _generateSummary, _shouldUseAgentMode, _askQuestion, _showReply, _typewriter, fixCrash, _buildFixInstruction };

// 输入提交走懒加载中转，视图层无需反向依赖智能体实现
registerLazyLoader('island:ask', function (q) {
    return _askQuestion(q);
});


export { _tools };