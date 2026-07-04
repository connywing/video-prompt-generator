/**
 * AI 视频提示词生成器 - 后端服务 (Node.js)
 *
 * 用法:
 *   npm install express
 *   node server.js
 *
 * 支持的 AI 模型: GPT / DeepSeek / Gemini
 * 支持自定义 Base URL (兼容 OpenAI 格式)
 */

import express from 'express';
import { createServer } from 'http';

const app = express();
app.use(express.json());

// ============================================================
// CORS
// ============================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ============================================================
// 模型路由
// ============================================================

const PROVIDERS = {
    openai:   'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    gemini:   'https://generativelanguage.googleapis.com/v1beta',
};

// Gemini 模型名映射
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

// ============================================================
// POST /chat
// ============================================================

app.post('/chat', async (req, res) => {
    const { model, apiKey, messages, baseUrl } = req.body;

    if (!apiKey) return res.status(400).json({ error: 'API Key 不能为空' });
    if (!messages || !messages.length) return res.status(400).json({ error: 'messages 不能为空' });

    const provider = MODEL_PROVIDER[model];
    if (!provider) return res.status(400).json({ error: `不支持的模型: ${model}` });

    try {
        let text;
        if (provider === 'gemini') {
            text = await callGemini(model, apiKey, messages, baseUrl);
        } else {
            text = await callOpenAICompatible(provider, model, apiKey, messages, baseUrl);
        }
        res.json({ text });
    } catch (err) {
        console.error('API 调用失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// ============================================================
// OpenAI / DeepSeek（兼容接口）
// ============================================================

async function callOpenAICompatible(provider, model, apiKey, messages, customBaseUrl) {
    const base = (customBaseUrl || PROVIDERS[provider]).replace(/\/+$/, '');
    const url = `${base}/chat/completions`;

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.8,
            max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(60000),
    });

    const data = await resp.json();
    if (!resp.ok) {
        throw new Error(`${provider} API 错误 (${resp.status}): ${data?.error?.message || JSON.stringify(data)}`);
    }
    return data.choices[0].message.content;
}

// ============================================================
// Gemini
// ============================================================

async function callGemini(model, apiKey, messages, customBaseUrl) {
    const modelId = GEMINI_MODELS[model] || model;
    const base = (customBaseUrl || PROVIDERS.gemini).replace(/\/+$/, '');
    const url = `${base}/models/${modelId}:generateContent?key=${apiKey}`;

    // 转换消息格式
    const contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = msg.content;
            continue;
        }
        contents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
        });
    }

    const payload = { contents };
    if (systemInstruction) {
        payload.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
    });

    const data = await resp.json();
    if (!resp.ok) {
        throw new Error(`Gemini API 错误 (${resp.status}): ${data?.error?.message || JSON.stringify(data)}`);
    }

    const candidates = data.candidates;
    if (!candidates || !candidates.length) throw new Error('Gemini 返回了空结果');

    return candidates[0].content.parts[0].text;
}

// ============================================================
// 启动
// ============================================================

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
    console.log(`   支持的模型: ${Object.keys(MODEL_PROVIDER).join(', ')}`);
    console.log(`   自定义 Base URL: 支持填入兼容 OpenAI 格式的地址\n`);
});
