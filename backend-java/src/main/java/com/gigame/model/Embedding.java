package com.gigame.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "embeddings")
@Getter
@Setter
@NoArgsConstructor
public class Embedding {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "collection_type", nullable = false, length = 10)
    private String collectionType;

    @Column(name = "collection_id", nullable = false)
    private UUID collectionId;

    @Column(name = "source_document_id")
    private UUID sourceDocumentId;

    @Column(name = "chunk_index")
    private Integer chunkIndex;

    @Column(name = "chunk_text", columnDefinition = "TEXT")
    private String chunkText;

    /**
     * Stored as a raw string representation of the pgvector value (e.g. "[0.1,0.2,...]").
     * Vector conversion is handled via native SQL in the repository / service layer.
     */
    @Column(name = "embedding", columnDefinition = "vector(1024)")
    private String embedding;
}
