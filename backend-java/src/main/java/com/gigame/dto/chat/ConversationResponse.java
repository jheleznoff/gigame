package com.gigame.dto.chat;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.time.OffsetDateTime;
import java.util.UUID;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ConversationResponse(
        UUID id,
        String title,
        String knowledgeBaseId,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
