from collections.abc import AsyncGenerator

from gigachat import GigaChat
from gigachat.models import Chat, Messages, MessagesRole

from app.config import settings


def _create_client() -> GigaChat:
    return GigaChat(
        credentials=settings.gigachat_credentials,
        scope=settings.gigachat_scope,
        model=settings.gigachat_model,
        verify_ssl_certs=settings.gigachat_verify_ssl,
        timeout=300,
    )


def chat_completion(messages: list[dict[str, str]], max_retries: int = 3) -> str:
    """Synchronous chat completion with retry. Returns full response text."""
    import time
    for attempt in range(max_retries):
        try:
            client = _create_client()
            chat = Chat(
                messages=[
                    Messages(role=MessagesRole(m["role"]), content=m["content"])
                    for m in messages
                ],
                model=settings.gigachat_model,
            )
            response = client.chat(chat)
            return response.choices[0].message.content
        except Exception:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
    return ""


async def chat_completion_stream(
    messages: list[dict[str, str]],
) -> AsyncGenerator[str | dict, None]:
    """Stream chat completion tokens. Yields content deltas and finally usage info."""
    client = _create_client()
    chat = Chat(
        messages=[
            Messages(role=MessagesRole(m["role"]), content=m["content"])
            for m in messages
        ],
        model=settings.gigachat_model,
        stream=True,
    )
    usage = None
    for chunk in client.stream(chat):
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
        if hasattr(chunk, 'usage') and chunk.usage:
            usage = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "total_tokens": chunk.usage.total_tokens,
            }
    if usage:
        yield usage


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Get embeddings for a list of texts."""
    client = _create_client()
    response = client.embeddings(texts=texts, model="Embeddings")
    return [item.embedding for item in response.data]
