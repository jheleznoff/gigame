from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.knowledge_base import (
    KBCreate,
    KBDetailResponse,
    KBDocumentResponse,
    KBResponse,
    KBUpdate,
)
from app.services import document_service, kb_service

router = APIRouter(prefix="/api/knowledge-bases", tags=["knowledge-bases"])


@router.get("", response_model=list[KBResponse])
async def list_knowledge_bases(q: str = "", db: AsyncSession = Depends(get_db)):
    return await kb_service.get_knowledge_bases(db, search=q)


@router.post("", response_model=KBResponse, status_code=201)
async def create_knowledge_base(body: KBCreate, db: AsyncSession = Depends(get_db)):
    return await kb_service.create_knowledge_base(db, name=body.name, description=body.description)


@router.get("/{kb_id}", response_model=KBDetailResponse)
async def get_knowledge_base(kb_id: str, db: AsyncSession = Depends(get_db)):
    kb = await kb_service.get_knowledge_base(db, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    # Build response with document info
    docs = []
    for kbd in kb.documents:
        docs.append(KBDocumentResponse(
            id=kbd.id,
            document_id=kbd.document_id,
            filename=kbd.document.filename,
            content_type=kbd.document.content_type,
            size_bytes=kbd.document.size_bytes,
            chunk_count=kbd.chunk_count,
            status=kbd.status,
            error_message=kbd.error_message,
            created_at=kbd.created_at,
        ))
    return KBDetailResponse(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        created_at=kb.created_at,
        updated_at=kb.updated_at,
        documents=docs,
    )


@router.put("/{kb_id}", response_model=KBResponse)
async def update_knowledge_base(
    kb_id: str, body: KBUpdate, db: AsyncSession = Depends(get_db)
):
    kb = await kb_service.update_knowledge_base(
        db, kb_id, name=body.name, description=body.description
    )
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return kb


@router.delete("/{kb_id}", status_code=204)
async def delete_knowledge_base(kb_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await kb_service.delete_knowledge_base(db, kb_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge base not found")


@router.post("/{kb_id}/documents", response_model=KBDocumentResponse, status_code=201)
async def upload_document_to_kb(
    kb_id: str, file: UploadFile, db: AsyncSession = Depends(get_db)
):
    kb = await kb_service.get_knowledge_base(db, kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    try:
        doc = await document_service.upload_document(db, file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    kb_doc = await kb_service.add_document_to_kb(db, kb_id, doc.id)
    return KBDocumentResponse(
        id=kb_doc.id,
        document_id=doc.id,
        filename=doc.filename,
        content_type=doc.content_type,
        size_bytes=doc.size_bytes,
        chunk_count=kb_doc.chunk_count,
        status=kb_doc.status,
        error_message=kb_doc.error_message,
        created_at=kb_doc.created_at,
    )


@router.post("/{kb_id}/documents/{document_id}/reindex", response_model=KBDocumentResponse)
async def reindex_document(
    kb_id: str, document_id: str, db: AsyncSession = Depends(get_db)
):
    """Retry indexing a failed document."""
    kb_doc = await kb_service.reindex_document(db, kb_id, document_id)
    if not kb_doc:
        raise HTTPException(status_code=404, detail="Document not found in knowledge base")
    doc = await document_service.get_document(db, document_id)
    return KBDocumentResponse(
        id=kb_doc.id,
        document_id=doc.id,
        filename=doc.filename,
        content_type=doc.content_type,
        size_bytes=doc.size_bytes,
        chunk_count=kb_doc.chunk_count,
        status=kb_doc.status,
        error_message=kb_doc.error_message,
        created_at=kb_doc.created_at,
    )


@router.delete("/{kb_id}/documents/{document_id}", status_code=204)
async def remove_document_from_kb(
    kb_id: str, document_id: str, db: AsyncSession = Depends(get_db)
):
    removed = await kb_service.remove_document_from_kb(db, kb_id, document_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Document not found in knowledge base")
