package com.gigame.dto.scenario;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.Map;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ScenarioCreate(
        String name,
        String description,
        Map<String, Object> graphData
) {
}
