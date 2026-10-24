import { bridge as bridge } from '../../core/tauri-bridge.js';
import { S } from './dynamic-island-state.js';

    function _getTTS() {
        if (S._tts) return S._tts;
        S._tts = {
            queue: [],
            playing: false,
            audio: null,
            voices: [],

            speak: function (text, onEnd) {
                if (!text || !String(text).trim()) { if (onEnd) onEnd(); return; }
                this.queue.push({ text: String(text), onEnd: onEnd });
                if (!this.playing) this._drain();
            },

            stop: function () {
                this.queue = [];
                this.playing = false;
                if (this.audio) { try { this.audio.pause(); } catch (e) {} this.audio = null; }
                try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
            },

            _drain: function () {
                var self = this;
                if (this.queue.length === 0) { this.playing = false; return; }
                this.playing = true;
                var item = this.queue.shift();
                var done = false;
                var finish = function () {
                    if (done) return;
                    done = true;
                    if (item.onEnd) item.onEnd();
                    self._drain();
                };
                // 8 秒超时保护，确保引导页不会卡住
                setTimeout(finish, 8000);
                this._playWithEdge(item.text, function (ok) {
                    if (ok) {
                        finish();
                    } else {
                        // msedge-tts 失败，降级到浏览器原生语音合成
                        console.log('[V岛 TTS] 降级到浏览器原生语音合成');
                        self._playWithNative(item.text, finish);
                    }
                });
            },

            // 主方案：IPC 调用主进程 msedge-tts
            _playWithEdge: function (text, cb) {
                if (!bridge || !bridge.tts || !bridge.tts.speak) {
                    cb(false); return;
                }
                var self = this;
                bridge.tts.speak(text, 'zh-CN-XiaoxiaoNeural').then(function (res) {
                    if (!res || !res.ok || !res.data || res.data.length === 0) {
                        console.warn('[V岛 TTS] msedge-tts 返回空，降级原生');
                        cb(false);
                        return;
                    }
                    try {
                        // Tauri 返回的 Vec<u8> 会序列化为数字数组，需先转 Uint8Array 再构造 Blob
                        var u8 = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data);
                        var blob = new Blob([u8], { type: 'audio/mpeg' });
                        var url = URL.createObjectURL(blob);
                        var audio = new Audio(url);
                        self.audio = audio;
                        var done = false;
                        var finish = function (ok) {
                            if (done) return;
                            done = true;
                            URL.revokeObjectURL(url);
                            cb(ok);
                        };
                        audio.onended = function () { console.log('[V岛 TTS] msedge-tts 朗读完成'); finish(true); };
                        audio.onerror = function (e) {
                            console.warn('[V岛 TTS] 音频播放失败，降级原生:', e);
                            finish(false);
                        };
                        audio.play().then(function () {
                            console.log('[V岛 TTS] 使用 msedge-tts 朗读');
                        }).catch(function (e) {
                            console.warn('[V岛 TTS] play() 被拒，降级原生:', e);
                            finish(false);
                        });
                    } catch (e) {
                        console.error('[V岛 TTS] Edge 音频处理异常:', e);
                        cb(false);
                    }
                }).catch(function (e) {
                    console.warn('[V岛 TTS] IPC 调用失败，降级原生:', e);
                    cb(false);
                });
            },

            // 降级方案：浏览器原生 SpeechSynthesis
            _loadVoices: function () {
                var self = this;
                if (!window.speechSynthesis) return;
                var pick = function () {
                    var all = window.speechSynthesis.getVoices() || [];
                    self.voices = all;
                };
                pick();
                if (this.voices.length === 0 && window.speechSynthesis.onvoiceschanged !== undefined) {
                    window.speechSynthesis.onvoiceschanged = pick;
                }
            },

            _pickVoice: function () {
                if (!this.voices || this.voices.length === 0) return null;
                var preferred = ['zh-CN-Xiaoxiao', 'zh-CN-Xiaoyi', 'zh-CN-Xiaohan'];
                for (var i = 0; i < preferred.length; i++) {
                    for (var j = 0; j < this.voices.length; j++) {
                        if (this.voices[j].name === preferred[i]) return this.voices[j];
                    }
                }
                for (var k = 0; k < this.voices.length; k++) {
                    if (this.voices[k].lang === 'zh-CN') return this.voices[k];
                }
                for (var m = 0; m < this.voices.length; m++) {
                    if (this.voices[m].lang && this.voices[m].lang.indexOf('zh') === 0) return this.voices[m];
                }
                return this.voices[0];
            },

            _playWithNative: function (text, cb) {
                if (!window.speechSynthesis) { cb(); return; }
                var self = this;
                var utter = new SpeechSynthesisUtterance(text);
                var voice = self._pickVoice();
                if (voice) {
                    utter.voice = voice;
                    console.log('[V岛 TTS] 降级原生语音:', voice.name);
                } else {
                    utter.lang = 'zh-CN';
                    console.warn('[V岛 TTS] 降级原生，未找到中文语音');
                }
                utter.rate = 1.0;
                utter.pitch = 1.0;
                utter.volume = 1.0;
                utter.onend = function () { cb(); };
                utter.onerror = function (e) { console.error('[V岛 TTS] 原生朗读出错:', e); cb(); };
                window.speechSynthesis.speak(utter);
            }
        };
        S._tts._loadVoices();
        return S._tts;
    }

    function speak(text, onEnd) { _getTTS().speak(text, onEnd); }

    function stopSpeak() { if (S._tts) S._tts.stop(); }

export { _getTTS, speak, stopSpeak };
