package com.gigame.dto.kb;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.time.OffsetDateTime;
import java.util.UUID;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record KBDocumentResponse(
        UUID id,
        UUID documentId,
        String filename,
        String contentType,
        int sizeBytes,
        int chunkCount,
        String status,
        String errorMessage,
        OffsetDateTime createdAt
) {
}
