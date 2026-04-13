package com.gigame.service;

import com.gigame.repository.EmbeddingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Manages pgvector-based embedding storage and similarity search,
 * replacing the Python ChromaDB vector store.
 */
@Service
public class EmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingService.class);

    private static final String INSERT_SQL =
            "INSERT INTO embeddings (id, collection_type, collection_id, source_document_id, chunk_index, chunk_text, embedding) " +
            "VALUES (?::uuid, ?, ?::uuid, ?::uuid, ?, ?, ?::vector)";

    private final EmbeddingRepository embeddingRepository;
    private final JdbcTemplate jdbcTemplate;

    public EmbeddingService(EmbeddingRepository embeddingRepository, JdbcTemplate jdbcTemplate) {
        this.embeddingRepository = embeddingRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    // -------------------------------------------------------------------------
    // Store
    // -------------------------------------------------------------------------

    /**
     * Store document chunks with embeddings (collection_type = 'doc').
     *
     * @param documentId the document UUID (used as both collection_id and source_document_id)
     * @param chunks     text chunks
     * @param embeddings corresponding embedding vectors
     */
    @Transactional
    public void storeDocumentChunks(UUID documentId, List<String> chunks, List<float[]> embeddings) {
        batchInsert("doc", documentId, documentId, chunks, embeddings);
        log.info("Stored {} document chunks for document {}", chunks.size(), documentId);
    }

    /**
     * Store knowledge base chunks with embeddings (collection_type = 'kb').
     *
     * @param kbId             the knowledge base UUID (collection_id)
     * @param sourceDocumentId the source document UUID
     * @param chunks           text chunks
     * @param embeddings       corresponding embedding vectors
     */
    @Transactional
    public void storeKBChunks(UUID kbId, UUID sourceDocumentId, List<String> chunks, List<float[]> embeddings) {
        batchInsert("kb", kbId, sourceDocumentId, chunks, embeddings);
        log.info("Stored {} KB chunks for kb={} doc={}", chunks.size(), kbId, sourceDocumentId);
    }

    private void batchInsert(String collectionType, UUID collectionId, UUID sourceDocumentId,
                             List<String> chunks, List<float[]> embeddings) {
        if (chunks.size() != embeddings.size()) {
            throw new IllegalArgumentException(
                    "Chunks and embeddings size mismatch: " + chunks.size() + " vs " + embeddings.size());
        }

        jdbcTemplate.batchUpdate(INSERT_SQL,
                chunks.stream().map(chunk -> {
                    int idx = chunks.indexOf(chunk); // fine for batch — order matters more than perf here
                    return new Object[]{
                            UUID.randomUUID().toString(),
                            collectionType,
                            collectionId.toString(),
                            sourceDocumentId.toString(),
                            idx,
                            chunk,
                            toVectorString(embeddings.get(idx))
                    };
                }).toList(),
                chunks.size(),
                (ps, args) -> {
                    for (int i = 0; i < args.length; i++) {
                        ps.setObject(i + 1, args[i]);
                    }
                });
    }

    // -------------------------------------------------------------------------
    // Search
    // -------------------------------------------------------------------------

    /**
     * Find top-K most similar chunks using pgvector cosine distance.
     *
     * @param collectionType "doc" or "kb"
     * @param collectionId   the document or KB UUID
     * @param queryEmbedding the query vector
     * @param topK           number of results to return
     * @return list of chunk texts ordered by similarity
     */
    public List<String> searchSimilar(String collectionType, UUID collectionId,
                                      float[] queryEmbedding, int topK) {
        String vectorStr = toVectorString(queryEmbedding);
        return embeddingRepository.searchSimilar(collectionType, collectionId, vectorStr, topK);
    }

    // -------------------------------------------------------------------------
    // Delete
    // -------------------------------------------------------------------------

    /**
     * Delete all document-level embeddings for a given document.
     */
    @Transactional
    public void deleteDocumentChunks(UUID documentId) {
        embeddingRepository.deleteByCollection("doc", documentId);
        log.info("Deleted document chunks for document {}", documentId);
    }

    /**
     * Delete a specific document's chunks from a knowledge base collection.
     */
    @Transactional
    public void deleteKBDocumentChunks(UUID kbId, UUID documentId) {
        embeddingRepository.deleteKBDocumentChunks(kbId, documentId);
        log.info("Deleted KB chunks for kb={} doc={}", kbId, documentId);
    }

    /**
     * Delete all embeddings for an entire knowledge base.
     */
    @Transactional
    public void deleteKBCollection(UUID kbId) {
        embeddingRepository.deleteByCollection("kb", kbId);
        log.info("Deleted entire KB collection {}", kbId);
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    /**
     * Convert a float array to pgvector string format: "[0.1,0.2,...]".
     */
    public static String toVectorString(float[] embedding) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < embedding.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(embedding[i]);
        }
        sb.append(']');
        return sb.toString();
    }
}
