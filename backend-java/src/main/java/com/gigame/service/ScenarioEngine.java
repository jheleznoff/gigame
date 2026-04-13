package com.gigame.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gigame.model.ScenarioRun;
import com.gigame.model.ScenarioRunStep;
import com.gigame.repository.ScenarioRunRepository;
import com.gigame.repository.ScenarioRunStepRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.FluxSink;

import jakarta.annotation.PreDestroy;
import org.springframework.scheduling.annotation.Scheduled;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Core scenario graph execution engine.
 * <p>
 * Faithful port of Python scenario_engine.py. Traverses the node graph in
 * topological order, executes each node, and emits SSE events that the React
 * frontend consumes in real time.
 */
@Service
public class ScenarioEngine {

    private static final Logger log = LoggerFactory.getLogger(ScenarioEngine.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final int MAX_CONTEXT = 30_000;

    private final ScenarioRunRepository scenarioRunRepository;
    private final ScenarioRunStepRepository scenarioRunStepRepository;
    private final GigaChatClient gigaChatClient;
    private final EmbeddingService embeddingService;

    private final ExecutorService executor = Executors.newFixedThreadPool(2);

    // In-memory step-by-step debug mode state (per run_id)
    private final ConcurrentHashMap<String, CompletableFuture<Void>> stepEvents = new ConcurrentHashMap<>();
    private final Set<String> stepModeEnabled = ConcurrentHashMap.newKeySet();
    private final Set<String> stepModeDisabled = ConcurrentHashMap.newKeySet();
    private final ConcurrentHashMap<String, Long> runTimestamps = new ConcurrentHashMap<>();

    public ScenarioEngine(ScenarioRunRepository scenarioRunRepository,
                          ScenarioRunStepRepository scenarioRunStepRepository,
                          GigaChatClient gigaChatClient,
                          EmbeddingService embeddingService) {
        this.scenarioRunRepository = scenarioRunRepository;
        this.scenarioRunStepRepository = scenarioRunStepRepository;
        this.gigaChatClient = gigaChatClient;
        this.embeddingService = embeddingService;
    }

    @PreDestroy
    void shutdown() {
        executor.shutdown();
        try { executor.awaitTermination(5, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    /**
     * Evict stale step-mode state for runs older than 10 minutes.
     */
    @Scheduled(fixedRate = 300000)
    void evictStaleRuns() {
        long cutoff = System.currentTimeMillis() - 10 * 60 * 1000;
        runTimestamps.forEach((runId, ts) -> {
            if (ts < cutoff) {
                log.debug("Evicting stale run state: {}", runId);
                cleanupRun(runId);
                runTimestamps.remove(runId);
            }
        });
    }

    // -------------------------------------------------------------------------
    // Step-by-step mode control
    // -------------------------------------------------------------------------

    public void enableStepMode(String runId) {
        stepModeEnabled.add(runId);
    }

    public void disableStepMode(String runId) {
        stepModeDisabled.add(runId);
        CompletableFuture<Void> future = stepEvents.get(runId);
        if (future != null) {
            future.complete(null);
        }
    }

    public void continueStep(String runId) {
        CompletableFuture<Void> future = stepEvents.get(runId);
        if (future != null) {
            future.complete(null);
        }
    }

    public void cleanupRun(String runId) {
        stepEvents.remove(runId);
        stepModeEnabled.remove(runId);
        stepModeDisabled.remove(runId);
        runTimestamps.remove(runId);
    }

    // -------------------------------------------------------------------------
    // Main execution
    // -------------------------------------------------------------------------

    /**
     * Execute a scenario graph and return a Flux of SSE events.
     * The execution runs on a background thread so it doesn't block Netty.
     */
    @SuppressWarnings("unchecked")
    public Flux<ServerSentEvent<Map<String, Object>>> executeScenario(
            ScenarioRun run,
            Map<String, Object> graphData,
            String documentsText) {

        return Flux.create(sink -> executor.submit(() -> {
            try {
                doExecute(sink, run, graphData, documentsText);
            } catch (Exception e) {
                log.error("Scenario execution failed unexpectedly", e);
                emitEvent(sink, "status", Map.of(
                        "run_id", run.getId().toString(),
                        "status", "failed"
                ));
                sink.complete();
            }
        }));
    }

    @SuppressWarnings("unchecked")
    private void doExecute(FluxSink<ServerSentEvent<Map<String, Object>>> sink,
                           ScenarioRun run,
                           Map<String, Object> graphData,
                           String documentsText) {

        String runId = run.getId().toString();
        runTimestamps.put(runId, System.currentTimeMillis());

        // Validate graph before execution
        validateGraph(graphData);

        // Per-execution embedding cache to avoid duplicate API calls
        Map<String, float[]> embeddingCache = new HashMap<>();

        List<Map<String, Object>> nodes = (List<Map<String, Object>>)
                graphData.getOrDefault("nodes", List.of());
        List<Map<String, Object>> edges = (List<Map<String, Object>>)
                graphData.getOrDefault("edges", List.of());
        Map<String, Map<String, Object>> nodeMap = new HashMap<>();
        for (Map<String, Object> node : nodes) {
            nodeMap.put((String) node.get("id"), node);
        }

        List<String> sortedIds = topologicalSort(nodes, edges);

        // Update run status to running
        run.setStatus("running");
        scenarioRunRepository.save(run);
        emitEvent(sink, "status", Map.of("run_id", runId, "status", "running"));

        // Track outputs per node
        Map<String, String> nodeOutputs = new HashMap<>();
        // Track skipped nodes (from condition branches not taken)
        Set<String> skippedNodes = new HashSet<>();
        // Per-node documents_text override (set by Switch when filtering by class)
        Map<String, String> branchDocsOverride = new HashMap<>();

        // Build graph structures
        Map<String, List<String>> successors = new HashMap<>();
        Map<String, List<String>> predecessors = new HashMap<>();
        // Map: "source|target" -> edge data
        Map<String, Map<String, Object>> edgeMap = new HashMap<>();
        for (Map<String, Object> edge : edges) {
            String src = (String) edge.get("source");
            String tgt = (String) edge.get("target");
            successors.computeIfAbsent(src, k -> new ArrayList<>()).add(tgt);
            predecessors.computeIfAbsent(tgt, k -> new ArrayList<>()).add(src);
            Map<String, Object> edgeData = (Map<String, Object>) edge.getOrDefault("data", Map.of());
            if (edgeData == null) edgeData = Map.of();
            edgeMap.put(src + "|" + tgt, edgeData);
        }

        int totalNodes = sortedIds.size();

        for (int sortIndex = 0; sortIndex < sortedIds.size(); sortIndex++) {
            String nodeId = sortedIds.get(sortIndex);
            Map<String, Object> node = nodeMap.get(nodeId);
            if (node == null) continue;

            String nodeType = (String) node.getOrDefault("type", "unknown");
            Map<String, Object> nodeData = (Map<String, Object>) node.getOrDefault("data", Map.of());
            if (nodeData == null) nodeData = Map.of();
            String nodeLabel = (String) nodeData.getOrDefault("label", nodeType);
            if (nodeLabel == null || nodeLabel.isEmpty()) nodeLabel = nodeType;
            int nodeIndex = sortIndex + 1;

            // Check if this node was skipped by a condition
            if (skippedNodes.contains(nodeId)) {
                emitEvent(sink, "node_status", Map.of(
                        "node_id", nodeId,
                        "node_label", nodeLabel,
                        "node_type", nodeType,
                        "status", "skipped",
                        "step", nodeIndex,
                        "total", totalNodes
                ));
                continue;
            }

            // Handle input node
            if ("input".equals(nodeType)) {
                nodeOutputs.put(nodeId, documentsText != null ? documentsText : "");
                emitEvent(sink, "node_status", Map.of(
                        "node_id", nodeId,
                        "node_label", nodeLabel,
                        "node_type", nodeType,
                        "status", "completed",
                        "step", nodeIndex,
                        "total", totalNodes
                ));
                continue;
            }

            // Handle output node
            if ("output".equals(nodeType)) {
                List<String> prevIds = predecessors.getOrDefault(nodeId, List.of());
                List<String> outputs = new ArrayList<>();
                for (String pid : prevIds) {
                    if (!skippedNodes.contains(pid) && nodeOutputs.containsKey(pid)) {
                        outputs.add(nodeOutputs.get(pid));
                    }
                }
                String output = String.join("\n\n", outputs);
                nodeOutputs.put(nodeId, output);
                emitEvent(sink, "node_status", Map.of(
                        "node_id", nodeId,
                        "node_label", nodeLabel,
                        "node_type", nodeType,
                        "status", "completed",
                        "step", nodeIndex,
                        "total", totalNodes
                ));
                continue;
            }

            // Create step record
            ScenarioRunStep step = new ScenarioRunStep();
            step.setRunId(run.getId());
            step.setNodeId(nodeId);
            step.setNodeType(nodeType);
            step.setStatus("running");
            step.setStartedAt(OffsetDateTime.now());
            step = scenarioRunStepRepository.save(step);

            emitEvent(sink, "node_status", Map.of(
                    "node_id", nodeId,
                    "node_label", nodeLabel,
                    "node_type", nodeType,
                    "status", "running",
                    "step", nodeIndex,
                    "total", totalNodes
            ));

            // Gather input from non-skipped predecessors
            List<String> prevIds = predecessors.getOrDefault(nodeId, List.of());
            List<String> activeOutputs = new ArrayList<>();
            List<String> skippedPredecessorLabels = new ArrayList<>();
            for (String pid : prevIds) {
                Map<String, Object> pnode = nodeMap.getOrDefault(pid, Map.of());
                Map<String, Object> pdata = (Map<String, Object>) pnode.getOrDefault("data", Map.of());
                if (pdata == null) pdata = Map.of();
                String plabel = (String) pdata.getOrDefault("label", pid);
                if (plabel == null || plabel.isEmpty()) plabel = pid;

                if (skippedNodes.contains(pid)) {
                    skippedPredecessorLabels.add(plabel);
                } else if (nodeOutputs.containsKey(pid)) {
                    activeOutputs.add("=== \u0420\u0415\u0417\u0423\u041b\u042c\u0422\u0410\u0422 \u041e\u0422 \u00ab" + plabel + "\u00bb ===\n" + nodeOutputs.get(pid));
                }
            }

            List<String> parts = new ArrayList<>(activeOutputs);
            if (!skippedPredecessorLabels.isEmpty()) {
                StringBuilder sb = new StringBuilder();
                sb.append("=== \u041f\u0420\u041e\u041f\u0423\u0429\u0415\u041d\u041d\u042b\u0415 \u0412\u0415\u0422\u041a\u0418 (\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442 \u0441\u043e\u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044e\u0449\u0435\u0433\u043e \u0442\u0438\u043f\u0430 \u041d\u0415 \u0417\u0410\u0413\u0420\u0423\u0416\u0415\u041d) ===\n");
                for (String lbl : skippedPredecessorLabels) {
                    sb.append("- ").append(lbl).append("\n");
                }
                parts.add(sb.toString());
            }
            String previousOutput = String.join("\n\n", parts);

            // If a previous Switch filtered docs for this node, use the filtered set
            String effectiveDocuments = branchDocsOverride.getOrDefault(nodeId,
                    documentsText != null ? documentsText : "");

            Map<String, Object> inputData = new LinkedHashMap<>();
            inputData.put("documents_text", effectiveDocuments);
            inputData.put("previous_output", previousOutput);

            String prompt = null;
            String output;

            try {
                if ("loop".equals(nodeType)) {
                    output = executeLoopNode(sink, node, nodeData, nodeId, documentsText);

                } else if ("switch".equals(nodeType)) {
                    output = executeSwitchNode(sink, node, nodeData, nodeId, nodeLabel,
                            previousOutput, successors, edgeMap, skippedNodes,
                            branchDocsOverride);

                } else if ("if_node".equals(nodeType)) {
                    output = executeIfNode(sink, node, nodeData, nodeId, nodeLabel,
                            previousOutput, successors, edgeMap, skippedNodes);

                } else {
                    // Generic processing node (optionally with RAG)
                    List<String> kbChunks = List.of();
                    String kbId = strVal(nodeData.get("knowledge_base_id"));
                    if (!kbId.isEmpty()) {
                        try {
                            kbChunks = ragSearchForNode(node, inputData, 5, embeddingCache);
                        } catch (Exception e) {
                            log.error("RAG failed for node {}", nodeId, e);
                            kbChunks = List.of();
                        }
                        emitEvent(sink, "rag_search", Map.of(
                                "node_id", nodeId,
                                "node_label", nodeLabel,
                                "kb_id", kbId,
                                "chunks_found", kbChunks.size()
                        ));
                    }
                    prompt = buildPrompt(node, inputData, kbChunks, !kbId.isEmpty());
                    output = gigaChatClient.chatCompletion(List.of(
                            Map.of("role", "user", "content", prompt)
                    ));
                }

                step.setStatus("completed");
                step.setInputData(inputData);
                step.setOutputData(Map.of("result", output));
                if ("loop".equals(nodeType)) {
                    step.setPromptUsed("(loop \u2014 see iterations)");
                } else if ("switch".equals(nodeType) || "if_node".equals(nodeType)) {
                    step.setPromptUsed(null);
                } else {
                    step.setPromptUsed(prompt);
                }
                step.setCompletedAt(OffsetDateTime.now());
                nodeOutputs.put(nodeId, output);
                scenarioRunStepRepository.save(step);

                emitEvent(sink, "node_status", Map.of(
                        "node_id", nodeId,
                        "node_label", nodeLabel,
                        "node_type", nodeType,
                        "status", "completed",
                        "step", nodeIndex,
                        "total", totalNodes
                ));

                // Emit full step data for live debugging
                Map<String, Object> stepCompleteData = new LinkedHashMap<>();
                stepCompleteData.put("step_id", step.getId().toString());
                stepCompleteData.put("node_id", nodeId);
                stepCompleteData.put("node_label", nodeLabel);
                stepCompleteData.put("node_type", nodeType);
                stepCompleteData.put("input_data", inputData);
                stepCompleteData.put("output_data", Map.of("result", output));
                stepCompleteData.put("prompt_used", step.getPromptUsed());
                stepCompleteData.put("step_index", nodeIndex);
                stepCompleteData.put("total_steps", totalNodes);
                emitEvent(sink, "step_complete", stepCompleteData);

                // Pause if step mode is enabled
                if (stepModeEnabled.contains(runId) && !stepModeDisabled.contains(runId)) {
                    CompletableFuture<Void> pauseFuture = new CompletableFuture<>();
                    stepEvents.put(runId, pauseFuture);

                    Map<String, Object> pauseData = new LinkedHashMap<>();
                    pauseData.put("node_id", nodeId);
                    pauseData.put("node_label", nodeLabel);
                    pauseData.put("step_index", nodeIndex);
                    pauseData.put("total_steps", totalNodes);
                    emitEvent(sink, "step_paused", pauseData);

                    // Block until /continue is called
                    try {
                        pauseFuture.get();
                    } catch (InterruptedException | ExecutionException e) {
                        log.warn("Step pause interrupted for run {}", runId);
                        Thread.currentThread().interrupt();
                    }
                }

            } catch (Exception e) {
                log.error("Node {} failed", nodeId, e);
                step.setStatus("failed");
                step.setOutputData(Map.of("error", e.getMessage() != null ? e.getMessage() : "Unknown error"));
                step.setCompletedAt(OffsetDateTime.now());
                nodeOutputs.put(nodeId, "");
                scenarioRunStepRepository.save(step);

                Map<String, Object> errorData = new LinkedHashMap<>();
                errorData.put("node_id", nodeId);
                errorData.put("node_label", nodeLabel);
                errorData.put("node_type", nodeType);
                errorData.put("status", "failed");
                errorData.put("step", nodeIndex);
                errorData.put("total", totalNodes);
                errorData.put("error", e.getMessage() != null ? e.getMessage() : "Unknown error");
                emitEvent(sink, "node_status", errorData);

                run.setStatus("failed");
                scenarioRunRepository.save(run);
                emitEvent(sink, "status", Map.of("run_id", runId, "status", "failed"));
                cleanupRun(runId);
                sink.complete();
                return;
            }
        }

        // Find output node result
        String finalResult = "";
        for (Map<String, Object> n : nodes) {
            if ("output".equals(n.get("type"))) {
                String r = nodeOutputs.getOrDefault((String) n.get("id"), "");
                if (!r.isEmpty()) {
                    finalResult = r;
                    break;
                }
            }
        }
        if (finalResult.isEmpty() && !sortedIds.isEmpty()) {
            finalResult = nodeOutputs.getOrDefault(sortedIds.get(sortedIds.size() - 1), "");
        }

        run.setStatus("completed");
        run.setResult(finalResult);
        run.setCompletedAt(OffsetDateTime.now());
        scenarioRunRepository.save(run);

        emitEvent(sink, "status", Map.of(
                "run_id", runId,
                "status", "completed",
                "result", finalResult
        ));
        cleanupRun(runId);
        sink.complete();
    }

    // -------------------------------------------------------------------------
    // Loop node execution
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private String executeLoopNode(FluxSink<ServerSentEvent<Map<String, Object>>> sink,
                                   Map<String, Object> node,
                                   Map<String, Object> nodeData,
                                   String nodeId,
                                   String documentsText) {
        String[] docParts = (documentsText != null ? documentsText : "").split("---");
        List<String> docs = new ArrayList<>();
        for (String d : docParts) {
            String trimmed = d.trim();
            if (!trimmed.isEmpty()) docs.add(trimmed);
        }
        if (docs.isEmpty()) docs.add(documentsText != null ? documentsText : "");

        boolean classifyStrict = Boolean.parseBoolean(String.valueOf(nodeData.getOrDefault("classify_strict", "false")));
        String classesHint = strVal(nodeData.getOrDefault("classes", "\u041f\u0417, \u041a\u041f, \u041f\u0420\u0418\u041a\u0410\u0417"));

        List<String> loopResults = new ArrayList<>();

        for (int i = 0; i < docs.size(); i++) {
            String docPart = docs.get(i);

            if (classifyStrict) {
                // Strict classification: one-word class name
                // If user provided a prompt, use it as context/instructions
                String userPrompt = strVal(nodeData.getOrDefault("prompt", ""));
                StringBuilder sb = new StringBuilder();
                sb.append("Определи тип документа. Верни СТРОГО ОДНО слово — название класса из списка: ")
                  .append(classesHint).append(".\n");
                if (!userPrompt.isBlank()) {
                    sb.append("\nПодсказка для классификации:\n").append(userPrompt).append("\n");
                }
                sb.append("\nНе пиши пояснений, не повторяй задание, не добавляй знаков препинания.\n\n")
                  .append("Документ:\n").append(docPart);
                String strictPrompt = sb.toString();

                String clsRaw = gigaChatClient.chatCompletion(List.of(
                        Map.of("role", "user", "content", strictPrompt)
                ));
                // Extract first non-empty token as class
                String cls = "UNKNOWN";
                if (clsRaw != null && !clsRaw.trim().isEmpty()) {
                    String firstToken = clsRaw.trim().split("\\s+")[0];
                    cls = firstToken.replaceAll("[\".,;:()\\[\\]]", "");
                }
                loopResults.add("<<<DOC_" + (i + 1) + "|CLASS:" + cls + ">>>\n" +
                        docPart + "\n<<<END_DOC_" + (i + 1) + ">>>");

                emitEvent(sink, "loop_progress", Map.of(
                        "node_id", nodeId,
                        "iteration", i + 1,
                        "total", docs.size(),
                        "detail", "classified as " + cls
                ));
            } else {
                // Analyze mode: full prompt, free-form result
                Map<String, Object> loopInput = Map.of(
                        "documents_text", docPart,
                        "previous_output", ""
                );
                String prompt = buildPrompt(node, loopInput, List.of(), false);
                String result = gigaChatClient.chatCompletion(List.of(
                        Map.of("role", "user", "content", prompt)
                ));
                loopResults.add("\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442 " + (i + 1) + ":\n" + result);

                emitEvent(sink, "loop_progress", Map.of(
                        "node_id", nodeId,
                        "iteration", i + 1,
                        "total", docs.size()
                ));
            }

            // Sleep between iterations (except last)
            if (i < docs.size() - 1) {
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        return String.join("\n\n", loopResults);
    }

    // -------------------------------------------------------------------------
    // Switch node execution
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private String executeSwitchNode(FluxSink<ServerSentEvent<Map<String, Object>>> sink,
                                    Map<String, Object> node,
                                    Map<String, Object> nodeData,
                                    String nodeId,
                                    String nodeLabel,
                                    String previousOutput,
                                    Map<String, List<String>> successors,
                                    Map<String, Map<String, Object>> edgeMap,
                                    Set<String> skippedNodes,
                                    Map<String, String> branchDocsOverride) {

        String mode = strVal(nodeData.getOrDefault("mode", "all"));
        Object rulesRaw = nodeData.getOrDefault("rules", "[]");
        List<Map<String, Object>> rules = parseRules(rulesRaw);

        // Detect structured loop output (classify_strict mode)
        List<ClassifiedDoc> classified = parseClassifiedDocs(previousOutput);
        boolean useDocFiltering = !classified.isEmpty();

        // Evaluate rules
        List<String> matchedLabels = new ArrayList<>();

        if (useDocFiltering) {
            Set<String> docClasses = new HashSet<>();
            for (ClassifiedDoc cd : classified) {
                docClasses.add(cd.className.toLowerCase());
            }
            for (Map<String, Object> rule : rules) {
                String value = strVal(rule.get("value")).toLowerCase();
                String label = strVal(rule.getOrDefault("label", value));
                boolean matched = docClasses.stream()
                        .anyMatch(cls -> cls.contains(value) || value.contains(cls));
                if (matched) {
                    matchedLabels.add(label);
                    if ("first".equals(mode)) break;
                }
            }
        } else {
            String textToMatch = previousOutput.toLowerCase();
            for (Map<String, Object> rule : rules) {
                String value = strVal(rule.get("value")).toLowerCase();
                String operator = strVal(rule.getOrDefault("operator", "contains"));
                String label = strVal(rule.getOrDefault("label", value));

                boolean matched = false;
                if ("equals".equals(operator) && textToMatch.trim().equals(value)) {
                    matched = true;
                } else if ("contains".equals(operator) && textToMatch.contains(value)) {
                    matched = true;
                } else if ("startswith".equals(operator) && textToMatch.trim().startsWith(value)) {
                    matched = true;
                }

                if (matched) {
                    matchedLabels.add(label);
                    if ("first".equals(mode)) break;
                }
            }
        }

        // Route edges
        List<String> outgoing = successors.getOrDefault(nodeId, List.of());
        Set<String> chosenTargets = new HashSet<>();
        Set<String> unchosenTargets = new HashSet<>();
        Map<String, String> targetLabelMap = new HashMap<>();

        Set<String> matchedLower = new HashSet<>();
        for (String m : matchedLabels) matchedLower.add(m.toLowerCase());

        for (String targetId : outgoing) {
            Map<String, Object> edgeData = edgeMap.getOrDefault(nodeId + "|" + targetId, Map.of());
            String edgeLabel = strVal(edgeData.get("label"));

            if (matchedLower.contains(edgeLabel.toLowerCase())) {
                chosenTargets.add(targetId);
                targetLabelMap.put(targetId, edgeLabel);
            } else if (Set.of("else", "\u043f\u0440\u043e\u0447\u0435\u0435", "\u0434\u0440\u0443\u0433\u043e\u0435", "\u0438\u043d\u0430\u0447\u0435", "*", "default")
                    .contains(edgeLabel.toLowerCase())) {
                // Handle below as fallback
            } else if (!edgeLabel.isEmpty()) {
                unchosenTargets.add(targetId);
            }
        }

        // Fallback: if nothing matched, pick "else"/"default" edges
        if (chosenTargets.isEmpty()) {
            for (String targetId : outgoing) {
                Map<String, Object> edgeData = edgeMap.getOrDefault(nodeId + "|" + targetId, Map.of());
                String edgeLabel = strVal(edgeData.get("label")).toLowerCase();
                if (Set.of("else", "\u043f\u0440\u043e\u0447\u0435\u0435", "\u0434\u0440\u0443\u0433\u043e\u0435", "\u0438\u043d\u0430\u0447\u0435", "*", "default").contains(edgeLabel)
                        || edgeLabel.isEmpty()) {
                    chosenTargets.add(targetId);
                    targetLabelMap.put(targetId, edgeLabel.isEmpty() ? "default" : edgeLabel);
                }
            }
        }

        // Skip only nodes reachable ONLY from unchosen branches
        Set<String> toRemove = new HashSet<>(unchosenTargets);
        toRemove.removeAll(chosenTargets);
        skippedNodes.addAll(getSkipSet(toRemove, chosenTargets, successors));

        // If structured input -- populate branchDocsOverride per chosen target
        if (useDocFiltering) {
            for (String targetId : chosenTargets) {
                String edgeLabel = targetLabelMap.getOrDefault(targetId, "");
                Set<String> allowedClasses = new HashSet<>();
                for (Map<String, Object> rule : rules) {
                    String rLabel = strVal(rule.get("label"));
                    if (rLabel.equalsIgnoreCase(edgeLabel)) {
                        allowedClasses.add(strVal(rule.get("value")));
                    }
                }
                if (allowedClasses.isEmpty()) {
                    allowedClasses.add(edgeLabel);
                }
                String filtered = buildFilteredDocuments(classified, allowedClasses);
                if (!filtered.isEmpty()) {
                    branchDocsOverride.put(targetId, filtered);
                }
            }
        }

        String matchedStr = matchedLabels.isEmpty() ? "default" : String.join(", ", matchedLabels);
        String output = "Switch \u2192 " + matchedStr;
        if (useDocFiltering) {
            output += "\n[\u0444\u0438\u043b\u044c\u0442\u0440\u0430\u0446\u0438\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u043e\u0432: " + classified.size() +
                    " \u043a\u043b\u0430\u0441\u0441\u0438\u0444\u0438\u0446\u0438\u0440\u043e\u0432\u0430\u043d\u043e \u2192 \u0432\u0435\u0442\u043a\u0438 \u043f\u043e\u043b\u0443\u0447\u0430\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0441\u0432\u043e\u0438]";
        }

        emitEvent(sink, "switch_result", Map.of(
                "node_id", nodeId,
                "matched_rule", matchedStr,
                "node_label", nodeLabel
        ));

        return output;
    }

    // -------------------------------------------------------------------------
    // If node execution
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private String executeIfNode(FluxSink<ServerSentEvent<Map<String, Object>>> sink,
                                 Map<String, Object> node,
                                 Map<String, Object> nodeData,
                                 String nodeId,
                                 String nodeLabel,
                                 String previousOutput,
                                 Map<String, List<String>> successors,
                                 Map<String, Map<String, Object>> edgeMap,
                                 Set<String> skippedNodes) {

        String field = strVal(nodeData.get("field"));
        String operator = strVal(nodeData.getOrDefault("operator", "contains"));
        String compareValue = strVal(nodeData.get("value"));

        String textToCheck = previousOutput;
        // If field specified, try to extract it from structured output
        if (!field.isEmpty()) {
            for (String line : previousOutput.split("\n")) {
                if (line.toLowerCase().contains(field.toLowerCase())) {
                    textToCheck = line;
                    break;
                }
            }
        }

        String textLower = textToCheck.toLowerCase();
        String compareLower = compareValue.toLowerCase();

        // Evaluate condition
        boolean conditionMet;
        switch (operator) {
            case "contains":
                conditionMet = textLower.contains(compareLower);
                break;
            case "not_contains":
                conditionMet = !textLower.contains(compareLower);
                break;
            case "equals":
                conditionMet = textLower.trim().equals(compareLower);
                break;
            case "greater_than":
                conditionMet = compareNumeric(textToCheck, compareValue, true);
                break;
            case "less_than":
                conditionMet = compareNumeric(textToCheck, compareValue, false);
                break;
            default:
                conditionMet = textLower.contains(compareLower);
                break;
        }

        // Route: edges labeled "true"/"da" go one way, "false"/"net" go other
        List<String> outgoing = successors.getOrDefault(nodeId, List.of());
        Set<String> ifChosen = new HashSet<>();
        Set<String> ifUnchosen = new HashSet<>();

        Set<String> trueLabels = Set.of("true", "\u0434\u0430", "\u0438\u0441\u0442\u0438\u043d\u0430", "yes");
        Set<String> falseLabels = Set.of("false", "\u043d\u0435\u0442", "\u043b\u043e\u0436\u044c", "no");

        for (String targetId : outgoing) {
            Map<String, Object> edgeData = edgeMap.getOrDefault(nodeId + "|" + targetId, Map.of());
            String edgeLabel = strVal(edgeData.get("label")).toLowerCase();

            boolean isTrueBranch = trueLabels.contains(edgeLabel);
            boolean isFalseBranch = falseLabels.contains(edgeLabel);

            if (isTrueBranch) {
                (conditionMet ? ifChosen : ifUnchosen).add(targetId);
            } else if (isFalseBranch) {
                (conditionMet ? ifUnchosen : ifChosen).add(targetId);
            } else {
                // Unlabeled edge -- always taken
                ifChosen.add(targetId);
            }
        }

        skippedNodes.addAll(getSkipSet(ifUnchosen, ifChosen, successors));

        String branchName = conditionMet ? "true" : "false";
        String output = "If (" + field + " " + operator + " " + compareValue + ") \u2192 " + branchName;

        emitEvent(sink, "if_result", Map.of(
                "node_id", nodeId,
                "condition_met", conditionMet,
                "branch", branchName,
                "node_label", nodeLabel
        ));

        return output;
    }

    // -------------------------------------------------------------------------
    // Graph validation
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private void validateGraph(Map<String, Object> graphData) {
        Object nodesRaw = graphData.get("nodes");
        Object edgesRaw = graphData.get("edges");

        if (!(nodesRaw instanceof List) || ((List<?>) nodesRaw).isEmpty()) {
            throw new IllegalArgumentException("Graph validation failed: nodes array is missing or empty");
        }
        if (!(edgesRaw instanceof List) || ((List<?>) edgesRaw).isEmpty()) {
            throw new IllegalArgumentException("Graph validation failed: edges array is missing or empty");
        }

        List<Map<String, Object>> nodes = (List<Map<String, Object>>) nodesRaw;
        List<Map<String, Object>> edges = (List<Map<String, Object>>) edgesRaw;

        // Collect valid node IDs
        Set<String> nodeIds = new HashSet<>();
        for (Map<String, Object> node : nodes) {
            String id = (String) node.get("id");
            if (id == null || id.isEmpty()) {
                throw new IllegalArgumentException("Graph validation failed: node with missing id");
            }
            nodeIds.add(id);
        }

        // Validate edge references
        for (Map<String, Object> edge : edges) {
            String source = (String) edge.get("source");
            String target = (String) edge.get("target");
            if (!nodeIds.contains(source)) {
                throw new IllegalArgumentException("Graph validation failed: edge source '" + source + "' references non-existent node");
            }
            if (!nodeIds.contains(target)) {
                throw new IllegalArgumentException("Graph validation failed: edge target '" + target + "' references non-existent node");
            }
        }

        // Verify topological sort succeeds (no cycles)
        List<String> sorted = topologicalSort(nodes, edges);
        if (sorted.size() != nodeIds.size()) {
            throw new IllegalArgumentException("Graph validation failed: cycle detected (" + sorted.size() + " of " + nodeIds.size() + " nodes sorted)");
        }
    }

    // -------------------------------------------------------------------------
    // Topological sort (Kahn's algorithm)
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private List<String> topologicalSort(List<Map<String, Object>> nodes,
                                         List<Map<String, Object>> edges) {
        Map<String, List<String>> graph = new HashMap<>();
        Map<String, Integer> inDegree = new LinkedHashMap<>();

        for (Map<String, Object> n : nodes) {
            String id = (String) n.get("id");
            inDegree.put(id, 0);
        }

        for (Map<String, Object> edge : edges) {
            String src = (String) edge.get("source");
            String tgt = (String) edge.get("target");
            graph.computeIfAbsent(src, k -> new ArrayList<>()).add(tgt);
            inDegree.merge(tgt, 1, Integer::sum);
        }

        Deque<String> queue = new ArrayDeque<>();
        for (Map.Entry<String, Integer> entry : inDegree.entrySet()) {
            if (entry.getValue() == 0) {
                queue.add(entry.getKey());
            }
        }

        List<String> result = new ArrayList<>();
        while (!queue.isEmpty()) {
            String nid = queue.poll();
            result.add(nid);
            for (String neighbor : graph.getOrDefault(nid, List.of())) {
                int newDeg = inDegree.merge(neighbor, -1, Integer::sum);
                if (newDeg == 0) {
                    queue.add(neighbor);
                }
            }
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Prompt building
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private String buildPrompt(Map<String, Object> node,
                               Map<String, Object> inputData,
                               List<String> kbChunks,
                               boolean ragConfigured) {
        Map<String, Object> config = (Map<String, Object>) node.getOrDefault("data", Map.of());
        if (config == null) config = Map.of();

        String promptTemplate = strVal(config.get("prompt"));
        String documentsText = strVal(inputData.get("documents_text"));
        String previousOutput = strVal(inputData.get("previous_output"));

        List<String> contextParts = new ArrayList<>();

        if (!documentsText.isEmpty()) {
            String docText = documentsText;
            if (docText.length() > MAX_CONTEXT) {
                docText = docText.substring(0, MAX_CONTEXT) + "\n\n[... \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b \u043e\u0431\u0440\u0435\u0437\u0430\u043d\u044b ...]";
            }
            contextParts.add("\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b:\n" + docText);
        }

        if (!previousOutput.isEmpty()) {
            String prev = previousOutput;
            if (prev.length() > MAX_CONTEXT) {
                prev = prev.substring(0, MAX_CONTEXT) + "\n\n[... \u043e\u0431\u0440\u0435\u0437\u0430\u043d\u043e ...]";
            }
            contextParts.add("\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0435\u0433\u043e \u0448\u0430\u0433\u0430:\n" + prev);
        }

        if (kbChunks != null && !kbChunks.isEmpty()) {
            String joined = String.join("\n\n---\n\n", kbChunks);
            contextParts.add(
                    "\u0420\u0435\u043b\u0435\u0432\u0430\u043d\u0442\u043d\u044b\u0435 \u0444\u0440\u0430\u0433\u043c\u0435\u043d\u0442\u044b \u0438\u0437 \u0431\u0430\u0437\u044b \u0437\u043d\u0430\u043d\u0438\u0439 (\u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439 \u0438\u0445 \u0434\u043b\u044f \u043e\u0442\u0432\u0435\u0442\u0430):\n" + joined
            );
        } else if (ragConfigured) {
            contextParts.add(
                    "\u26a0\ufe0f \u0411\u0410\u0417\u0410 \u0417\u041d\u0410\u041d\u0418\u0419 \u041f\u041e\u0414\u041a\u041b\u042e\u0427\u0415\u041d\u0410, \u041d\u041e \u0420\u0415\u041b\u0415\u0412\u0410\u041d\u0422\u041d\u042b\u0425 \u0424\u0420\u0410\u0413\u041c\u0415\u041d\u0422\u041e\u0412 \u041d\u0415 \u041d\u0410\u0419\u0414\u0415\u041d\u041e.\n" +
                    "\u0412 \u0442\u0432\u043e\u0451\u043c \u043e\u0442\u0432\u0435\u0442\u0435 \u044f\u0432\u043d\u043e \u0443\u043a\u0430\u0436\u0438: \u00ab\u0412 \u0431\u0430\u0437\u0435 \u0437\u043d\u0430\u043d\u0438\u0439 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e \u0440\u0435\u043b\u0435\u0432\u0430\u043d\u0442\u043d\u044b\u0445 " +
                    "\u0434\u0430\u043d\u043d\u044b\u0445 \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0430\u00bb. \u041d\u0415 \u0412\u042b\u0414\u0423\u041c\u042b\u0412\u0410\u0419 \u043d\u0438\u043a\u0430\u043a\u0438\u0435 \u0438\u0441\u0442\u043e\u0440\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0430\u043d\u0430\u043b\u043e\u0433\u0438, " +
                    "\u0441\u0440\u0435\u0434\u043d\u0438\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u044f, \u0440\u0435\u0444\u0435\u0440\u0435\u043d\u0441\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0438\u043b\u0438 \u043f\u0440\u0438\u043c\u0435\u0440\u044b \u2014 \u0435\u0441\u043b\u0438 \u0438\u0445 \u043d\u0435\u0442 \u0432\u043e " +
                    "\u0432\u0445\u043e\u0434\u043d\u044b\u0445 \u0434\u0430\u043d\u043d\u044b\u0445, \u0438\u0445 \u041d\u0415\u0422."
            );
        }

        String context = String.join("\n\n", contextParts);
        return context.isEmpty() ? promptTemplate : promptTemplate + "\n\n" + context;
    }

    // -------------------------------------------------------------------------
    // RAG search
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private List<String> ragSearchForNode(Map<String, Object> node, Map<String, Object> inputData) {
        return ragSearchForNode(node, inputData, 5, null);
    }

    @SuppressWarnings("unchecked")
    private List<String> ragSearchForNode(Map<String, Object> node, Map<String, Object> inputData, int topK, Map<String, float[]> embeddingCache) {
        Map<String, Object> config = (Map<String, Object>) node.getOrDefault("data", Map.of());
        if (config == null) config = Map.of();

        String kbId = strVal(config.get("knowledge_base_id"));
        if (kbId.isEmpty()) return List.of();

        // Build query: prefer previous_output, fall back to prompt, then documents_text
        String query = strVal(inputData.get("previous_output"));
        if (query.isEmpty()) query = strVal(config.get("prompt"));
        if (query.isEmpty()) query = strVal(inputData.get("documents_text"));
        if (query.length() > 800) query = query.substring(0, 800);
        if (query.isEmpty()) return List.of();

        try {
            String cacheKey = query.length() <= 200 ? query : String.valueOf(query.hashCode());
            float[] embedding;
            if (embeddingCache != null && embeddingCache.containsKey(cacheKey)) {
                embedding = embeddingCache.get(cacheKey);
            } else {
                embedding = gigaChatClient.getEmbeddings(List.of(query)).get(0);
                if (embeddingCache != null) {
                    embeddingCache.put(cacheKey, embedding);
                }
            }
            List<String> chunks = embeddingService.searchSimilar("kb", UUID.fromString(kbId), embedding, topK);
            log.info("RAG: found {} chunks in KB {} for node {}", chunks.size(), kbId, node.get("id"));
            return chunks;
        } catch (Exception e) {
            log.error("RAG search failed for KB {}", kbId, e);
            return List.of();
        }
    }

    // -------------------------------------------------------------------------
    // Skip set computation
    // -------------------------------------------------------------------------

    private Set<String> getSkipSet(Set<String> unchosenTargets,
                                   Set<String> chosenTargets,
                                   Map<String, List<String>> successors) {
        Set<String> reachableFromChosen = new HashSet<>();
        for (String ct : chosenTargets) {
            reachableFromChosen.addAll(getAllDescendants(ct, successors));
        }

        Set<String> skip = new HashSet<>();
        for (String ut : unchosenTargets) {
            for (String n : getAllDescendants(ut, successors)) {
                if (!reachableFromChosen.contains(n)) {
                    skip.add(n);
                }
            }
        }
        return skip;
    }

    private Set<String> getAllDescendants(String nodeId, Map<String, List<String>> graph) {
        Set<String> visited = new HashSet<>();
        Deque<String> stack = new ArrayDeque<>();
        stack.push(nodeId);
        while (!stack.isEmpty()) {
            String nid = stack.pop();
            if (visited.contains(nid)) continue;
            visited.add(nid);
            for (String neighbor : graph.getOrDefault(nid, List.of())) {
                stack.push(neighbor);
            }
        }
        return visited;
    }

    // -------------------------------------------------------------------------
    // Classified document parsing (Loop classify_strict output)
    // -------------------------------------------------------------------------

    private static final Pattern DOC_BLOCK_PATTERN = Pattern.compile(
            "<<<DOC_(\\d+)\\|CLASS:(.+?)>>>\\n(.*?)\\n<<<END_DOC_\\1>>>",
            Pattern.DOTALL
    );

    /**
     * Internal record for a classified document.
     */
    public record ClassifiedDoc(int docIndex, String className, String docText) {}

    public List<ClassifiedDoc> parseClassifiedDocs(String text) {
        if (text == null || !text.contains("<<<DOC_")) {
            return List.of();
        }
        List<ClassifiedDoc> results = new ArrayList<>();
        Matcher matcher = DOC_BLOCK_PATTERN.matcher(text);
        while (matcher.find()) {
            int idx = Integer.parseInt(matcher.group(1));
            String cls = matcher.group(2).trim();
            String original = matcher.group(3).trim();
            results.add(new ClassifiedDoc(idx, cls, original));
        }
        return results;
    }

    public String buildFilteredDocuments(List<ClassifiedDoc> classified, Set<String> allowedClasses) {
        Set<String> allowedLower = new HashSet<>();
        for (String c : allowedClasses) allowedLower.add(c.toLowerCase());

        List<String> matching = new ArrayList<>();
        for (ClassifiedDoc cd : classified) {
            if (allowedLower.contains(cd.className.toLowerCase())) {
                matching.add("=== \u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442 " + cd.docIndex + " (" + cd.className + ") ===\n" + cd.docText);
            }
        }
        return String.join("\n\n---\n\n", matching);
    }

    // -------------------------------------------------------------------------
    // Numeric comparison helper (for if_node greater_than / less_than)
    // -------------------------------------------------------------------------

    private static final Pattern NUMBER_PATTERN = Pattern.compile("[\\d\\s]+[,.]?\\d*");

    private boolean compareNumeric(String text, String thresholdStr, boolean greaterThan) {
        try {
            Matcher matcher = NUMBER_PATTERN.matcher(text.replace(" ", ""));
            if (!matcher.find()) return false;
            double val = Double.parseDouble(matcher.group().replace(",", ".").replace(" ", ""));
            double threshold = Double.parseDouble(thresholdStr.replace(",", ".").replace(" ", ""));
            return greaterThan ? val > threshold : val < threshold;
        } catch (Exception e) {
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // Rules parsing
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseRules(Object rulesRaw) {
        if (rulesRaw instanceof List) {
            return (List<Map<String, Object>>) rulesRaw;
        }
        if (rulesRaw instanceof String rulesStr) {
            try {
                return objectMapper.readValue(rulesStr, new TypeReference<>() {});
            } catch (Exception e) {
                log.warn("Failed to parse switch rules: {}", rulesStr);
                return List.of();
            }
        }
        return List.of();
    }

    // -------------------------------------------------------------------------
    // SSE event emission
    // -------------------------------------------------------------------------

    private void emitEvent(FluxSink<ServerSentEvent<Map<String, Object>>> sink,
                           String eventType,
                           Map<String, Object> data) {
        // Build mutable map that includes the "type" field
        Map<String, Object> payload = new LinkedHashMap<>(data);
        payload.put("type", eventType);

        // Don't set .event() — frontend uses generic onmessage handler
        // and parses "type" from the data JSON, not from SSE event field
        sink.next(ServerSentEvent.<Map<String, Object>>builder()
                .data(payload)
                .build());
    }

    // -------------------------------------------------------------------------
    // Utility
    // -------------------------------------------------------------------------

    private static String strVal(Object obj) {
        if (obj == null) return "";
        String s = obj.toString().trim();
        return s;
    }
}
