"""
DeepSeek API 客户端
提供 SSE 流式调用 DeepSeek Chat API 的能力
"""
import os
import json
import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"  # deepseek-chat = V3, deepseek-reasoner = R1


async def chat_stream(
    messages: list,
    system_prompt: str = "",
    model: str = DEFAULT_MODEL,
    temperature: float = 0.7,
    max_tokens: int = 4096,
):
    """
    调用 DeepSeek API，返回 SSE 流式响应。

    Args:
        messages: OpenAI 格式的消息列表 [{"role": "user", "content": "..."}]
        system_prompt: 系统提示词
        model: 模型名称
        temperature: 生成温度
        max_tokens: 最大输出 token 数

    Yields:
        str: 每次返回的文本片段
    """
    if not DEEPSEEK_API_KEY:
        yield "⚠️ DeepSeek API Key 未配置。请在 backend/.env 中设置 DEEPSEEK_API_KEY。"
        return

    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            *messages,
        ],
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{DEEPSEEK_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    yield f"⚠️ DeepSeek API 请求失败 (HTTP {response.status_code}): {error_body.decode('utf-8', errors='replace')}"
                    return

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            delta = chunk["choices"][0]["delta"]
                            if "content" in delta:
                                yield delta["content"]
                        except (json.JSONDecodeError, KeyError):
                            continue

    except httpx.TimeoutException:
        yield "⚠️ DeepSeek API 请求超时，请稍后重试。"
    except httpx.ConnectError:
        yield "⚠️ 无法连接到 DeepSeek API，请检查网络连接。"
    except Exception as e:
        yield f"⚠️ 请求出错: {str(e)}"
