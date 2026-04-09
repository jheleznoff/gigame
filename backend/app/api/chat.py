import json

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.schemas.chat import (
    ConversationCreate,
    ConversationResponse,
    ConversationWithMessages,
    SendMessageRequest,
)
from app.services import chat_service, document_service

router = APIRouter(prefix="/api/conversations", tags=["chat"])


@router.get("", response_model=list[ConversationResponse])
async def list_conversations(q: str = "", db: AsyncSession = Depends(get_db)):
    return await chat_service.get_conversations(db, search=q)


@router.post("", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    body: ConversationCreate, db: AsyncSession = Depends(get_db)
):
    return await chat_service.create_conversation(
        db, title=body.title, knowledge_base_id=body.knowledge_base_id
    )


@router.get("/{conversation_id}", response_model=ConversationWithMessages)
async def get_conversation(
    conversation_id: str, db: AsyncSession = Depends(get_db)
):
    conversation = await chat_service.get_conversation(db, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str, db: AsyncSession = Depends(get_db)
):
    deleted = await chat_service.delete_conversation(db, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    async def event_generator():
        try:
            async for chunk in chat_service.send_message_stream(
                db, conversation_id, body.content
            ):
                if isinstance(chunk, dict):
                    yield {"data": json.dumps({"usage": chunk}, ensure_ascii=False)}
                else:
                    yield {"data": json.dumps({"content": chunk}, ensure_ascii=False)}
            yield {"data": json.dumps({"done": True})}
        except ValueError as e:
            yield {"data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())


@router.post("/{conversation_id}/messages/upload")
async def send_message_with_documents(
    conversation_id: str,
    content: str = Form(...),
    files: list[UploadFile] = [],
    db: AsyncSession = Depends(get_db),
):
    """Send a message with one or more document attachments."""
    document_ids: list[str] = []
    document_texts: list[str] = []

    for file in files:
        if file and file.filename:
            try:
                doc = await document_service.upload_document(db, file)
                document_ids.append(doc.id)
                document_texts.append(doc.extracted_text or "")
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

    async def event_generator():
        try:
            if document_ids:
                yield {
                    "data": json.dumps(
                        {"document_ids": document_ids}, ensure_ascii=False
                    )
                }
            async for chunk in chat_service.send_message_stream(
                db, conversation_id, content,
                document_ids=document_ids,
                document_texts=document_texts,
            ):
                if isinstance(chunk, dict):
                    yield {"data": json.dumps({"usage": chunk}, ensure_ascii=False)}
                else:
                    yield {"data": json.dumps({"content": chunk}, ensure_ascii=False)}
            yield {"data": json.dumps({"done": True})}
        except ValueError as e:
            yield {"data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())
