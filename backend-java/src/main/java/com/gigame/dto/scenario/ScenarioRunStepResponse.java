package com.gigame.dto.scenario;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.time.OffsetDateTime;
import java.util.UUID;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ScenarioRunStepResponse(
        UUID id,
        String nodeId,
        String nodeType,
        String status,
        Object inputData,
        Object outputData,
        String promptUsed,
        Integer tokensUsed,
        OffsetDateTime startedAt,
        OffsetDateTime completedAt
) {
}
