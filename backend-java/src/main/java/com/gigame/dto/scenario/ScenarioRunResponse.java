package com.gigame.dto.scenario;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ScenarioRunResponse(
        UUID id,
        UUID scenarioId,
        String status,
        List<String> inputDocumentIds,
        Object result,
        OffsetDateTime startedAt,
        OffsetDateTime completedAt
) {
}
