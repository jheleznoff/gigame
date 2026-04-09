import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document import Document
from app.models.knowledge_base import KBDocument, KnowledgeBase
from app.services import gigachat_client, vector_store
from app.services.document_service import chunk_text

logger = logging.getLogger(__name__)


async def get_knowledge_bases(db: AsyncSession, search: str = "") -> list[KnowledgeBase]:
    query = select(KnowledgeBase).order_by(KnowledgeBase.updated_at.desc())
    if search:
        query = query.where(KnowledgeBase.name.ilike(f"%{search}%"))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_knowledge_base(db: AsyncSession, kb_id: str) -> KnowledgeBase | None:
    result = await db.execute(
        select(KnowledgeBase)
        .where(KnowledgeBase.id == kb_id)
        .options(
            selectinload(KnowledgeBase.documents).selectinload(KBDocument.document)
        )
    )
    return result.scalar_one_or_none()


async def create_knowledge_base(
    db: AsyncSession, name: str, description: str | None = None
) -> KnowledgeBase:
    kb = KnowledgeBase(name=name, description=description)
    db.add(kb)
    await db.commit()
    await db.refresh(kb)
    return kb


async def update_knowledge_base(
    db: AsyncSession, kb_id: str, name: str | None = None, description: str | None = None
) -> KnowledgeBase | None:
    kb = await get_knowledge_base(db, kb_id)
    if not kb:
        return None
    if name is not None:
        kb.name = name
    if description is not None:
        kb.description = description
    await db.commit()
    await db.refresh(kb)
    return kb


async def delete_knowledge_base(db: AsyncSession, kb_id: str) -> bool:
    kb = await get_knowledge_base(db, kb_id)
    if not kb:
        return False
    vector_store.kb_delete_collection(kb_id)
    await db.delete(kb)
    await db.commit()
    return True


async def add_document_to_kb(
    db: AsyncSession, kb_id: str, document_id: str
) -> KBDocument:
    """Add a document to a knowledge base and index it."""
    kb_doc = KBDocument(
        knowledge_base_id=kb_id,
        document_id=document_id,
        status="processing",
    )
    db.add(kb_doc)
    await db.commit()
    await db.refresh(kb_doc)

    # Index document
    try:
        doc = await db.get(Document, document_id)
        if not doc or not doc.extracted_text:
            raise ValueError("Document has no extracted text")

        chunks = chunk_text(doc.extracted_text)
        if not chunks:
            raise ValueError("Document produced no chunks")

        all_embeddings: list[list[float]] = []
        for i in range(0, len(chunks), 50):
            batch = chunks[i : i + 50]
            all_embeddings.extend(gigachat_client.get_embeddings(batch))

        vector_store.kb_store_chunks(kb_id, document_id, chunks, all_embeddings)

        kb_doc.chunk_count = len(chunks)
        kb_doc.status = "ready"
        logger.info(
            "Indexed document %s into KB %s: %d chunks",
            document_id, kb_id, len(chunks),
        )
    except Exception as e:
        logger.exception("Failed to index document %s into KB %s", document_id, kb_id)
        kb_doc.status = "error"
        kb_doc.error_message = str(e)

    await db.commit()
    await db.refresh(kb_doc)
    return kb_doc


async def reindex_document(
    db: AsyncSession, kb_id: str, document_id: str
) -> KBDocument | None:
    """Retry indexing a failed document."""
    result = await db.execute(
        select(KBDocument).where(
            KBDocument.knowledge_base_id == kb_id,
            KBDocument.document_id == document_id,
        )
    )
    kb_doc = result.scalar_one_or_none()
    if not kb_doc:
        return None

    # Clean up old chunks
    vector_store.kb_remove_document(kb_id, document_id)

    kb_doc.status = "processing"
    kb_doc.error_message = None
    await db.commit()

    try:
        doc = await db.get(Document, document_id)
        if not doc or not doc.extracted_text:
            raise ValueError("Document has no extracted text")

        chunks = chunk_text(doc.extracted_text)
        if not chunks:
            raise ValueError("Document produced no chunks")

        all_embeddings: list[list[float]] = []
        for i in range(0, len(chunks), 50):
            batch = chunks[i : i + 50]
            all_embeddings.extend(gigachat_client.get_embeddings(batch))

        vector_store.kb_store_chunks(kb_id, document_id, chunks, all_embeddings)
        kb_doc.chunk_count = len(chunks)
        kb_doc.status = "ready"
    except Exception as e:
        logger.exception("Reindex failed for document %s in KB %s", document_id, kb_id)
        kb_doc.status = "error"
        kb_doc.error_message = str(e)

    await db.commit()
    await db.refresh(kb_doc)
    return kb_doc


async def remove_document_from_kb(
    db: AsyncSession, kb_id: str, document_id: str
) -> bool:
    result = await db.execute(
        select(KBDocument).where(
            KBDocument.knowledge_base_id == kb_id,
            KBDocument.document_id == document_id,
        )
    )
    kb_doc = result.scalar_one_or_none()
    if not kb_doc:
        return False
    vector_store.kb_remove_document(kb_id, document_id)
    await db.delete(kb_doc)
    await db.commit()
    return True
