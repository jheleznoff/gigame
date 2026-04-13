package com.gigame.service;

import com.gigame.dto.kb.KBDetailResponse;
import com.gigame.dto.kb.KBDocumentResponse;
import com.gigame.dto.kb.KBResponse;
import com.gigame.model.Document;
import com.gigame.model.KBDocument;
import com.gigame.model.KnowledgeBase;
import com.gigame.repository.DocumentRepository;
import com.gigame.repository.KBDocumentRepository;
import com.gigame.repository.KnowledgeBaseRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.codec.multipart.FilePart;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Knowledge base service — port of Python kb_service.py.
 * Manages knowledge bases, their documents, and vector indexing.
 */
@Service
public class KBService {

    private static final Logger log = LoggerFactory.getLogger(KBService.class);

    private final KnowledgeBaseRepository knowledgeBaseRepository;
    private final KBDocumentRepository kbDocumentRepository;
    private final DocumentRepository documentRepository;
    private final DocumentService documentService;
    private final EmbeddingService embeddingService;
    private final TextSplitter textSplitter;
    private final GigaChatClient gigaChatClient;

    public KBService(KnowledgeBaseRepository knowledgeBaseRepository,
                     KBDocumentRepository kbDocumentRepository,
                     DocumentRepository documentRepository,
                     DocumentService documentService,
                     EmbeddingService embeddingService,
                     TextSplitter textSplitter,
                     GigaChatClient gigaChatClient) {
        this.knowledgeBaseRepository = knowledgeBaseRepository;
        this.kbDocumentRepository = kbDocumentRepository;
        this.documentRepository = documentRepository;
        this.documentService = documentService;
        this.embeddingService = embeddingService;
        this.textSplitter = textSplitter;
        this.gigaChatClient = gigaChatClient;
    }

    // -------------------------------------------------------------------------
    // Knowledge base CRUD
    // -------------------------------------------------------------------------

    /**
     * List all knowledge bases, optionally filtered by name.
     */
    public List<KBResponse> getKnowledgeBases(String search) {
        List<KnowledgeBase> kbs;
        if (search != null && !search.isBlank()) {
            kbs = knowledgeBaseRepository.findByNameContainingIgnoreCaseOrderByUpdatedAtDesc(search);
        } else {
            kbs = knowledgeBaseRepository.findAllByOrderByUpdatedAtDesc();
        }
        return kbs.stream().map(this::toKBResponse).toList();
    }

    /**
     * Get a single knowledge base with its documents. Throws if not found.
     */
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public KBDetailResponse getKnowledgeBase(UUID id) {
        KnowledgeBase kb = knowledgeBaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Knowledge base not found: " + id));
        // Use JOIN FETCH query to avoid N+1 and LazyInitializationException
        List<KBDocumentResponse> docs = kbDocumentRepository.findByKnowledgeBaseIdWithDocument(id).stream()
                .map(this::toKBDocumentResponse)
                .toList();
        return new KBDetailResponse(
                kb.getId(),
                kb.getName(),
                kb.getDescription(),
                kb.getCreatedAt(),
                kb.getUpdatedAt(),
                docs
        );
    }

    /**
     * Create a new knowledge base.
     */
    @Transactional
    public KBResponse createKnowledgeBase(String name, String description) {
        KnowledgeBase kb = new KnowledgeBase();
        kb.setName(name);
        kb.setDescription(description);
        kb = knowledgeBaseRepository.save(kb);
        return toKBResponse(kb);
    }

    /**
     * Update a knowledge base's name and/or description. Throws if not found.
     */
    @Transactional
    public KBResponse updateKnowledgeBase(UUID id, String name, String description) {
        KnowledgeBase kb = knowledgeBaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Knowledge base not found: " + id));
        if (name != null) {
            kb.setName(name);
        }
        if (description != null) {
            kb.setDescription(description);
        }
        kb = knowledgeBaseRepository.save(kb);
        return toKBResponse(kb);
    }

    /**
     * Delete a knowledge base and all its vector embeddings.
     */
    @Transactional
    public void deleteKnowledgeBase(UUID id) {
        KnowledgeBase kb = knowledgeBaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Knowledge base not found: " + id));
        embeddingService.deleteKBCollection(id);
        knowledgeBaseRepository.delete(kb);
    }

    // -------------------------------------------------------------------------
    // KB document management
    // -------------------------------------------------------------------------

    /**
     * Upload a document file and add it to a knowledge base.
     *
     * <p>The document is uploaded and text-extracted via DocumentService,
     * then a KBDocument record is created with status "processing".
     * Indexing (chunking + embedding) runs asynchronously.</p>
     *
     * @param kbId the knowledge base UUID
     * @param file the uploaded file
     * @return KBDocumentResponse with initial status
     */
    public KBDocumentResponse addDocumentToKB(UUID kbId, FilePart file) {
        KnowledgeBase kb = knowledgeBaseRepository.findById(kbId)
                .orElseThrow(() -> new IllegalArgumentException("Knowledge base not found: " + kbId));

        // Upload and extract text
        DocumentService.DocumentResponse docDto = documentService.uploadDocument(file);
        Document doc = documentRepository.findById(docDto.id())
                .orElseThrow(() -> new IllegalStateException("Document not found after upload: " + docDto.id()));

        // Create KB document record
        KBDocument kbDoc = new KBDocument();
        kbDoc.setKnowledgeBaseId(kbId);
        kbDoc.setDocument(doc);
        kbDoc.setStatus("processing");
        kbDoc = kbDocumentRepository.save(kbDoc);

        // Kick off async indexing
        indexDocumentAsync(kbId, doc.getId(), kbDoc.getId());

        return toKBDocumentResponse(kbDoc);
    }

