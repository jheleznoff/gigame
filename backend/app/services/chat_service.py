import logging
from collections.abc import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chat import Conversation, Message
from app.services import gigachat_client, vector_store
from app.services.document_service import CONTEXT_CHAR_LIMIT

logger = logging.getLogger(__name__)


async def get_conversations(db: AsyncSession, search: str = "") -> list[Conversation]:
    query = select(Conversation).order_by(Conversation.updated_at.desc())
    if search:
        query = query.where(Conversation.title.ilike(f"%{search}%"))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_conversation(db: AsyncSession, conversation_id: str) -> Conversation | None:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(selectinload(Conversation.messages))
    )
    return result.scalar_one_or_none()


async def create_conversation(
    db: AsyncSession, title: str | None = None, knowledge_base_id: str | None = None
) -> Conversation:
    conversation = Conversation(
        title=title or "Новый диалог",
        knowledge_base_id=knowledge_base_id,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def delete_conversation(db: AsyncSession, conversation_id: str) -> bool:
    conversation = await get_conversation(db, conversation_id)
    if not conversation:
        return False
    await db.delete(conversation)
    await db.commit()
    return True


def _build_documents_context(
    document_ids: list[str],
    document_texts: list[str],
    query: str,
) -> str:
    """Build system context from one or more documents.

    Strategy: process each document individually.
    - Small docs (< CONTEXT_CHAR_LIMIT) are included in full.
    - Large docs get similarity search with more chunks.
    This ensures small documents (like a KP) are never lost,
    while large ones (like a PZ) are searched for relevant parts.
    """
    combined_text = "\n\n".join(document_texts)
    total_len = len(combined_text)

    if total_len <= CONTEXT_CHAR_LIMIT:
        # All documents fit — include everything
        header = (
            f"Пользователь загрузил {len(document_texts)} документ(ов). "
            "Используй их содержимое для ответа на вопросы.\n\n"
        )
        parts = []
        for i, text in enumerate(document_texts):
            parts.append(f"--- ДОКУМЕНТ {i + 1} ---\n{text}\n--- КОНЕЦ ДОКУМЕНТА {i + 1} ---")
        return header + "\n\n".join(parts)

    # Mixed strategy: small docs in full, large docs via similarity search
    parts: list[str] = []
    budget = CONTEXT_CHAR_LIMIT
    query_embedding = None

    for i, (doc_id, text) in enumerate(zip(document_ids, document_texts)):
        doc_num = i + 1

        if len(text) <= budget:
            # Document fits in remaining budget — include in full
            parts.append(
                f"--- ДОКУМЕНТ {doc_num} (полный текст) ---\n{text}\n"
                f"--- КОНЕЦ ДОКУМЕНТА {doc_num} ---"
            )
            budget -= len(text)
        else:
            # Document too large — similarity search
            chunks: list[str] = []
            try:
                if query_embedding is None:
                    query_embedding = gigachat_client.get_embeddings([query])[0]
                chunks = vector_store.search_similar(doc_id, query_embedding, top_k=7)
            except Exception:
                logger.exception("Similarity search failed for document %s", doc_id)

            if chunks:
                joined = "\n\n".join(chunks)
                # Only use what fits in budget
                if len(joined) > budget:
                    joined = joined[:budget]
                parts.append(
                    f"--- ДОКУМЕНТ {doc_num} (релевантные фрагменты) ---\n{joined}\n"
                    f"--- КОНЕЦ ДОКУМЕНТА {doc_num} ---"
                )
                budget -= len(joined)
            else:
                # Fallback: truncate to remaining budget
                truncated = text[:max(budget, 2000)]
                parts.append(
                    f"--- ДОКУМЕНТ {doc_num} (обрезан) ---\n{truncated}\n"
                    f"--- КОНЕЦ ДОКУМЕНТА {doc_num} ---"
                )
                budget -= len(truncated)

    header = (
        f"Пользователь загрузил {len(document_texts)} документ(ов). "
        "Используй их содержимое для ответа на вопросы.\n\n"
    )
    return header + "\n\n".join(parts)


def _build_rag_context(kb_id: str, query: str) -> str | None:
    """Search knowledge base and build context from relevant chunks."""
    try:
        query_embedding = gigachat_client.get_embeddings([query])[0]
        chunks = vector_store.kb_search_similar(kb_id, query_embedding, top_k=5)
        if not chunks:
            return None
        logger.info("RAG: found %d chunks in KB %s", len(chunks), kb_id)
        joined = "\n\n---\n\n".join(chunks)
        return (
            "Ты — ассистент с доступом к базе знаний. Используй приведённые ниже "
            "фрагменты для ответа на вопрос пользователя. Если информации недостаточно, "
            "скажи об этом.\n\n"
            "--- ФРАГМЕНТЫ ИЗ БАЗЫ ЗНАНИЙ ---\n"
            f"{joined}\n"
            "--- КОНЕЦ ФРАГМЕНТОВ ---"
        )
    except Exception:
        logger.exception("RAG search failed for KB %s", kb_id)
        return None


async def send_message_stream(
    db: AsyncSession,
    conversation_id: str,
    content: str,
    document_ids: list[str] | None = None,
    document_texts: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """Save user message, stream GigaChat response, save assistant message."""
    conversation = await get_conversation(db, conversation_id)
    if not conversation:
        raise ValueError("Conversation not found")

    # Save user message
    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=content,
        document_ids=document_ids or [],
    )
    db.add(user_message)
    await db.commit()

    # Build message history for GigaChat
    messages: list[dict[str, str]] = []

    # If documents attached to this message, add as system context
    if document_ids and document_texts:
        messages.append({
            "role": "system",
            "content": _build_documents_context(document_ids, document_texts, content),
        })
    # If conversation is linked to a knowledge base, use RAG
    elif conversation.knowledge_base_id:
        rag_context = _build_rag_context(conversation.knowledge_base_id, content)
        if rag_context:
            messages.append({"role": "system", "content": rag_context})

    # Add conversation history
    for msg in conversation.messages:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": content})

    # Stream response
    full_response = ""
    usage_info = None
    async for chunk in gigachat_client.chat_completion_stream(messages):
        if isinstance(chunk, dict):
            usage_info = chunk
        else:
            full_response += chunk
            yield chunk

    # Yield usage info as a special marker
    if usage_info:
        yield usage_info

    # Save assistant message
    assistant_message = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=full_response,
    )
    db.add(assistant_message)
    await db.commit()

    # Auto-generate title after first message exchange
    if conversation.title == "Новый диалог" and len(conversation.messages) <= 1:
        try:
            title_response = gigachat_client.chat_completion([
                {
                    "role": "system",
                    "content": "Придумай короткий заголовок (3-5 слов) для диалога на основе первого сообщения пользователя. Верни только заголовок, без кавычек и пояснений.",
                },
                {"role": "user", "content": content},
            ])
            new_title = title_response.strip().strip('"').strip("'")[:100]
            if new_title:
                conversation.title = new_title
                await db.commit()
        except Exception:
            logger.exception("Failed to auto-generate title")
