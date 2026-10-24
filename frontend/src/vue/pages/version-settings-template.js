// version-settings-template.js — 版本设置页面的 Vue 模板
export const VERSION_SETTINGS_TEMPLATE = `    <div>
      <div class="vset-header">
        <button class="btn btn-icon" @click="close()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="vset-title">{{ title }}</span>
        <button class="btn btn-icon" @click="close()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="vset-body">
        <div class="vset-sidebar">
          <button class="vset-nav-item" :class="{ active: activeTab==='overview' }" @click="switchTab('overview')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>
            <span>概览</span>
          </button>
          <button class="vset-nav-item" :class="{ active: activeTab==='settings' }" @click="switchTab('settings')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="3"/><path d="M12 2V5"/><path d="M12 19V22"/><path d="M2 12H5"/><path d="M19 12H22"/><path d="M4.93 4.93L7.05 7.05"/><path d="M16.95 16.95L19.07 19.07"/><path d="M4.93 19.07L7.05 16.95"/><path d="M16.95 7.05L19.07 4.93"/></svg>
            <span>设置</span>
          </button>
          <button class="vset-nav-item" :class="{ active: activeTab==='saves' }" @click="switchTab('saves')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><path d="M20 7h-9l-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/></svg>
            <span>存档</span>
          </button>
          <button class="vset-nav-item" :class="{ active: activeTab==='modmgr' }" @click="switchTab('modmgr')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><path d="M12 2L21 7V17L12 22L3 17V7L12 2Z"/><path d="M12 8L16 10.5V15.5L12 18L8 15.5V10.5L12 8Z"/></svg>
            <span>模组</span>
          </button>
          <button class="vset-nav-item" :class="{ active: activeTab==='export' }" @click="switchTab('export')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"><rect x="4" y="3" width="16" height="3" rx="0"/><rect x="4" y="18" width="16" height="3" rx="0"/><path d="M12 6V15"/><path d="M8 12L12 16L16 12"/></svg>
            <span>导出</span>
          </button>
        </div>
        <div class="vset-content">
          <!-- 概览 -->
          <div class="vset-panel" :class="{ active: activeTab==='overview' }">
            <div v-if="isExternal" class="vset-external-banner" style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.2);margin-bottom:16px">
              <svg viewBox="0 0 24 24" fill="none" stroke="#ffa500" stroke-width="2" style="width:18px;height:18px;flex-shrink:0"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              <div>
                <div style="font-size:13px;color:var(--text-primary);font-weight:500">外部文件夹版本</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;word-break:break-all">{{ externalPath }}</div>
              </div>
            </div>
            <div class="vset-section">
              <div class="vset-section-title">快捷方式</div>
              <div class="vset-btn-group">
                <VButton @click="openVersionFolder()" variant="secondary" size="sm">版本文件夹</VButton>
                <VButton @click="openSavesFolder()" variant="secondary" size="sm">存档文件夹</VButton>
                <VButton @click="openModsFolder()" variant="secondary" size="sm">Mod文件夹</VButton>
              </div>
            </div>
            <div class="vset-section">
              <div class="vset-section-title">高级管理</div>
              <div class="vset-btn-group">
                <VButton @click="exportLaunchScript()" variant="secondary" size="sm">导出启动脚本</VButton>
                <VButton @click="repairFiles()" variant="secondary" size="sm">补全文件</VButton>
                <VButton @click="diagnoseVersion()" variant="secondary" size="sm">诊断</VButton>
                <VButton @click="deleteCurrentVersion()" variant="danger" size="sm">删除版本</VButton>
              </div>
            </div>
          </div>
          <!-- 设置 -->
          <div class="vset-panel" :class="{ active: activeTab==='settings' }">
            <div class="vset-section">
              <div class="vset-section-title">版本信息</div>
              <div class="vset-form-row">
                <label class="vset-label">自定义版本名</label>
                <VInput type="text" class="max-w-[300px]" v-model="customName" placeholder="留空使用默认名称" @input="onCustomNameInput();saveSetting('customName',$event.target.value)" @change="saveSetting('customName',customName)" />
              </div>
              <div class="vset-form-row">
                <label class="vset-label">版本描述</label>
                <VInput type="text" class="max-w-[300px]" v-model="description" placeholder="留空使用默认描述" @change="saveSetting('description',description)" />
              </div>
            </div>
            <div class="vset-section">
              <div class="vset-section-title">启动选项</div>
              <div class="vset-form-row">
                <label class="vset-label">版本隔离</label>
                <select class="vset-select" id="vset-isolation" v-model="isolation" @change="saveSetting('isolation',isolation)">
                  <option value="global">跟随全局设置</option>
                  <option value="on">开启版本隔离</option>
                  <option value="off">关闭版本隔离</option>
                </select>
              </div>
              <div class="vset-form-row">
                <label class="vset-label">游戏窗口标题</label>
                <VInput type="text" class="max-w-[300px]" v-model="windowTitle" placeholder="跟随全局设置" @change="saveSetting('windowTitle',windowTitle)" />
              </div>
              <div class="vset-form-row">
                <label class="vset-label">自定义信息</label>
                <VInput type="text" class="max-w-[300px]" v-model="customInfo" placeholder="跟随全局设置" @change="saveSetting('customInfo',customInfo)" />
              </div>
              <div class="vset-form-row">
                <label class="vset-label">游戏 Java</label>
                <div style="display:flex;gap:8px;align-items:center;width:100%;">
                  <select class="vset-select" id="vset-java" v-model="javaPath" @change="saveSetting('javaPath',javaPath)" style="flex:1;">
                    <option v-for="opt in javaOptions" :key="opt.value" :value="opt.value">{{ opt.text }}</option>
                  </select>
                  <VButton @click="detectJava()" title="自动搜索" variant="secondary" size="sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                    自动搜索
                  </VButton>
                  <VButton @click="browseJava()" title="手动导入" variant="secondary" size="sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    手动导入
                  </VButton>
                </div>
              </div>
            </div>
            <div class="vset-section">
              <div class="vset-section-title">内存分配</div>
              <div class="vset-radio-group">
                <label class="vset-radio"><input type="radio" name="vsetMemoryMode" value="global" v-model="memoryMode"><span>跟随全局设置</span></label>
                <label class="vset-radio"><input type="radio" name="vsetMemoryMode" value="auto" v-model="memoryMode"><span>自动配置</span></label>
                <label class="vset-radio"><input type="radio" name="vsetMemoryMode" value="custom" v-model="memoryMode"><span>自定义</span></label>
              </div>
              <div class="vset-slider-wrap" v-show="memoryMode==='custom'">
                <input type="range" class="vset-slider" min="512" max="16384" step="256" v-model.number="memoryValue">
                <div class="vset-slider-info">
                  <span>{{ memoryDisplayText }}</span>
                  <span style="color:var(--text-muted);font-size:12px">已用内存: <span>{{ usedMemory }}</span></span>
                  <span style="color:var(--text-muted);font-size:12px">游戏分配: <span>{{ gameMemory }}</span></span>
                </div>
              </div>
              <div class="vset-form-row" style="margin-top:10px">
                <label class="vset-label">启动游戏前进行内存优化</label>
                <select class="vset-select" id="vset-mem-optimize" v-model="memOptimize" @change="saveSetting('memOptimize',memOptimize)">
                  <option value="global">跟随全局设置</option>
                  <option value="on">开启</option>
                  <option value="off">关闭</option>
                </select>
              </div>
            </div>
            <div class="vset-section">
              <div class="vset-section-title">高级启动选项</div>
              <div class="vset-form-row">
                <label class="vset-label">JVM 参数</label>
                <VInput type="text" class="max-w-[300px]" v-model="jvmArgs" placeholder="跟随全局设置，如 -XX:+UseG1GC" @change="saveSetting('jvmArgs',jvmArgs)" />
              </div>
              <div class="vset-form-row">
                <label class="vset-label">游戏参数</label>
                <VInput type="text" class="max-w-[300px]" v-model="gameArgs" placeholder="跟随全局设置，如 --demo" @change="saveSetting('gameArgs',gameArgs)" />
              </div>
            </div>
            <div class="vset-info-bar">这些设置只对该游戏版本生效，不影响其他版本。</div>
          </div>
          <!-- 存档 -->
          <div class="vset-panel" :class="{ active: activeTab==='saves' }">
            <div class="saves-header-row">
              <VButton @click="openSavesFolder()" variant="secondary" size="sm">打开存档文件夹</VButton>
              <VButton @click="loadSaves()" variant="secondary" size="sm">刷新</VButton>
            </div>
            <p v-if="savesLoading" class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">加载中...</p>
            <p v-else-if="saves.length===0" class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">暂无存档</p>
            <div v-else class="saves-grid">
              <div class="save-card" v-for="s in saves" :key="s.folder" @click="openSaveEditor(s)" :title="'点击修改存档信息与游戏规则'">
                <div class="save-card-bg">
                  <img v-if="saveIconUrl(s)" :src="saveIconUrl(s)" class="save-card-img" alt="">
                  <svg v-else class="save-card-noicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                </div>
                <div class="save-card-info">
                  <div class="save-card-name" :title="s.name">{{ s.name }}</div>
                  <div class="save-card-meta">{{ difficultyLabel(s.difficulty) }} · {{ lastPlayedText(s.lastPlayed) }}</div>
                </div>
                <button class="pin-btn save-pin-btn" :class="{ active: isPinned('save', s.folder) }"
                        :title="isPinned('save', s.folder) ? '取消置顶' : '置顶存档'" @click.stop="pinSave(s)">
                  <span v-html="ic('pin')"></span>
                </button>
                <button class="save-launch-btn" @click.stop="launchSave(s)" title="启动并进入该存档">
                  <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
              </div>
            </div>

            <!-- 存档编辑弹窗 -->
            <div v-if="saveEditing" class="save-modal" @click.self="closeSaveEditor()">
              <div class="save-modal-card">
                <div class="save-modal-header">
                  <span>存档设置</span>
                  <button class="save-modal-close" @click="closeSaveEditor()">&times;</button>
                </div>
                <div class="save-modal-body">
                  <div class="save-form-row">
                    <label>显示名称</label>
                    <VInput type="text" class="max-w-[300px]" v-model="saveEditing.name" placeholder="输入新的存档名称" />
                  </div>
                  <div class="save-form-row">
                    <label>难度</label>
                    <select class="vset-select" v-model.number="saveEditing.difficulty">
                      <option :value="0">和平</option>
                      <option :value="1">简单</option>
                      <option :value="2">普通</option>
                      <option :value="3">困难</option>
                    </select>
                  </div>
                  <div class="save-form-row">
                    <label>游戏规则</label>
                    <div class="save-rules-grid">
                      <label v-for="(rd, key) in boolRuleDefs" :key="key" class="save-rule-row" @click="toggleRule(saveEditing.rules, key)">
                        <input type="checkbox" :checked="ruleBool(saveEditing.rules, key)" readonly>
                        <span>{{ rd.label }}</span>
                      </label>
                      <label class="save-rule-row save-rule-num">
                        <span>{{ ruleDefs.randomTickSpeed.label }}</span>
                        <VInput type="number" min="0" max="10000"  v-model="saveEditing.rules.randomTickSpeed" class="w-[84px] px-1.5 py-0.5" />
                      </label>
                    </div>
                  </div>
                </div>
                <div class="save-modal-footer">
                  <VButton @click="closeSaveEditor()" variant="secondary" size="sm">取消</VButton>
                  <VButton @click="saveSaveEdit()" variant="accent" size="sm">保存</VButton>
                </div>
              </div>
            </div>
          </div>
          <!-- 模组 -->
          <div class="vset-panel" :class="{ active: activeTab==='modmgr' }">
            <template v-if="isVanilla">
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;">
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:16px;opacity:0.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">原版不支持安装模组</div>
                <div style="font-size:13px;color:var(--text-muted);max-width:320px;line-height:1.6;">此版本为 Minecraft 原版，没有模组加载器。如需安装模组，请先安装 Fabric、Forge 或 NeoForge 模组加载器。</div>
              </div>
            </template>
            <template v-else>
              <div class="modmgr-header-row">
                <div class="modmgr-search-box">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="modmgr-search-icon"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                  <input type="text" class="modmgr-search-input" placeholder="搜索已安装模组..." v-model="modSearch">
                </div>
                <VButton @click="goDownloadMods()" variant="accent" size="sm">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  下载模组
                </VButton>
              </div>
              <div class="modmgr-actions">
                <VButton @click="openModsFolder()" variant="secondary" size="sm">打开文件夹</VButton>
                <VButton @click="installModFromFile()" variant="secondary" size="sm">安装 Mod 文件</VButton>
                <VButton @click="checkModUpdates()" variant="secondary" size="sm">检查更新</VButton>
              </div>
              <div class="modmgr-list">
                <p v-if="modsLoading" class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">加载中...</p>
                <p v-else-if="filteredMods.length===0" class="empty-text" style="padding:30px 0;text-align:center;color:var(--text-muted)">暂无已安装的模组</p>
                <div v-for="m in filteredMods" :key="m.fileName || m.id || m.name" class="modmgr-item" :class="{ 'mod-disabled': m.disabled }">
                  <div class="modmgr-icon" :class="{ 'modmgr-icon--fallback': !(m.icon && !String(m.icon).startsWith('/api/')) && !m.iconDataUrl }">
                    <img v-if="m.icon && !String(m.icon).startsWith('/api/')" :src="m.icon" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">
                    <img v-else-if="m.iconDataUrl" :src="m.iconDataUrl" alt="" style="width:100%;height:100%;object-fit:cover;">
                  </div>
                  <div class="modmgr-info">
                    <div class="modmgr-name" :style="m.disabled ? 'opacity:0.5;text-decoration:line-through;' : ''">{{ formatModName(m) }}{{ m.disabled ? ' (已禁用)' : '' }}</div>
                    <div class="modmgr-meta">{{ m.author ? m.author : '' }}{{ m.version ? ' | ' + m.version : '' }}</div>
                    <div class="modmgr-desc">{{ (m.description || '').substring(0, 60) }}</div>
                  </div>
                  <div class="modmgr-actions-row">
                    <VButton :variant="m.disabled ? 'accent' : 'secondary'" size="sm" @click="toggleMod(m)">{{ m.disabled ? '启用' : '禁用' }}</VButton>
                    <VButton v-if="m.projectId || m.slug" @click="previewMod(m.projectId || m.slug)" variant="secondary" size="sm">预览</VButton>
                    <VButton @click="openTranslate(m)" variant="secondary" size="sm">汉化</VButton>
                    <VButton @click="removeMod(m)" variant="danger" size="sm">移除</VButton>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <!-- 导出 -->
          <div class="vset-panel" :class="{ active: activeTab==='export' }">
            <div class="export-header-row">
              <div class="export-field">
                <label class="vset-label">整合包名称</label>
                <VInput type="text" v-model="exportName" placeholder="输入整合包名称" />
              </div>
              <div class="export-field">
                <label class="vset-label">整合包版本</label>
                <VInput type="text" v-model="exportVersion" placeholder="1.0.0" />
              </div>
            </div>
            <div class="export-header-row" style="margin-top:12px">
              <div class="export-field" style="flex:1">
                <label class="vset-label">作者</label>
                <VInput type="text" v-model="exportAuthor" placeholder="输入作者名称" />
              </div>
            </div>
            <div class="export-field" style="margin-top:12px">
              <label class="vset-label">描述</label>
              <VTextarea v-model="exportDescription" placeholder="输入整合包描述..." class="min-h-[60px] resize-y" />
            </div>
            <div class="export-section-title">导出内容列表</div>
            <div class="export-tree">
              <div class="export-tree-item" :class="{ expanded: exportTrees.game }" @click="toggleExportTree('game')">
                <input type="checkbox" checked class="export-cb" value="game" v-model="exportKeys" @click.stop>
                <span class="export-toggle">▾</span>
                <span class="export-label">游戏本体</span>
                <span class="export-desc">{{ exportGameDesc }}</span>
                <div class="export-children">
                  <div class="export-tree-item">
                    <input type="checkbox" checked class="export-cb" value="game_settings" v-model="exportKeys" @click.stop>
                    <span class="export-label">游戏设置</span>
                    <span class="export-desc">options.txt</span>
                  </div>
                  <div class="export-tree-item">
                    <input type="checkbox" checked class="export-cb" value="servers" v-model="exportKeys" @click.stop>
                    <span class="export-label">服务器列表</span>
                    <span class="export-desc">servers.dat</span>
                  </div>
                </div>
              </div>
              <div class="export-tree-item" :class="{ expanded: exportTrees.mods }" @click="toggleExportTree('mods')">
                <input type="checkbox" checked class="export-cb" value="mods" v-model="exportKeys" @click.stop>
                <span class="export-toggle">▾</span>
                <span class="export-label">Mod</span>
                <span class="export-desc">模组</span>
                <div class="export-children">
                  <div class="export-tree-item">
                    <input type="checkbox" checked class="export-cb" value="mod_files" v-model="exportKeys" @click.stop>
                    <span class="export-label">Mod 文件</span>
                    <span class="export-desc">{{ exportModCount }}</span>
                  </div>
                  <div class="export-tree-item">
                    <input type="checkbox" checked class="export-cb" value="mod_configs" v-model="exportKeys" @click.stop>
                    <span class="export-label">Mod 配置</span>
                    <span class="export-desc">config 文件夹</span>
                  </div>
                </div>
              </div>
              <div class="export-tree-item" :class="{ expanded: exportTrees.resourcepacks }" @click="toggleExportTree('resourcepacks')">
                <input type="checkbox" class="export-cb" value="resourcepacks" v-model="exportKeys" @click.stop>
                <span class="export-toggle">▾</span>
                <span class="export-label">资源包</span>
                <span class="export-desc">纹理包/材质包</span>
                <div class="export-children">
                  <div v-if="exportResourcePacks.length===0" class="export-tree-item">
                    <span class="export-label" style="color:var(--text-muted)">暂无资源包</span>
                  </div>
                  <div v-for="rp in exportResourcePacks" :key="rp" class="export-tree-item">
                    <input type="checkbox" checked class="export-cb" :value="'rp_' + rp" v-model="exportKeys" @click.stop>
                    <span class="export-label">{{ rp }}</span>
                  </div>
                </div>
              </div>
              <div class="export-tree-item">
                <input type="checkbox" class="export-cb" value="shaderpacks" v-model="exportKeys" @click.stop>
                <span class="export-toggle" style="visibility:hidden">▾</span>
                <span class="export-label">光影包</span>
                <span class="export-desc">shaderpacks 文件夹</span>
              </div>
              <div class="export-tree-item" :class="{ expanded: exportTrees.saves }" @click="toggleExportTree('saves')">
                <input type="checkbox" class="export-cb" value="saves" v-model="exportKeys" @click.stop>
                <span class="export-toggle">▾</span>
                <span class="export-label">存档</span>
                <span class="export-desc">{{ exportSavesCount || '游戏存档' }}</span>
                <div class="export-children">
                  <div v-if="exportSaves.length===0" class="export-tree-item">
                    <span class="export-label" style="color:var(--text-muted)">暂无存档</span>
                  </div>
                  <div v-for="s in exportSaves" :key="s" class="export-tree-item">
                    <input type="checkbox" checked class="export-cb" :value="'save_' + s" v-model="exportKeys" @click.stop>
                    <span class="export-label">{{ s }}</span>
                  </div>
                  <div v-if="exportSavesMore > 0" class="export-tree-item">
                    <span class="export-label" style="color:var(--text-muted)">... 还有 {{ exportSavesMore }} 个存档</span>
                  </div>
                </div>
              </div>
              <div class="export-tree-item">
                <input type="checkbox" class="export-cb" value="screenshots" v-model="exportKeys" @click.stop>
                <span class="export-toggle" style="visibility:hidden">▾</span>
                <span class="export-label">截图</span>
                <span class="export-desc">screenshots 文件夹</span>
              </div>
              <div class="export-tree-item" :class="{ expanded: exportTrees.more }" @click="toggleExportTree('more')">
                <span class="export-toggle">▾</span>
                <span class="export-label" style="color:var(--text-muted)">更多选项</span>
                <div class="export-children">
                  <div class="export-tree-item">
                    <input type="checkbox" class="export-cb" value="defaultconfigs" v-model="exportKeys" @click.stop>
                    <span class="export-label">默认配置</span>
                    <span class="export-desc">defaultconfigs</span>
                  </div>
                  <div class="export-tree-item">
                    <input type="checkbox" class="export-cb" value="kubejs" v-model="exportKeys" @click.stop>
                    <span class="export-label">KubeJS</span>
                    <span class="export-desc">kubejs 脚本</span>
                  </div>
                  <div class="export-tree-item">
                    <input type="checkbox" class="export-cb" value="journeymap" v-model="exportKeys" @click.stop>
                    <span class="export-label">JourneyMap</span>
                    <span class="export-desc">地图数据</span>
                  </div>
                  <div class="export-tree-item">
                    <input type="checkbox" class="export-cb" value="waystones" v-model="exportKeys" @click.stop>
                    <span class="export-label">Waystones</span>
                    <span class="export-desc">传送点数据</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="export-footer">
              <VButton @click="startExport()" variant="accent" size="lg">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:6px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                开始导出
              </VButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  \``;