    /**
     * Asynchronously chunk, embed, and store a document's text as KB vectors.
     */
    @Async
    public void indexDocumentAsync(UUID kbId, UUID documentId, UUID kbDocId) {
        try {
            Document doc = documentRepository.findById(documentId)
                    .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
            if (doc.getExtractedText() == null || doc.getExtractedText().isBlank()) {
                throw new IllegalStateException("Document has no extracted text");
            }

            List<String> chunks = textSplitter.split(doc.getExtractedText());
            if (chunks.isEmpty()) {
                throw new IllegalStateException("Document produced no chunks");
            }

            // Embed in batches of 50
            List<float[]> allEmbeddings = new ArrayList<>();
            for (int i = 0; i < chunks.size(); i += 50) {
                List<String> batch = chunks.subList(i, Math.min(i + 50, chunks.size()));
                allEmbeddings.addAll(gigaChatClient.getEmbeddings(batch));
            }

            embeddingService.storeKBChunks(kbId, documentId, chunks, allEmbeddings);

            // Update status
            KBDocument kbDoc = kbDocumentRepository.findById(kbDocId)
                    .orElseThrow(() -> new IllegalStateException("KBDocument not found: " + kbDocId));
            kbDoc.setChunkCount(chunks.size());
            kbDoc.setStatus("ready");
            kbDocumentRepository.save(kbDoc);

            log.info("Indexed document {} into KB {}: {} chunks", documentId, kbId, chunks.size());
        } catch (Exception e) {
            log.error("Failed to index document {} into KB {}", documentId, kbId, e);
            kbDocumentRepository.findById(kbDocId).ifPresent(kbDoc -> {
                kbDoc.setStatus("error");
                kbDoc.setErrorMessage(e.getMessage());
                kbDocumentRepository.save(kbDoc);
            });
        }
    }

    /**
     * Re-index a document in a knowledge base: delete old chunks, re-embed, update status.
     * Throws if the KB document is not found.
     */
    @Transactional
    public KBDocumentResponse reindexDocument(UUID kbId, UUID documentId) {
        KBDocument kbDoc = kbDocumentRepository.findByKnowledgeBaseIdAndDocumentId(kbId, documentId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "KB document not found: kbId=" + kbId + " docId=" + documentId));

        // Delete old chunks
        embeddingService.deleteKBDocumentChunks(kbId, documentId);

        kbDoc.setStatus("processing");
        kbDoc.setErrorMessage(null);
        kbDoc = kbDocumentRepository.save(kbDoc);

        try {
            Document doc = documentRepository.findById(documentId)
                    .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
            if (doc.getExtractedText() == null || doc.getExtractedText().isBlank()) {
                throw new IllegalStateException("Document has no extracted text");
            }

            List<String> chunks = textSplitter.split(doc.getExtractedText());
            if (chunks.isEmpty()) {
                throw new IllegalStateException("Document produced no chunks");
            }

            List<float[]> allEmbeddings = new ArrayList<>();
            for (int i = 0; i < chunks.size(); i += 50) {
                List<String> batch = chunks.subList(i, Math.min(i + 50, chunks.size()));
                allEmbeddings.addAll(gigaChatClient.getEmbeddings(batch));
            }

            embeddingService.storeKBChunks(kbId, documentId, chunks, allEmbeddings);
            kbDoc.setChunkCount(chunks.size());
            kbDoc.setStatus("ready");
            log.info("Re-indexed document {} in KB {}: {} chunks", documentId, kbId, chunks.size());
        } catch (Exception e) {
            log.error("Reindex failed for document {} in KB {}", documentId, kbId, e);
            kbDoc.setStatus("error");
            kbDoc.setErrorMessage(e.getMessage());
        }

        kbDoc = kbDocumentRepository.save(kbDoc);
        return toKBDocumentResponse(kbDoc);
    }

    /**
     * Remove a document from a knowledge base: delete vector chunks and the KBDocument record.
     * Throws if the KB document is not found.
     */
    @Transactional
    public void removeDocumentFromKB(UUID kbId, UUID documentId) {
        KBDocument kbDoc = kbDocumentRepository.findByKnowledgeBaseIdAndDocumentId(kbId, documentId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "KB document not found: kbId=" + kbId + " docId=" + documentId));
        embeddingService.deleteKBDocumentChunks(kbId, documentId);
        kbDocumentRepository.delete(kbDoc);
    }

    // -------------------------------------------------------------------------
    // DTO mapping
    // -------------------------------------------------------------------------

    private KBResponse toKBResponse(KnowledgeBase kb) {
        return new KBResponse(
                kb.getId(),
                kb.getName(),
                kb.getDescription(),
                kb.getCreatedAt(),
                kb.getUpdatedAt()
        );
    }

    private KBDocumentResponse toKBDocumentResponse(KBDocument kbDoc) {
        Document doc = kbDoc.getDocument();
        return new KBDocumentResponse(
                kbDoc.getId(),
                doc != null ? doc.getId() : kbDoc.getDocumentId(),
                kbDoc.getFilename(),
                doc != null ? doc.getContentType() : null,
                doc != null && doc.getSizeBytes() != null ? doc.getSizeBytes() : 0,
                kbDoc.getChunkCount() != null ? kbDoc.getChunkCount() : 0,
                kbDoc.getStatus(),
                kbDoc.getErrorMessage(),
                kbDoc.getCreatedAt()
        );
    }
}
