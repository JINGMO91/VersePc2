// vue/modals/static-modals.js — 静态弹窗模板
// 从 index.html 抽出，启动时挂载到 body，元素 ID 与 class 保持不变。

const STATIC_MODALS_HTML = `
<div id="support-modal" class="modal" style="display:none">
  <div class="modal-content support-modal-content">
    <div class="support-modal-body">
      <div class="support-modal-title">感谢你的支持！</div>
      <div class="support-modal-subtitle">你已经使用 VersePC2 启动 <span class="support-modal-count" id="support-modal-count">0</span> 次了</div>
      <div class="support-modal-desc">如果喜欢，可以去爱发电支持豆杰</div>
      <div class="support-modal-actions">
        <button class="btn btn-accent" data-action="openSupportPage">
          去支持
        </button>
        <button class="btn btn-secondary" data-action="dismissSupportModal">下次一定</button>
      </div>
    </div>
  </div>
</div>

<!-- 更新公告弹窗 -->
<div id="announcement-modal" class="modal" style="display:none" data-no-close-on-backdrop>
  <div class="modal-content announcement-modal-content">
    <div class="modal-header">
      <h3>更新公告</h3>
      <button class="modal-close" data-action="dismissAnnouncementModal">&times;</button>
    </div>
    <div class="modal-body announcement-modal-body">
      <div class="announcement-version" id="announcement-version-badge"></div>
      <div class="announcement-content" id="announcement-content">
        <p>暂无公告内容</p>
      </div>
    </div>
    <div class="modal-footer announcement-modal-footer">
      <label class="checkbox-label announcement-checkbox">
        <input type="checkbox" id="announcement-dismiss-check">
        <span>下次启动不再弹出</span>
      </label>
      <div style="display:flex;gap:8px;margin-left:auto;">
        <button class="modal-btn modal-btn--secondary" data-action="announcementGotoUpdateSettings">更新设置</button>
        <button class="modal-btn modal-btn--primary" data-action="dismissAnnouncementModal">我已知晓</button>
      </div>
    </div>
  </div>
</div>

<div id="update-modal" class="modal" style="display:none">
  <div class="modal-content announcement-modal-content" style="max-width:520px;">
    <div class="modal-header">
      <h3 id="update-modal-title">发现新版本</h3>
      <button class="modal-close" data-action="dismissUpdateModal">&times;</button>
    </div>
    <div class="modal-body announcement-modal-body">
      <div class="announcement-version" id="update-modal-version"></div>
      <div class="announcement-content" id="update-modal-content">
        <p>暂无更新内容</p>
      </div>
    </div>
    <div class="modal-footer announcement-modal-footer" style="justify-content:flex-end;gap:10px;">
      <button class="modal-btn modal-btn--primary" id="update-modal-goto-btn" data-action="gotoUpdateSettings">前往更新</button>
      <button class="modal-btn modal-btn--secondary" id="update-modal-quark-btn" data-action="downloadFromQuark">夸克网盘更新</button>
      <button class="modal-btn modal-btn--primary" id="update-modal-acknowledge-btn" data-action="dismissUpdateModal" style="display:none;">我已知晓</button>
    </div>
  </div>
</div>

<div id="screenshot-modal" class="modal" style="display:none;">
  <div class="modal-content" style="max-width:800px;">
    <div class="modal-header">
      <h3>游戏截图</h3>
      <button class="modal-close" data-action="closeScreenshotModal">&times;</button>
    </div>
    <div id="screenshot-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;max-height:60vh;overflow-y:auto;padding:12px;">
    </div>
  </div>
</div>

<!-- 模组汉化弹窗 -->
<div id="mod-translate-modal" class="modal" style="display:none">
  <div class="modal-content" style="max-width:560px;">
    <div class="modal-header">
      <h3>模组汉化</h3>
      <button class="modal-close" data-action="hideModal" data-args='["mod-translate-modal"]'>&times;</button>
    </div>
    <div class="modal-body" id="mod-translate-body">
      <div id="mod-translate-loading" style="text-align:center;padding:30px 0;">
        <div class="modal-spinner"></div>
        <p style="color:var(--text-muted);margin-top:12px;">正在检查模组语言文件...</p>
      </div>
      <div id="mod-translate-content" style="display:none;">
        <div id="mod-translate-info" style="margin-bottom:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;">
          <div style="font-weight:600;margin-bottom:4px;" id="mod-translate-modname"></div>
          <div style="font-size:12px;color:var(--text-muted);" id="mod-translate-langinfo"></div>
        </div>
        <div id="mod-translate-tabs" style="display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid var(--border-color);">
          <button class="mod-translate-tab active" data-tab="quick" data-action="switchTranslateTab" data-args='["quick"]'>快速汉化</button>
          <button class="mod-translate-tab" data-tab="auto" data-action="switchTranslateTab" data-args='["auto"]'>AI 机翻</button>
          <button class="mod-translate-tab" data-tab="manual" data-action="switchTranslateTab" data-args='["manual"]'>手动汉化</button>
        </div>
        <div id="mod-translate-tab-quick" class="mod-translate-panel">
          <p style="color:var(--text-secondary);font-size:13px;line-height:1.7;margin-bottom:12px;">
            使用谷歌免费翻译接口，无需配置，速度快。翻译质量一般，适合快速体验。
          </p>
          <div id="mod-translate-quick-progress" style="display:none;margin-bottom:12px;">
            <div style="height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden;">
              <div id="mod-translate-quick-progress-bar" style="height:100%;width:0%;background:var(--accent-color);transition:width 0.3s;"></div>
            </div>
            <p id="mod-translate-quick-progress-text" style="font-size:12px;color:var(--text-muted);margin-top:6px;">准备中...</p>
          </div>
          <div id="mod-translate-quick-result" style="display:none;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;"></div>
          <button class="btn btn-primary" id="mod-translate-quick-btn" data-action="startQuickTranslate">
            开始快速汉化
          </button>
        </div>
        <div id="mod-translate-tab-auto" class="mod-translate-panel" style="display:none;">
          <p style="color:var(--text-secondary);font-size:13px;line-height:1.7;margin-bottom:12px;">
            自动翻译模组中的英文文本为中文，适合快速体验。翻译质量取决于 AI 模型，专业术语可能不够准确。
          </p>
          <div id="mod-translate-ai-warning" style="display:none;padding:10px 12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:6px;margin-bottom:12px;font-size:12px;color:#f59e0b;">
            未配置 AI 供应商，请先在 V岛设置中配置 AI 对话功能。
          </div>
          <div id="mod-translate-progress" style="display:none;margin-bottom:12px;">
            <div style="height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden;">
              <div id="mod-translate-progress-bar" style="height:100%;width:0%;background:var(--accent-color);transition:width 0.3s;"></div>
            </div>
            <p id="mod-translate-progress-text" style="font-size:12px;color:var(--text-muted);margin-top:6px;">准备中...</p>
          </div>
          <div id="mod-translate-result" style="display:none;padding:10px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;"></div>
          <button class="btn btn-primary" id="mod-translate-start-btn" data-action="startAutoTranslate">
            开始机翻
          </button>
        </div>
        <div id="mod-translate-tab-manual" class="mod-translate-panel" style="display:none;">
          <p style="color:var(--text-secondary);font-size:13px;line-height:1.7;margin-bottom:12px;">
            手动汉化需要自己翻译文本，适合追求翻译质量的用户。
          </p>
          <div style="background:var(--bg-secondary);border-radius:8px;padding:14px 16px;margin-bottom:12px;">
            <ol style="margin:0;padding-left:20px;color:var(--text-secondary);font-size:13px;line-height:2;">
              <li>点击下方"导出语言文件"按钮，提取模组的英文语言文件</li>
              <li>打开导出的 <code style="background:var(--bg-tertiary);padding:2px 6px;border-radius:3px;">en_us.json</code> 文件</li>
              <li>将每行英文翻译成中文（只翻译冒号右边的值）</li>
              <li>保存文件名为 <code style="background:var(--bg-tertiary);padding:2px 6px;border-radius:3px;">zh_cn.json</code></li>
              <li>点击"导入中文语言文件"将翻译好的文件写回模组</li>
            </ol>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" data-action="exportModLangFile">导出语言文件</button>
            <button class="btn btn-secondary" data-action="importModLangFile">导入中文语言文件</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<input type="file" id="mod-translate-file-input" style="display:none" accept=".json,.lang">
`;

/// 挂载静态弹窗到 body；重复调用安全
export function mountStaticModals() {
  if (document.getElementById('static-modal-root')) return;
  const root = document.createElement('div');
  root.id = 'static-modal-root';
  root.innerHTML = STATIC_MODALS_HTML;
  document.body.appendChild(root);
}
