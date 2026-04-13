package com.gigame.repository;

import com.gigame.model.KBDocument;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface KBDocumentRepository extends JpaRepository<KBDocument, UUID> {

    List<KBDocument> findByKnowledgeBaseId(UUID knowledgeBaseId);

    @Query("SELECT k FROM KBDocument k JOIN FETCH k.document WHERE k.knowledgeBaseId = :kbId")
    List<KBDocument> findByKnowledgeBaseIdWithDocument(@Param("kbId") UUID kbId);

    Optional<KBDocument> findByKnowledgeBaseIdAndDocumentId(UUID knowledgeBaseId, UUID documentId);
}
