package com.gigame.dto.chat;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ConversationWithMessages(
        UUID id,
        String title,
        String knowledgeBaseId,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        List<MessageResponse> messages
) {
}
