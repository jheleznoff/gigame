package com.gigame.service;

import com.gigame.dto.scenario.*;
import com.gigame.model.Scenario;
import com.gigame.model.ScenarioRun;
import com.gigame.model.ScenarioRunStep;
import com.gigame.repository.ScenarioRepository;
import com.gigame.repository.ScenarioRunRepository;
import com.gigame.repository.ScenarioRunStepRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Simple CRUD operations for scenarios. No execution logic here.
 */
@Service
public class ScenarioService {

    private final ScenarioRepository scenarioRepository;
    private final ScenarioRunRepository scenarioRunRepository;
    private final ScenarioRunStepRepository scenarioRunStepRepository;

    public ScenarioService(ScenarioRepository scenarioRepository,
                           ScenarioRunRepository scenarioRunRepository,
                           ScenarioRunStepRepository scenarioRunStepRepository) {
        this.scenarioRepository = scenarioRepository;
        this.scenarioRunRepository = scenarioRunRepository;
        this.scenarioRunStepRepository = scenarioRunStepRepository;
    }

    // -------------------------------------------------------------------------
    // Scenario CRUD
    // -------------------------------------------------------------------------

    public List<ScenarioResponse> getScenarios() {
        return scenarioRepository.findAllByOrderByUpdatedAtDesc().stream()
                .map(this::toResponse)
                .toList();
    }

    public ScenarioDetailResponse getScenario(UUID id) {
        Scenario scenario = scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
        return toDetailResponse(scenario);
    }

    @Transactional
    public ScenarioResponse createScenario(String name, String description, Map<String, Object> graphData) {
        Scenario scenario = new Scenario();
        scenario.setName(name);
        scenario.setDescription(description);
        scenario.setGraphData(graphData != null ? graphData : Map.of());
        scenario = scenarioRepository.save(scenario);
        return toResponse(scenario);
    }

    @Transactional
    public ScenarioResponse updateScenario(UUID id, String name, String description, Map<String, Object> graphData) {
        Scenario scenario = scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
        if (name != null) {
            scenario.setName(name);
        }
        if (description != null) {
            scenario.setDescription(description);
        }
        if (graphData != null) {
            scenario.setGraphData(graphData);
        }
        scenario = scenarioRepository.save(scenario);
        return toResponse(scenario);
    }

    @Transactional
    public ScenarioResponse duplicateScenario(UUID id) {
        Scenario original = scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
        Scenario copy = new Scenario();
        copy.setName(original.getName() + " (\u043a\u043e\u043f\u0438\u044f)");
        copy.setDescription(original.getDescription());
        copy.setGraphData(original.getGraphData());
        copy = scenarioRepository.save(copy);
        return toResponse(copy);
    }

    @Transactional
    public void deleteScenario(UUID id) {
        Scenario scenario = scenarioRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Scenario not found: " + id));
        scenarioRepository.delete(scenario);
    }

    // -------------------------------------------------------------------------
    // Scenario Run queries
    // -------------------------------------------------------------------------

    public List<ScenarioRunResponse> getScenarioRuns(UUID scenarioId) {
        return scenarioRunRepository.findByScenarioIdOrderByStartedAtDesc(scenarioId).stream()
                .map(this::toRunResponse)
                .toList();
    }

    public ScenarioRunDetailResponse getScenarioRun(UUID runId) {
        ScenarioRun run = scenarioRunRepository.findById(runId)
                .orElseThrow(() -> new IllegalArgumentException("Scenario run not found: " + runId));
        List<ScenarioRunStepResponse> stepResponses = scenarioRunStepRepository
                .findByRunIdOrderByStartedAtAsc(run.getId()).stream()
                .map(this::toStepResponse)
                .toList();
        return new ScenarioRunDetailResponse(
                run.getId(),
                run.getScenarioId(),
                run.getStatus(),
                run.getInputDocumentIds(),
                run.getResult(),
                run.getStartedAt(),
                run.getCompletedAt(),
                stepResponses
        );
    }

    // -------------------------------------------------------------------------
    // Mapping helpers
    // -------------------------------------------------------------------------

    private ScenarioResponse toResponse(Scenario s) {
        return new ScenarioResponse(
                s.getId(),
                s.getName(),
                s.getDescription(),
                s.getCreatedAt(),
                s.getUpdatedAt()
        );
    }

    private ScenarioDetailResponse toDetailResponse(Scenario s) {
        return new ScenarioDetailResponse(
                s.getId(),
                s.getName(),
                s.getDescription(),
                s.getCreatedAt(),
                s.getUpdatedAt(),
                s.getGraphData()
        );
    }

    private ScenarioRunResponse toRunResponse(ScenarioRun r) {
        return new ScenarioRunResponse(
                r.getId(),
                r.getScenarioId(),
                r.getStatus(),
                r.getInputDocumentIds(),
                r.getResult(),
                r.getStartedAt(),
                r.getCompletedAt()
        );
    }

    private ScenarioRunStepResponse toStepResponse(ScenarioRunStep s) {
        return new ScenarioRunStepResponse(
                s.getId(),
                s.getNodeId(),
                s.getNodeType(),
                s.getStatus(),
                s.getInputData(),
                s.getOutputData(),
                s.getPromptUsed(),
                s.getTokensUsed(),
                s.getStartedAt(),
                s.getCompletedAt()
        );
    }
}
