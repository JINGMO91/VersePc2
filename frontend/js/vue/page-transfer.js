/* page-transfer.js - 互传页 Vue 组件
 * 流程：
 *   发送：选择文件 → 生成 8 位识别码 → 对端连接后自动直传（SHA-256 校验）
 *   接收：输入识别码 → 选择保存目录 → 连接发送方接收并校验
 * 文件数据在两台设备间 TCP 直连，服务器只做信令不中转。
 */
const PageTransfer = {
  name: 'PageTransfer',
  data() {
    return {
      // 发送
      sendFilePath: '',
      sendFileName: '',
      sendCode: '',
      sending: false,
      sendStatus: null,
      sendTimer: null,
      sendDone: false,
      // 接收
      receiveCode: '',
      saveDir: '',
      receiving: false,
      receiveResult: null,
      receiveError: ''
    };
  },
  methods: {
    isTauri() {
      return !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
    },
    async pickFile() {
      if (!this.isTauri()) return;
      try {
        const picked = await window.__TAURI__.dialog.open({ multiple: false, title: '选择要发送的文件' });
        if (typeof picked === 'string' && picked) {
          this.sendFilePath = picked;
          this.sendFileName = picked.replace(/\\/g, '/').split('/').pop();
        }
      } catch (e) {
        this.status = '选择文件失败';
      }
    },
    async startSend() {
      if (!this.sendFilePath || this.sending) return;
      this.sending = true;
      this.sendDone = false;
      this.sendStatus = null;
      try {
        const invoke = window.__TAURI__.core.invoke;
        const session = await invoke('transfer_start_send', { path: this.sendFilePath });
        this.sendCode = session.code;
        this.sendFileName = session.fileName;
        this.sendTimer = setInterval(async () => {
          try {
            const st = await invoke('transfer_send_status', { code: this.sendCode });
            this.sendStatus = st;
            if (st.transfers > 0 && !st.connected) {
              this.sendDone = true;
              clearInterval(this.sendTimer);
              this.sendTimer = null;
            }
          } catch (e) { /* 轮询失败忽略 */ }
        }, 1000);
      } catch (e) {
        this.sendStatus = { error: String(e) };
        this.sending = false;
      }
    },
    resetSend() {
      if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null; }
      this.sendCode = '';
      this.sendFilePath = '';
      this.sendFileName = '';
      this.sendStatus = null;
      this.sendDone = false;
      this.sending = false;
    },
    async pickSaveDir() {
      if (!this.isTauri()) return;
      try {
        const picked = await window.__TAURI__.dialog.open({ directory: true, title: '选择保存位置' });
        if (typeof picked === 'string' && picked) this.saveDir = picked;
      } catch (e) { /* 用户取消 */ }
    },
    async startReceive() {
      if (!this.receiveCode || !this.saveDir || this.receiving) return;
      this.receiving = true;
      this.receiveResult = null;
      this.receiveError = '';
      try {
        const invoke = window.__TAURI__.core.invoke;
        const r = await invoke('transfer_receive', { code: this.receiveCode, saveDir: this.saveDir });
        if (r && r.hashOk) {
          this.receiveResult = r;
        } else {
          this.receiveError = '接收完成但校验未通过，文件可能已损坏';
        }
      } catch (e) {
        this.receiveError = String(e);
      }
      this.receiving = false;
    }
  },
  template: `
    <style>
      .transfer-wrap { max-width: 680px; margin: 0 auto; padding: 22px 24px 30px; }
      .transfer-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg, 16px); padding: 18px 20px 20px; margin-bottom: 16px; }
      .transfer-card-head { display: flex; flex-direction: column; gap: 3px; margin-bottom: 14px; }
      .transfer-card-title { font-size: 17px; font-weight: 700; color: var(--text-primary); }
      .transfer-card-sub { font-size: 12.5px; color: var(--text-muted); }
      .transfer-card-body { display: flex; flex-direction: column; gap: 10px; }
      .transfer-file { font-size: 12.5px; color: var(--text-secondary); word-break: break-all; }
      .transfer-input { height: 40px; border-radius: var(--radius-md, 10px); border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); padding: 0 12px; font-size: 14px; outline: none; letter-spacing: 2px; }
      .transfer-input:focus { border-color: var(--accent); }
      .transfer-btn { height: 40px; border-radius: var(--radius-md, 10px); border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); font-size: 14px; font-weight: 600; cursor: pointer; transition: background var(--transition, .15s); }
      .transfer-btn:hover:not(:disabled) { background: var(--bg-hover, var(--bg-tertiary)); }
      .transfer-btn:disabled { opacity: .45; cursor: not-allowed; }
      .transfer-btn.primary { background: var(--accent); border: none; color: var(--accent-text); font-size: 15px; }
      .transfer-btn.primary:hover:not(:disabled) { background: var(--accent-hover); filter: none; }
      .transfer-code { font-size: 26px; font-weight: 800; letter-spacing: 5px; color: var(--accent); font-family: Consolas, 'Courier New', monospace; text-align: center; padding: 8px 0 2px; }
      .transfer-hint { font-size: 12.5px; color: var(--text-muted); }
      .transfer-ok { font-size: 13px; color: var(--green); }
      .transfer-err { font-size: 13px; color: var(--red); }
      .transfer-note { font-size: 12px; color: var(--text-muted); text-align: center; margin-top: 4px; }
    </style>
    <div class="transfer-wrap">
      <div class="transfer-card">
        <div class="transfer-card-head">
          <span class="transfer-card-title">我要发送</span>
          <span class="transfer-card-sub">生成识别码，等待对端连接后自动直传</span>
        </div>
        <div v-if="!sendCode" class="transfer-card-body">
          <button class="transfer-btn" @click="pickFile">选择文件</button>
          <span class="transfer-file" v-if="sendFileName">{{ sendFileName }}</span>
          <button class="transfer-btn primary" :disabled="!sendFilePath || sending" @click="startSend">生成识别码并等待连接</button>
        </div>
        <div v-else class="transfer-card-body">
          <div class="transfer-code">{{ sendCode }}</div>
          <div class="transfer-hint">把识别码告诉对方（10 分钟内有效）· 文件：{{ sendFileName }}</div>
          <div v-if="sendStatus && sendStatus.connected" class="transfer-hint">
            对端已连接，传输中 {{ Math.round((sendStatus.sentBytes / Math.max(sendStatus.totalBytes,1)) * 100) }}%
          </div>
          <div v-if="sendDone" class="transfer-ok">传输完成，校验通过 ✓</div>
          <div v-if="sendStatus && sendStatus.error" class="transfer-err">{{ sendStatus.error }}</div>
          <button class="transfer-btn" @click="resetSend">重置</button>
        </div>
      </div>

      <div class="transfer-card">
        <div class="transfer-card-head">
          <span class="transfer-card-title">我要接收</span>
          <span class="transfer-card-sub">输入对端的识别码，连接后接收文件</span>
        </div>
        <div class="transfer-card-body">
          <input class="transfer-input" v-model="receiveCode" placeholder="输入 8 位识别码" maxlength="8" />
          <button class="transfer-btn" @click="pickSaveDir">选择保存位置</button>
          <span class="transfer-file" v-if="saveDir">{{ saveDir }}</span>
          <button class="transfer-btn primary" :disabled="!receiveCode || !saveDir || receiving" @click="startReceive">
            {{ receiving ? '接收中…' : '开始接收' }}
          </button>
          <div v-if="receiveResult" class="transfer-ok">接收完成：{{ receiveResult.fileName }}（{{ receiveResult.savedPath }}）校验通过 ✓</div>
          <div v-if="receiveError" class="transfer-err">{{ receiveError }}</div>
        </div>
      </div>

      <div class="transfer-note">文件在两台设备间点对点直连传输，服务器只负责信令不中转数据</div>
    </div>
  `
};

// 注册到全局组件表（index.html 的 _mountBatch 从 window.VersePC 取组件挂载）
window.VersePC = window.VersePC || {};
window.VersePC.PageTransfer = PageTransfer;
