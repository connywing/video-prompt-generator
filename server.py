"""
AI 视频提示词生成器 - 后端服务
用法: pip install flask requests && python3 server.py
"""

import os
import json
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ============================================================
# API 路由
# ============================================================

SUPPORTED_MODELS = {
    # model_id -> { base_url, path, format }
    "gpt-4o":              {"provider": "openai"},
    "gpt-4o-mini":         {"provider": "openai"},
    "gpt-4.1":             {"provider": "openai"},
    "gpt-4.1-mini":        {"provider": "openai"},
    "gpt-4.1-nano":        {"provider": "openai"},
    "deepseek-chat":       {"provider": "deepseek"},
    "deepseek-reasoner":   {"provider": "deepseek"},
    "gemini-2.0-flash":    {"provider": "gemini"},
    "gemini-2.5-flash":    {"provider": "gemini"},
    "gemini-2.5-pro":      {"provider": "gemini"},
}

PROVIDER_BASE = {
    "openai":   "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "gemini":   "https://generativelanguage.googleapis.com/v1beta",
}

PROVIDER_MODEL_MAP = {
    # Gemini 需要映射到完整 model name
    "gemini-2.0-flash":  "gemini-2.0-flash",
    "gemini-2.5-flash":  "gemini-2.5-flash",
    "gemini-2.5-pro":    "gemini-2.5-pro",
}


@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json(force=True)
    model = data.get('model', '')
    api_key = data.get('apiKey', '')
    messages = data.get('messages', [])
    base_url = data.get('baseUrl', '').strip()

    if not api_key:
        return jsonify({"error": "API Key 不能为空"}), 400
    if not messages:
        return jsonify({"error": "messages 不能为空"}), 400

    info = SUPPORTED_MODELS.get(model)
    if not info:
        return jsonify({"error": f"不支持的模型: {model}"}), 400

    provider = info["provider"]

    try:
        if provider == "openai":
            result = call_openai(model, api_key, messages, base_url)
        elif provider == "deepseek":
            result = call_deepseek(model, api_key, messages, base_url)
        elif provider == "gemini":
            result = call_gemini(model, api_key, messages, base_url)
        else:
            return jsonify({"error": f"未知 provider: {provider}"}), 500

        return jsonify({"text": result})

    except requests.exceptions.Timeout:
        return jsonify({"error": "请求超时，请检查网络或 API 地址"}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({"error": "无法连接到 API 服务器，请检查网络或 Base URL"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# Provider 调用
# ============================================================

def call_openai(model, api_key, messages, custom_base_url):
    base = custom_base_url or PROVIDER_BASE["openai"]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.8,
        "max_tokens": 2048,
    }
    resp = requests.post(
        f"{base.rstrip('/')}/chat/completions",
        headers=headers,
        json=payload,
        timeout=60,
    )
    if resp.status_code != 200:
        err = resp.json()
        raise Exception(f"OpenAI API 错误 ({resp.status_code}): {err.get('error', {}).get('message', resp.text)}")

    return resp.json()["choices"][0]["message"]["content"]


def call_deepseek(model, api_key, messages, custom_base_url):
    base = custom_base_url or PROVIDER_BASE["deepseek"]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.8,
        "max_tokens": 2048,
    }
    resp = requests.post(
        f"{base.rstrip('/')}/chat/completions",
        headers=headers,
        json=payload,
        timeout=60,
    )
    if resp.status_code != 200:
        err = resp.json()
        raise Exception(f"DeepSeek API 错误 ({resp.status_code}): {err.get('error', {}).get('message', resp.text)}")

    return resp.json()["choices"][0]["message"]["content"]


def call_gemini(model, api_key, messages, custom_base_url):
    model_id = PROVIDER_MODEL_MAP.get(model, model)
    base = custom_base_url or PROVIDER_BASE["gemini"]
    url = f"{base.rstrip('/')}/models/{model_id}:generateContent"

    # 将 OpenAI 格式的 messages 转为 Gemini 格式
    contents = []
    system_instruction = None

    for msg in messages:
        role = msg["role"]
        text = msg["content"]

        if role == "system":
            system_instruction = text
            continue

        contents.append({
            "role": "user" if role == "user" else "model",
            "parts": [{"text": text}],
        })

    payload = {"contents": contents}
    if system_instruction:
        payload["system_instruction"] = {"parts": [{"text": system_instruction}]}

    resp = requests.post(
        f"{url}?key={api_key}",
        json=payload,
        timeout=60,
    )
    if resp.status_code != 200:
        err = resp.json()
        raise Exception(f"Gemini API 错误 ({resp.status_code}): {err.get('error', {}).get('message', resp.text)}")

    candidates = resp.json().get("candidates", [])
    if not candidates:
        raise Exception("Gemini 返回了空结果")

    return candidates[0]["content"]["parts"][0]["text"]


# ============================================================
# 启动
# ============================================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"🚀 后端服务已启动: http://localhost:{port}")
    print(f"   支持的模型: {', '.join(SUPPORTED_MODELS.keys())}")
    print(f"   自定义 Base URL 支持: 可在前端填入兼容 OpenAI 格式的地址\n")
    app.run(host="0.0.0.0", port=port, debug=True)
