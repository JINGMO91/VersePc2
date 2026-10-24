/* page-feedback - 问题反馈页 Vue 组件
 * 模板只负责结构，交互与数据全部在 features/misc/feedback.js 中实现。
 * 通用控件（按钮/输入框/多行输入）走 components/verse 语义层，
 * 反馈类型与问题分类是页面专有交互，保留 fb-* 自有样式。
 */
import { onFeedbackFilesPicked, onFeedbackDetailInput, updateFeedbackSubmitState } from '../../features/misc/feedback.js';

import { openFeedbackSite, selectFeedbackType, selectFeedbackCategory, pickFeedbackFiles, refreshFeedbackCaptcha, resetFeedbackForm, submitFeedback } from '../../features/misc/feedback.js';
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';
import VTextarea from '@/components/verse/VTextarea.vue';

const PageFeedback = {
  components: { VButton, VInput, VTextarea },
  setup() {
    return {
      openFeedbackSite,
      selectFeedbackType,
      selectFeedbackCategory,
      pickFeedbackFiles,
      refreshFeedbackCaptcha,
      resetFeedbackForm,
      submitFeedback,
      // 以下三个原本通过内联 oninput 调用全局函数，改为模板事件后必须暴露到作用域
      updateFeedbackSubmitState,
      onFeedbackDetailInput,
      onFeedbackFilesPicked,
    };
  },
  template: `
          <div class="page-header">
            <h2>问题反馈</h2>
            <div class="page-actions">
              <VButton variant="secondary" size="sm" @click="openFeedbackSite()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fb-inline-icon"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                访问官网
              </VButton>
            </div>
          </div>

          <div class="feedback-container">

            <div class="card">
              <h3>反馈类型</h3>
              <div class="grid grid-cols-3 gap-3" id="fb-type-group">
                <button class="fb-type-btn active group flex flex-col items-start gap-1 rounded-xl border border-border bg-secondary/60 p-3.5 text-left text-muted-foreground transition-colors hover:border-primary/40 is-active:border-primary is-active:bg-primary/10 is-active:text-foreground" data-type="bug" @click="selectFeedbackType($event.currentTarget)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-1 size-5 opacity-80"><path d="M9 6a3 3 0 0 1 6 0"/><rect x="8" y="6" width="8" height="12" rx="4"/><path d="M8 10H4M8 14H4M8 18l-3 2M16 10h4M16 14h4M16 18l3 2"/></svg>
                  <span class="text-[13px] font-semibold">问题反馈</span>
                  <span class="text-[11px] leading-snug text-muted-foreground">崩溃、报错、功能异常</span>
                </button>
                <button class="fb-type-btn group flex flex-col items-start gap-1 rounded-xl border border-border bg-secondary/60 p-3.5 text-left text-muted-foreground transition-colors hover:border-primary/40 is-active:border-primary is-active:bg-primary/10 is-active:text-foreground" data-type="feature" @click="selectFeedbackType($event.currentTarget)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-1 size-5 opacity-80"><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/><line x1="9.5" y1="20" x2="14.5" y2="20"/><line x1="10.5" y1="23" x2="13.5" y2="23"/></svg>
                  <span class="text-[13px] font-semibold">功能建议</span>
                  <span class="text-[11px] leading-snug text-muted-foreground">希望增加或改进的功能</span>
                </button>
                <button class="fb-type-btn group flex flex-col items-start gap-1 rounded-xl border border-border bg-secondary/60 p-3.5 text-left text-muted-foreground transition-colors hover:border-primary/40 is-active:border-primary is-active:bg-primary/10 is-active:text-foreground" data-type="other" @click="selectFeedbackType($event.currentTarget)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-1 size-5 opacity-80"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.6 8.6 0 0 1-3.6-.8L3 21l1.8-5.5A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"/></svg>
                  <span class="text-[13px] font-semibold">其他</span>
                  <span class="text-[11px] leading-snug text-muted-foreground">使用体验、咨询等</span>
                </button>
              </div>
            </div>

            <div class="card">
              <h3>问题分类</h3>
              <div class="mb-2 grid grid-cols-3 gap-3" id="fb-category-group">
                <button class="fb-category-btn group flex flex-col items-start gap-1 rounded-xl border border-border bg-secondary/60 p-3.5 text-left text-muted-foreground transition-colors hover:border-primary/40 is-active:border-primary is-active:bg-primary/10 is-active:text-foreground" data-cat="launch" @click="selectFeedbackCategory($event.currentTarget)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-1 size-5 opacity-80"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span class="text-[13px] font-semibold">启动问题</span>
                  <span class="text-[11px] leading-snug text-muted-foreground">启动失败、崩溃、闪退</span>
                </button>
                <button class="fb-category-btn group flex flex-col items-start gap-1 rounded-xl border border-border bg-secondary/60 p-3.5 text-left text-muted-foreground transition-colors hover:border-primary/40 is-active:border-primary is-active:bg-primary/10 is-active:text-foreground" data-cat="download" @click="selectFeedbackCategory($event.currentTarget)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-1 size-5 opacity-80"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span class="text-[13px] font-semibold">下载问题</span>
                  <span class="text-[11px] leading-snug text-muted-foreground">资源下载慢、卡住、校验失败</span>
                </button>
                <button class="fb-category-btn active group flex flex-col items-start gap-1 rounded-xl border border-border bg-secondary/60 p-3.5 text-left text-muted-foreground transition-colors hover:border-primary/40 is-active:border-primary is-active:bg-primary/10 is-active:text-foreground" data-cat="other" @click="selectFeedbackCategory($event.currentTarget)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-1 size-5 opacity-80"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
                  <span class="text-[13px] font-semibold">其他</span>
                  <span class="text-[11px] leading-snug text-muted-foreground">功能建议、体验优化等</span>
                </button>
              </div>
              <span class="form-hint">选择分类后将自动附带对应日志，请先复现问题再上传</span>
            </div>

            <div class="card">
              <h3>反馈内容</h3>
              <div class="form-group">
                <label>标题 <span class="fb-required">*</span></label>
                <VInput type="text" id="fb-title" class="text-[13px]" maxlength="50" placeholder="一句话概括你遇到的问题" @input="updateFeedbackSubmitState()" />
                <span class="form-hint">例如：启动 1.20.1 Forge 时崩溃并提示找不到主类</span>
              </div>
              <div class="form-group">
                <label>详细描述 <span class="fb-required">*</span></label>
                <VTextarea id="fb-detail" class="resize-y min-h-[140px] text-[13px] leading-relaxed" maxlength="2000" placeholder="请描述复现步骤、期望结果与实际结果，越具体越容易定位" @input="onFeedbackDetailInput()" />
                <span class="form-hint fb-counter" id="fb-detail-counter">0 / 2000</span>
              </div>
              <div class="form-group">
                <label>联系方式（选填）</label>
                <VInput type="text" id="fb-contact" class="text-[13px]" maxlength="80" placeholder="邮箱 / QQ，便于我们回复你" />
                <span class="form-hint">不填也能提交，但可能无法收到处理结果</span>
              </div>
            </div>

            <div class="card">
              <h3>日志附件<span class="fb-auto-log-badge" id="fb-auto-log-badge" hidden>自动收集</span></h3>
              <div class="fb-auto-log-tip" id="fb-auto-log-tip">选择「启动问题」或「下载问题」后自动收集 data/logs 下的相关日志</div>
              <div class="fb-file-list" id="fb-auto-log-list"></div>
              <span class="form-hint fb-warn">提交前请一定先复现问题，确保日志已记录到本次异常，再上传</span>
            </div>

            <div class="card">
              <h3>截图或视频</h3>
              <div class="fb-drop" id="fb-drop" @click="pickFeedbackFiles()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fb-drop-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="16"/></svg>
                <div class="fb-drop-title">点击选择文件，或把文件拖到这里</div>
                <div class="fb-drop-desc">支持截图、视频，最多 10 个，单个不超过 20 MB</div>
              </div>
              <input type="file" id="fb-file-input" multiple accept="image/*,video/*" hidden @change="onFeedbackFilesPicked($event.target.files)">
              <div class="fb-file-list" id="fb-file-list"></div>
            </div>

            <div class="card">
              <h3>环境信息</h3>
              <div class="form-group">
                <label class="checkbox-label">
                  <input type="checkbox" id="fb-include-env" checked>
                  <span>随反馈一并提交（推荐）</span>
                </label>
                <span class="form-hint">包含启动器版本、系统与 Java 信息，有助于快速定位问题</span>
              </div>
              <div class="fb-env-list" id="fb-env-list"></div>
            </div>

            <div class="card">
              <!-- 人机验证：接入站点验证码接口后在此渲染，未接入时保持隐藏 -->
              <div class="form-group fb-captcha-group" id="fb-captcha-group" hidden>
                <label>人机验证 <span class="fb-required">*</span></label>
                <div class="fb-captcha-row">
                  <VInput type="text" id="fb-captcha-input" class="flex-1 text-[13px] tracking-[4px]" maxlength="4" placeholder="输入图中 4 位字符" @input="updateFeedbackSubmitState()" />
                  <div class="fb-captcha-image" id="fb-captcha-image" @click="refreshFeedbackCaptcha()" title="看不清？点击换一张"></div>
                </div>
                <span class="form-hint">点击图片可更换</span>
              </div>
              <div class="fb-submit-bar">
                <span class="fb-submit-hint" id="fb-submit-hint"></span>
                <VButton variant="secondary" size="sm" id="fb-reset-btn" @click="resetFeedbackForm()">重置</VButton>
                <VButton variant="accent" id="fb-submit-btn" disabled @click="submitFeedback()">提交反馈</VButton>
              </div>
            </div>

          </div>
  `
};

export default PageFeedback;
