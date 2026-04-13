package com.gigame.repository;

import com.gigame.model.Embedding;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface EmbeddingRepository extends JpaRepository<Embedding, UUID> {

    @Query(value = "SELECT e.chunk_text FROM embeddings e " +
            "WHERE e.collection_type = :type AND e.collection_id = :collId " +
            "ORDER BY e.embedding <=> cast(:queryVec as vector) " +
            "LIMIT :topK",
            nativeQuery = true)
    List<String> searchSimilar(
            @Param("type") String type,
            @Param("collId") UUID collId,
            @Param("queryVec") String queryVec,
            @Param("topK") int topK
    );

    @Modifying
    @Query("DELETE FROM Embedding e WHERE e.collectionType = :type AND e.collectionId = :collId")
    void deleteByCollection(@Param("type") String type, @Param("collId") UUID collId);

    @Modifying
    @Query("DELETE FROM Embedding e WHERE e.collectionType = 'kb' AND e.collectionId = :kbId AND e.sourceDocumentId = :docId")
    void deleteKBDocumentChunks(@Param("kbId") UUID kbId, @Param("docId") UUID docId);
}
