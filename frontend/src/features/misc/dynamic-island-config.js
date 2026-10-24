import { bridge as bridge } from '../../core/tauri-bridge.js';

export var AI_PROVIDERS = {
        zhipu:     { name: '智谱清言', icon: 'zhipu',     apiFormat: 'openai',     endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'glm-4-flash', name: 'GLM-4-Flash', free: true }, { id: 'glm-4', name: 'GLM-4' }] },
        deepseek:  { name: 'DeepSeek', icon: 'deepseek',  apiFormat: 'openai',     endpoint: 'https://api.deepseek.com/chat/completions',          authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'deepseek-chat', name: 'DeepSeek-V3' }, { id: 'deepseek-reasoner', name: 'DeepSeek-R1' }] },
        qwen:      { name: '通义千问', icon: 'qwen',      apiFormat: 'openai',     endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'qwen-turbo', name: 'Qwen Turbo' }, { id: 'qwen-plus', name: 'Qwen Plus' }] },
        moonshot:  { name: 'Kimi',     icon: 'moonshot',   apiFormat: 'openai',     endpoint: 'https://api.moonshot.cn/v1/chat/completions',          authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'moonshot-v1-8k', name: 'Moonshot 8K' }] },
        yi:        { name: '零一万物', icon: 'yi',        apiFormat: 'openai',     endpoint: 'https://api.lingyiwanwu.com/v1/chat/completions',    authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'yi-large', name: 'Yi-Large' }] },
        minimax:   { name: 'MiniMax', icon: 'minimax',    apiFormat: 'openai',     endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2', authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'MiniMax-Text-01', name: 'MiniMax-Text-01' }] },
        stepfun:   { name: '阶跃星辰', icon: 'stepfun',    apiFormat: 'openai',     endpoint: 'https://api.stepfun.com/v1/chat/completions',         authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'step-1-8k', name: 'Step-1 8K' }] },
        doubao:    { name: '豆包',     icon: 'doubao',     apiFormat: 'openai',     endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'doubao-pro-4k', name: 'Doubao Pro 4K' }] },
        siliconflow: { name: '硅基流动', icon: 'siliconflow', apiFormat: 'openai',  endpoint: 'https://api.siliconflow.cn/v1/chat/completions',      authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5-7B', free: true }] },
        openrouter: { name: 'OpenRouter', icon: 'openrouter', apiFormat: 'openai',   endpoint: 'https://openrouter.ai/api/v1/chat/completions',      authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' }] },
        groq:      { name: 'Groq',     icon: 'groq',       apiFormat: 'openai',     endpoint: 'https://api.groq.com/openai/v1/chat/completions',     authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', free: true }] },
        openai:    { name: 'OpenAI',   icon: 'openai',     apiFormat: 'openai',     endpoint: 'https://api.openai.com/v1/chat/completions',          authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'gpt-4o-mini', name: 'GPT-4o mini' }, { id: 'gpt-4o', name: 'GPT-4o' }] },
        anthropic: { name: 'Anthropic', icon: 'anthropic', apiFormat: 'anthropic',  endpoint: 'https://api.anthropic.com/v1/messages',              authHeader: 'x-api-key',     authPrefix: '',        models: [{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' }] },
        google:    { name: 'Google Gemini', icon: 'gemini', apiFormat: 'google',    endpoint: '',                                                   authHeader: 'url_key',      authPrefix: '',        models: [{ id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', free: true }] },
        baichuan:  { name: '百川',     icon: 'baichuan',   apiFormat: 'openai',     endpoint: 'https://api.baichuan-ai.com/v1/chat/completions',     authHeader: 'Authorization', authPrefix: 'Bearer ', models: [{ id: 'Baichuan4', name: 'Baichuan4' }] }
    };

    function _getAIConfig() {
        try { return JSON.parse(localStorage.getItem('v-island-ai-config') || '{}'); }
        catch (_) { return {}; }
    }

    function _saveAIConfig(cfg) {
        try { localStorage.setItem('v-island-ai-config', JSON.stringify(cfg)); return true; }
        catch (_) { return false; }
    }

    function _buildBody(format, model, messages) {
        if (format === 'anthropic') return { model: model, messages: messages, max_tokens: 1024 };
        if (format === 'google') return { contents: messages.map(function (m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }; }) };
        return { model: model, messages: messages, stream: false };
    }

    function _extractReply(format, data) {
        try {
            if (format === 'anthropic') return (data.content || []).map(function (c) { return c.text; }).join('') || '(空回复)';
            if (format === 'google') return (data.candidates[0].content.parts || []).map(function (p) { return p.text; }).join('') || '(空回复)';
            return data.choices[0].message.content || '(空回复)';
        } catch (e) { return '(解析回复失败)'; }
    }

    function _friendlyError(status, body) {
        var raw = (body || '').substring(0, 300);
        var lower = raw.toLowerCase();
        if (status === 402 || lower.indexOf('insufficient_balance') !== -1 ||
            lower.indexOf('insufficient balance') !== -1 ||
            lower.indexOf('insufficient_quota') !== -1 ||
            lower.indexOf('insufficient quota') !== -1) {
            return 'AI 账户余额不足，请登录对应服务商官网充值后重试（错误码 ' + status + '）';
        }
        if (status === 401 || lower.indexOf('invalid api key') !== -1 ||
            lower.indexOf('invalid_api_key') !== -1 ||
            lower.indexOf('unauthorized') !== -1) {
            return 'API Key 无效或已过期，请在设置中检查并重新填写正确的 API Key（错误码 ' + status + '）';
        }
        if (status === 403 || lower.indexOf('permission_denied') !== -1 ||
            lower.indexOf('forbidden') !== -1) {
            return 'API Key 权限不足或请求内容被拒绝，请检查 Key 权限或换一种说法重试（错误码 ' + status + '）';
        }
        if (status === 429 || lower.indexOf('rate_limit') !== -1 ||
            lower.indexOf('rate limit') !== -1 ||
            lower.indexOf('too many requests') !== -1) {
            return '请求过于频繁，已触发限流，请稍等几秒后重试（错误码 ' + status + '）';
        }
        if (status === 404 || lower.indexOf('model not found') !== -1 ||
            lower.indexOf('model_not_found') !== -1) {
            return '接口地址或模型名称不正确，请检查供应商配置和所选模型是否匹配（错误码 ' + status + '）';
        }
        if (status === 413 || lower.indexOf('too large') !== -1 ||
            lower.indexOf('context length') !== -1) {
            return '对话内容过长，超出了 AI 模型的处理上限，请缩短内容后重试（错误码 ' + status + '）';
        }
        if (status === 400 || lower.indexOf('invalid_request') !== -1 ||
            lower.indexOf('invalid request') !== -1) {
            return '请求参数有误，可能是模型名称或消息格式不正确（错误码 ' + status + '）';
        }
        if (status >= 500) {
            return 'AI 服务商暂时不可用，请稍后重试（错误码 ' + status + '）';
        }
        return 'AI 请求失败（错误码 ' + status + '）：' + raw;
    }

    async function chatWithAI(messages) {
        var cfg = _getAIConfig();
        if (!cfg.provider || !cfg.apiKey) return '我还没接入 AI，请先在 V 岛设置中配置供应商。';
        if (!cfg.model) return '未选择模型。';

        // 自定义供应商需要补全 apiFormat 和 endpoint
        var reqConfig = {
            provider: cfg.provider,
            apiKey: cfg.apiKey,
            model: cfg.model,
            messages: messages
        };

        if (cfg.provider === 'custom') {
            if (!cfg.endpoint) return '自定义供应商未配置接口地址。';
            reqConfig.endpoint = cfg.endpoint;
            reqConfig.apiFormat = cfg.apiFormat || 'openai';
        } else {
            // 预设供应商：从 AI_PROVIDERS 取接口地址和格式
            var p = AI_PROVIDERS[cfg.provider];
            if (!p) return '不支持的供应商：' + cfg.provider;
            reqConfig.endpoint = p.endpoint;
            reqConfig.apiFormat = p.apiFormat;
            // Google 的 endpoint 是空的，特殊处理
            if (cfg.provider === 'google') {
                reqConfig.endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + cfg.model + ':generateContent';
            }
        }

        // 通过 IPC 调用主进程发起请求，绕过 CORS
        if (bridge && bridge.ai && bridge.ai.chat) {
            try {
                var res = await bridge.ai.chat(reqConfig);
                if (res && res.ok) return res.reply || '(空回复)';
                return '对话失败：' + (res && res.error ? res.error : '未知错误');
            } catch (e) {
                return '对话出错：' + (e.message || e);
            }
        }

        // 降级：渲染进程直接 fetch（可能被 CORS 拦截）
        console.warn('[V岛] 主进程 AI 代理不可用，降级到渲染进程 fetch');
        try {
            var headers = { 'Content-Type': 'application/json' };
            var url;
            if (reqConfig.apiFormat === 'google') {
                url = reqConfig.endpoint + '?key=' + cfg.apiKey;
            } else if (reqConfig.apiFormat === 'anthropic') {
                url = reqConfig.endpoint;
                headers['x-api-key'] = cfg.apiKey;
                headers['anthropic-version'] = '2023-06-01';
            } else {
                url = reqConfig.endpoint;
                headers['Authorization'] = 'Bearer ' + cfg.apiKey;
            }
            var body = _buildBody(reqConfig.apiFormat, cfg.model, messages);
            var resp = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
            if (!resp.ok) {
                var t = await resp.text().catch(function () { return ''; });
                return _friendlyError(resp.status, t);
            }
            var data = await resp.json();
            return _extractReply(reqConfig.apiFormat, data);
        } catch (e) {
            return '对话出错：' + (e.message || e);
        }
    }

export { _getAIConfig, _saveAIConfig, _buildBody, _extractReply, _friendlyError, chatWithAI };
