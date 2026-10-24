import { bridge as bridge } from '../../core/tauri-bridge.js';
import { escapeHtml as escapeHtml } from '../../core/utils.js';
import { showToast as showToast } from './ui-components.js';
import { actionAttrs as actionAttrs } from '../../core/actions.js';
import { S } from './private-server-state.js';
import { savePrivateServers, getPrivateServerById, renderPrivateServerPage } from './private-server-list.js';

function openPrivateServerModal(id) {
  const isEdit = !!id;
  const server = isEdit ? getPrivateServerById(id) : null;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'private-server-modal';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h3>${isEdit ? '编辑服务器' : '添加服务器'}</h3>
        <button class="modal-close"${actionAttrs('closePrivateServerModal')}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>服务器名称 <span style="color:#ff4d4f">*</span></label>
          <input type="text" id="ps-modal-name" class="text-input" placeholder="例如：豆杰的小服" value="${escapeHtml(server?.name || '')}">
        </div>
        <div class="form-group">
          <label>服务器地址 <span style="color:#ff4d4f">*</span></label>
          <input type="text" id="ps-modal-address" class="text-input" placeholder="例如：mc.example.com:25565" value="${escapeHtml(server?.address || '')}">
          <span class="form-hint">支持域名或 IP，不带端口默认 25565</span>
        </div>
        <div class="form-group">
          <label>简介</label>
          <input type="text" id="ps-modal-desc" class="text-input" placeholder="一句话介绍服务器" value="${escapeHtml(server?.description || '')}">
        </div>
        <div class="form-group">
          <label>图标</label>
          <input type="text" id="ps-modal-icon" class="text-input" placeholder="本地图片路径或网络 URL（留空使用默认图标）" value="${escapeHtml(server?.icon || '')}">
          <span class="form-hint">支持本地文件路径或 http/https 图片链接</span>
        </div>
        <div class="form-group">
          <label>整合包下载地址</label>
          <input type="text" id="ps-modal-modpack" class="text-input" placeholder="可选：填写后卡片显示“下载整合包”按钮" value="${escapeHtml(server?.modpackUrl || '')}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary"${actionAttrs('closePrivateServerModal')}>取消</button>
        <button class="btn btn-primary" id="ps-modal-confirm">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  S._privateServerModal = modal;

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePrivateServerModal();
  });

  // 确认保存
  const confirmBtn = document.getElementById('ps-modal-confirm');
  confirmBtn.onclick = async () => {
    const name = document.getElementById('ps-modal-name').value.trim();
    const address = document.getElementById('ps-modal-address').value.trim();
    const description = document.getElementById('ps-modal-desc').value.trim();
    const icon = document.getElementById('ps-modal-icon').value.trim();
    const modpackUrl = document.getElementById('ps-modal-modpack').value.trim();

    if (!name || !address) {
      showToast('名称和地址不能为空', 'error');
      return;
    }

    let ok = false;
    if (isEdit) {
      const idx = S.privateServerList.findIndex(s => s.id === id);
      if (idx !== -1) {
        S.privateServerList[idx] = {
          ...S.privateServerList[idx],
          name, address, description, icon, modpackUrl,
        };
        ok = await savePrivateServers();
      }
    } else {
      try {
        const result = await bridge.privateServer.add({
          name, address, description, icon, modpackUrl,
        });
        if (result && result.ok && result.server) {
          S.privateServerList.push(result.server);
          ok = true;
        }
      } catch (e) {
        console.error('[PrivateServer] add failed:', e);
      }
    }

    if (ok) {
      closePrivateServerModal();
      renderPrivateServerPage();
      showToast(isEdit ? '已保存' : '已添加', 'success');
    } else {
      showToast('保存失败', 'error');
    }
  };
}

function closePrivateServerModal() {
  if (S._privateServerModal) {
    S._privateServerModal.remove();
    S._privateServerModal = null;
  }
}

export { openPrivateServerModal, closePrivateServerModal };
