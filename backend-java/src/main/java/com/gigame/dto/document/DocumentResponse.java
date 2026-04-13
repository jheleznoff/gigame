package com.gigame.dto.document;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.time.OffsetDateTime;
import java.util.UUID;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record DocumentResponse(
        UUID id,
        String filename,
        String contentType,
        int sizeBytes,
        String extractedText,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
