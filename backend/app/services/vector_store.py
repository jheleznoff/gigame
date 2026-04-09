"""ChromaDB vector store wrapper for document chunk storage and similarity search."""

import chromadb

from app.config import settings

_client: chromadb.ClientAPI | None = None


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
    return _client


def _collection_name(document_id: str) -> str:
    """ChromaDB collection name for a single document."""
    return f"doc_{document_id.replace('-', '_')}"


def store_chunks(
    document_id: str,
    chunks: list[str],
    embeddings: list[list[float]],
) -> None:
    """Store document chunks with their embeddings in ChromaDB."""
    client = _get_client()
    collection = client.get_or_create_collection(
        name=_collection_name(document_id),
        metadata={"hnsw:space": "cosine"},
    )
    ids = [f"{document_id}_chunk_{i}" for i in range(len(chunks))]
    collection.add(ids=ids, documents=chunks, embeddings=embeddings)


def search_similar(
    document_id: str,
    query_embedding: list[float],
    top_k: int = 5,
) -> list[str]:
    """Find top-k most similar chunks to the query."""
    client = _get_client()
    try:
        collection = client.get_collection(name=_collection_name(document_id))
    except ValueError:
        return []
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, collection.count()),
    )
    return results["documents"][0] if results["documents"] else []


def delete_document_chunks(document_id: str) -> None:
    """Remove all stored chunks for a document."""
    client = _get_client()
    try:
        client.delete_collection(name=_collection_name(document_id))
    except ValueError:
        pass


# --- Knowledge Base collections (one collection per KB) ---

def _kb_collection_name(kb_id: str) -> str:
    return f"kb_{kb_id.replace('-', '_')}"


def kb_store_chunks(
    kb_id: str,
    document_id: str,
    chunks: list[str],
    embeddings: list[list[float]],
) -> None:
    """Add document chunks to a knowledge base collection."""
    client = _get_client()
    collection = client.get_or_create_collection(
        name=_kb_collection_name(kb_id),
        metadata={"hnsw:space": "cosine"},
    )
    ids = [f"{document_id}_chunk_{i}" for i in range(len(chunks))]
    collection.add(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
        metadatas=[{"document_id": document_id}] * len(chunks),
    )


def kb_search_similar(
    kb_id: str,
    query_embedding: list[float],
    top_k: int = 5,
) -> list[str]:
    """Search across all documents in a knowledge base."""
    client = _get_client()
    try:
        collection = client.get_collection(name=_kb_collection_name(kb_id))
    except ValueError:
        return []
    if collection.count() == 0:
        return []
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, collection.count()),
    )
    return results["documents"][0] if results["documents"] else []


def kb_remove_document(kb_id: str, document_id: str) -> None:
    """Remove a specific document's chunks from a KB collection."""
    client = _get_client()
    try:
        collection = client.get_collection(name=_kb_collection_name(kb_id))
    except ValueError:
        return
    # Delete by metadata filter
    collection.delete(where={"document_id": document_id})


def kb_delete_collection(kb_id: str) -> None:
    """Delete entire KB collection."""
    client = _get_client()
    try:
        client.delete_collection(name=_kb_collection_name(kb_id))
    except ValueError:
        pass
