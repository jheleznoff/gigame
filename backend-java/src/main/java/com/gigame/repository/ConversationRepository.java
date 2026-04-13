package com.gigame.repository;

import com.gigame.model.Conversation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ConversationRepository extends JpaRepository<Conversation, UUID> {

    List<Conversation> findAllByOrderByUpdatedAtDesc();

    List<Conversation> findByTitleContainingIgnoreCaseOrderByUpdatedAtDesc(String q);
}
