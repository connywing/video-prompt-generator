/**
 * Cloudflare Pages Function - /chat
 * 代理 AI API 调用（OpenAI / DeepSeek / Gemini / 自定义兼容接口）
 */

// 默认 Base URL
const PROVIDERS = {
  openai:   'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  gemini:   'https://generativelanguage.googleapis.com/v1beta',
};

// 模型 → 提供商映射
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

// CORS headers
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function onRequest(context) {
  const { request } = context;

  // 处理 OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 只接受 POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  try {
    const { model, apiKey, messages, baseUrl } = await request.json();

    if (!apiKey) {
      return jsonResponse({ error: 'API Key 不能为空' }, 400);
    }
    if (!messages || !messages.length) {
      return jsonResponse({ error: 'messages 不能为空' }, 400);
    }

    const provider = MODEL_PROVIDER[model];
    if (!provider) {
      return jsonResponse({ error: `不支持的模型: ${model}` }, 400);
    }

    let text;
    if (provider === 'gemini') {
      text = await callGemini(model, apiKey, messages, baseUrl);
    } else {
      text = await callOpenAICompatible(provider, model, apiKey, messages, baseUrl);
    }

    return jsonResponse({ text });
  } catch (err) {
    console.error('API 调用失败:', err.message);
    return jsonResponse({ error: err.message }, 502);
  }
}

// ============================================================
// OpenAI / DeepSeek 兼容接口
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
  const base = (customBaseUrl || PROVIDERS.gemini).replace(/\/+$/, '');
  const url = `${base}/models/${model}:generateContent?key=${apiKey}`;

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
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Gemini API 错误 (${resp.status}): ${data?.error?.message || JSON.stringify(data)}`);
  }

  const candidates = data.candidates;
  if (!candidates || !candidates.length) {
    throw new Error('Gemini 返回了空结果');
  }

  return candidates[0].content.parts[0].text;
}

// ============================================================
// 工具函数
// ============================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
