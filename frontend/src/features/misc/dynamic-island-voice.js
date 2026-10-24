import { S } from './dynamic-island-state.js';
import { speak } from './dynamic-island-tts.js';
import { chatWithAI } from './dynamic-island-config.js';
import { isEnabled, _ensureHoverZone } from './dynamic-island-view.js';

    function _startWake() {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { console.warn('[V岛] 浏览器不支持语音识别，唤醒词功能不可用'); return; }
        if (S._wakeRec) _stopWake();
        var rec = new SR();
        rec.lang = 'zh-CN';
        rec.continuous = true;
        rec.interimResults = true;
        rec.onstart = function () { console.log('[V岛唤醒] 监听已启动'); };
        rec.onaudiostart = function () { console.log('[V岛唤醒] 音频流已开启'); };
        rec.onaudioend = function () { console.log('[V岛唤醒] 音频流已结束'); };
        rec.onspeechstart = function () { console.log('[V岛唤醒] 检测到说话'); };
        rec.onresult = function (ev) {
            var txt = '';
            for (var i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
            if (txt) console.log('[V岛唤醒] 识别到:', txt);
            // 唤醒词匹配：放宽到各种近似音
            // 中文识别"Verse"通常返回：沃斯/佛斯/沃尔斯/弗斯/vers/维斯 等
            var lower = txt.toLowerCase();
            var matched = false;
            // 1. 中文字面匹配
            if (txt.indexOf('嘿Verse') !== -1 || txt.indexOf('嘿verse') !== -1 ||
                txt.indexOf('嘿 Verse') !== -1) {
                matched = true;
            }
            // 2. 英文匹配
            else if (lower.indexOf('hey verse') !== -1 || lower.indexOf('hey vers') !== -1 ||
                     lower.indexOf('hi verse') !== -1) {
                matched = true;
            }
            // 3. 中文近似音匹配（最常见）
            else if (txt.indexOf('嘿') !== -1) {
                // "嘿"后面的字匹配 Verse 的各种近似音
                var afterHey = txt.substring(txt.indexOf('嘿') + 1);
                if (afterHey.match(/(沃斯|佛斯|沃尔斯|弗斯|维斯|维尔|沃瑟|佛瑟|vers|verse|沃斯尔|佛斯尔)/i)) {
                    matched = true;
                }
                // "嘿 V" 也算（用户说"嘿 V"）
                else if (afterHey.match(/^v/i) || afterHey.indexOf('维') !== -1) {
                    matched = true;
                }
            }
            // 4. 只说"Verse"或近似音（没"嘿"也算）
            else if (lower.match(/(verse|vers|沃斯|佛斯|维斯)/i)) {
                matched = true;
            }
            if (matched) {
                console.log('[V岛唤醒] ✓ 唤醒词触发');
                _onWake();
            }
        };
        rec.onerror = function (e) {
            console.warn('[V岛唤醒] 识别错误:', e.error);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                console.warn('[V岛唤醒] 麦克风未授权，请检查系统麦克风权限');
            }
        };
        rec.onend = function () {
            console.log('[V岛唤醒] 监听结束，2秒后重启');
            if (S._wakeListening && !S._inDialog) {
                setTimeout(function () {
                    if (S._wakeListening && !S._inDialog) {
                        try { rec.start(); } catch (e) { console.warn('[V岛唤醒] 重启失败:', e); }
                    }
                }, 2000);
            }
        };
        try { rec.start(); S._wakeListening = true; S._wakeRec = rec; console.log('[V岛唤醒] 正在启动监听...'); }
        catch (e) { console.warn('[V岛唤醒] 启动失败:', e); }
    }

    function _stopWake() {
        S._wakeListening = false;
        if (S._wakeRec) { try { S._wakeRec.stop(); } catch (e) {} S._wakeRec = null; }
    }

    function _onWake() {
        if (S._inDialog) return;
        S._inDialog = true;
        _stopWake();
        _setStatusIndicator('正在聆听...', 'listening');
        speak('我在听，请说');
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { _endDialog(); return; }
        var rec = new SR();
        rec.lang = 'zh-CN';
        rec.continuous = false;
        rec.interimResults = false;
        var gotReply = false;
        rec.onresult = function (ev) {
            var q = ev.results[0][0].transcript;
            _setStatusIndicator('思考中...', 'processing');
            _askAI(q);
        };
        rec.onerror = function () { _endDialog(); };
        rec.onend = function () {
            if (S._inDialog && !gotReply) setTimeout(function () { if (S._inDialog && !gotReply) _endDialog(); }, 3000);
        };
        setTimeout(function () { try { rec.start(); } catch (e) {} }, 600);
    }

    async function _askAI(q) {
        S._dialogHistory.push({ role: 'user', content: q });
        if (S._dialogHistory.length > 10) S._dialogHistory = S._dialogHistory.slice(-10);
        S._dialogHistory.unshift({ role: 'system', content: '你是 V 岛，一个住在 Minecraft 启动器里的语音助手，回答简洁友好，不超过两句话。' });
        var reply = await chatWithAI(S._dialogHistory);
        S._dialogHistory.shift();
        S._dialogHistory.push({ role: 'assistant', content: reply });
        _setStatusIndicator('回答中...', 'processing');
        speak(reply, function () { _endDialog(); });
    }

    function _endDialog() {
        S._inDialog = false;
        _setStatusIndicator('V 岛 · 待命', 'ready');
        _startWake();
    }

    function _setStatusIndicator(text, state) {
        // 在 V 岛 pill 上显示对话状态（复用 subtitle）
        if (!S._el) return;
        var subEl = S._el.querySelector('.v-island__subtitle');
        if (subEl) subEl.textContent = text;
        // 状态切换 class
        S._el.classList.remove('island--idle', 'island--active', 'v-island--listening', 'v-island--processing');
        if (state === 'listening') S._el.classList.add('v-island--listening');
        else if (state === 'processing') S._el.classList.add('v-island--processing');
        S._el.classList.add('v-island--visible');
    }

    function _startVoiceAssistant() {
        if (!isEnabled()) return;
        _ensureHoverZone();
        console.log('[V岛] 语音助手已启动（点击对话模式）');
    }

export { _startWake, _stopWake, _onWake, _askAI, _endDialog, _setStatusIndicator, _startVoiceAssistant };
