/**
 * AI 视频提示词生成器 - 后端服务
 * 零依赖，使用 Node.js 内置模块 (http + fetch)
 * Node.js >= 18 即可运行（推荐 v20+）
 *
 * 用法: node server.mjs
 */

import http from 'node:http';
import { URL } from 'node:url';

// ============================================================
// 模型路由
// ============================================================

const PROVIDER_BASE = {
    openai:   'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    gemini:   'https://generativelanguage.googleapis.com/v1beta',
};

const GEMINI_MODELS = {
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-pro':   'gemini-2.5-pro',
};

const MODEL_PROVIDER = {
    'gpt-4o':            'openai',
    'gpt-4o-mini':       'openai',
    'gpt-4.1':           'openai',
    'gpt-4.1-mini':      'openai',
    'gpt-4.1-nano':      'openai',
    'deepseek-chat':     'deepseek',
    'deepseek-reasoner': 'deepseek',
    'gemini-2.0-flash':  'gemini',
    'gemini-2.5-flash':  'gemini',
    'gemini-2.5-pro':    'gemini',
};

// 模型别名（前端可能只传大类名）
const MODEL_ALIAS = {
    'deepseek':  'deepseek-chat',
    'gpt':       'gpt-4.1-mini',
    'gemini':    'gemini-2.0-flash',
};

function resolveModel(model) {
    return MODEL_ALIAS[model] || model;
}

// ============================================================
// HTTP 服务
// ============================================================

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== 'POST' || url.pathname !== '/chat') {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let data;
    try { data = JSON.parse(body); } catch {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
    }

    const { model: rawModel, apiKey, messages, baseUrl } = data;
    if (!apiKey) return jsonError(res, 400, 'API Key 不能为空');
    if (!messages || !messages.length) return jsonError(res, 400, 'messages 不能为空');

    const model = resolveModel(rawModel);
    const provider = MODEL_PROVIDER[model];
    if (!provider) return jsonError(res, 400, `不支持的模型: ${model} (来自 "${rawModel}")`);

    try {
        let text;
        if (provider === 'gemini') {
            text = await callGemini(model, apiKey, messages, baseUrl);
        } else {
            text = await callOpenAICompatible(provider, model, apiKey, messages, baseUrl);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
    } catch (err) {
        console.error('API 调用失败:', err.message);
        jsonError(res, 502, err.message);
    }
});

function jsonError(res, status, message) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
}

// ============================================================
// OpenAI / DeepSeek
// ============================================================

async function callOpenAICompatible(provider, model, apiKey, messages, customBaseUrl) {
    const base = (customBaseUrl || PROVIDER_BASE[provider]).replace(/\/+$/, '');
    const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 2048 }),
        signal: AbortSignal.timeout(120000),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(`${provider} API 错误 (${resp.status}): ${json?.error?.message || JSON.stringify(json)}`);
    return json.choices[0].message.content;
}

// ============================================================
// Gemini
// ============================================================

async function callGemini(model, apiKey, messages, customBaseUrl) {
    const modelId = GEMINI_MODELS[model] || model;
    const base = (customBaseUrl || PROVIDER_BASE.gemini).replace(/\/+$/, '');
    const contents = [];
    let systemInstruction = null;
    for (const msg of messages) {
        if (msg.role === 'system') { systemInstruction = msg.content; continue; }
        contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] });
    }
    const payload = { contents };
    if (systemInstruction) payload.system_instruction = { parts: [{ text: systemInstruction }] };

    const resp = await fetch(`${base}/models/${modelId}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(`Gemini API 错误 (${resp.status}): ${json?.error?.message || JSON.stringify(json)}`);
    const candidates = json.candidates;
    if (!candidates || !candidates.length) throw new Error('Gemini 返回了空结果');
    return candidates[0].content.parts[0].text;
}

// ============================================================
// 启动
// ============================================================

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
    console.log(`   支持的模型: ${Object.keys(MODEL_PROVIDER).join(', ')}`);
    console.log(`   模型别名: deepseek→deepseek-chat, gpt→gpt-4.1-mini, gemini→gemini-2.0-flash`);
    console.log(`   自定义 Base URL: 支持填入兼容 OpenAI 格式的地址\n`);
});
