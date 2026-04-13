package com.gigame.controller;

import com.gigame.dto.scenario.*;
import com.gigame.model.Scenario;
import com.gigame.model.ScenarioRun;
import com.gigame.repository.ScenarioRepository;
import com.gigame.repository.ScenarioRunRepository;
import com.gigame.service.DocumentService;
import com.gigame.service.ScenarioEngine;
import com.gigame.service.ScenarioService;
import lombok.RequiredArgsConstructor;
import org.apache.poi.xwpf.usermodel.*;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/scenarios")
@RequiredArgsConstructor
public class ScenarioController {

    private final ScenarioService scenarioService;
    private final ScenarioEngine scenarioEngine;
    private final ScenarioRepository scenarioRepository;
    private final ScenarioRunRepository scenarioRunRepository;
    private final DocumentService documentService;

    // ── Scenario CRUD ────────────────────────────────────────────────────

    @GetMapping
    public Mono<List<ScenarioResponse>> listScenarios() {
        return Mono.fromCallable(() -> scenarioService.getScenarios())
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<ScenarioResponse> createScenario(@RequestBody ScenarioCreate body) {
        return Mono.fromCallable(() -> scenarioService.createScenario(body.name(), body.description(), body.graphData()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @GetMapping("/{id}")
    public Mono<ScenarioDetailResponse> getScenario(@PathVariable UUID id) {
        return Mono.fromCallable(() -> scenarioService.getScenario(id))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PutMapping("/{id}")
    public Mono<ScenarioResponse> updateScenario(@PathVariable UUID id, @RequestBody ScenarioUpdate body) {
        return Mono.fromCallable(() -> scenarioService.updateScenario(id, body.name(), body.description(), body.graphData()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{id}")
    public Mono<ResponseEntity<Void>> deleteScenario(@PathVariable UUID id) {
        return Mono.fromRunnable(() -> scenarioService.deleteScenario(id))
                .subscribeOn(Schedulers.boundedElastic())
                .then(Mono.just(ResponseEntity.noContent().<Void>build()));
    }

    @PostMapping("/{id}/duplicate")
    public Mono<ScenarioResponse> duplicateScenario(@PathVariable UUID id) {
        return Mono.fromCallable(() -> scenarioService.duplicateScenario(id))
                .subscribeOn(Schedulers.boundedElastic());
    }

    // ── Runs ─────────────────────────────────────────────────────────────

    @GetMapping("/{id}/runs")
    public Mono<List<ScenarioRunResponse>> listRuns(@PathVariable UUID id) {
        return Mono.fromCallable(() -> scenarioService.getScenarioRuns(id))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping(value = "/{id}/run", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Map<String, Object>>> runScenario(
            @PathVariable UUID id,
            @RequestPart(value = "files", required = false) Flux<FilePart> fileFlux,
            @RequestParam(value = "step_mode", required = false) Boolean stepMode) {

        // Collect files first, then do all blocking work on boundedElastic
        Mono<List<FilePart>> filesMono = fileFlux != null
                ? fileFlux.collectList()
                : Mono.just(List.of());

        return filesMono.flatMapMany(files -> Flux.defer(() -> {
            Scenario scenario = scenarioRepository.findById(id)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Scenario not found"));

            ScenarioRun run = new ScenarioRun();
            run.setScenarioId(id);
            run.setStatus("running");
            run.setStartedAt(OffsetDateTime.now());
            run = scenarioRunRepository.save(run);

            if (Boolean.TRUE.equals(stepMode)) {
                scenarioEngine.enableStepMode(run.getId().toString());
            }

            List<ServerSentEvent<Map<String, Object>>> uploadEvents = new ArrayList<>();
            String documentsText = null;

            if (!files.isEmpty()) {
                List<String> extractedTexts = new ArrayList<>();
                for (int i = 0; i < files.size(); i++) {
                    FilePart file = files.get(i);
                    String filename = file.filename();

                    uploadEvents.add(ServerSentEvent.<Map<String, Object>>builder()
                            .data(Map.of("type", "upload_progress",
                                    "file", filename, "current", i + 1, "total", files.size()))
                            .build());

                    try {
                        String contentType = documentService.detectContentType(filename);
                        Path tempFile = Files.createTempFile("scenario_", "_" + filename);
                        file.transferTo(tempFile).block();
                        String text = documentService.parseText(tempFile, contentType);
                        extractedTexts.add(text);
                        Files.deleteIfExists(tempFile);
                    } catch (Exception e) {
                        throw new RuntimeException("Failed to process file: " + filename, e);
                    }
                }

                documentsText = String.join("\n---\n", extractedTexts);
                run = scenarioRunRepository.save(run);

                uploadEvents.add(ServerSentEvent.<Map<String, Object>>builder()
                        .data(Map.of("type", "upload_done", "count", files.size()))
                        .build());
            }

            Flux<ServerSentEvent<Map<String, Object>>> engineFlux =
                    scenarioEngine.executeScenario(run, scenario.getGraphData(), documentsText);

            if (!uploadEvents.isEmpty()) {
                return Flux.fromIterable(uploadEvents).concatWith(engineFlux);
            }
            return engineFlux;
        }).subscribeOn(Schedulers.boundedElastic()));
    }

    @GetMapping("/runs/{runId}")
    public Mono<ScenarioRunDetailResponse> getRunDetail(@PathVariable UUID runId) {
        return Mono.fromCallable(() -> scenarioService.getScenarioRun(runId))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping("/runs/{runId}/continue")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public Mono<Void> continueRun(@PathVariable UUID runId) {
        return Mono.fromRunnable(() -> scenarioEngine.continueStep(runId.toString()))
                .subscribeOn(Schedulers.boundedElastic()).then();
    }

    @PostMapping("/runs/{runId}/disable-step-mode")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public Mono<Void> disableStepMode(@PathVariable UUID runId) {
        return Mono.fromRunnable(() -> scenarioEngine.disableStepMode(runId.toString()))
                .subscribeOn(Schedulers.boundedElastic()).then();
    }

    @GetMapping("/runs/{runId}/export")
    public ResponseEntity<Resource> exportRun(@PathVariable UUID runId) {
        ScenarioRunDetailResponse runDetail = scenarioService.getScenarioRun(runId);

        try (XWPFDocument doc = new XWPFDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {

            // Title
            XWPFParagraph titlePara = doc.createParagraph();
            XWPFRun titleRun = titlePara.createRun();
            titleRun.setBold(true);
            titleRun.setFontSize(16);
            titleRun.setText("Результат сценария");

            // Status
            XWPFParagraph statusPara = doc.createParagraph();
            XWPFRun statusRun = statusPara.createRun();
            statusRun.setText("Статус: " + runDetail.status());

            // Steps
            if (runDetail.steps() != null && !runDetail.steps().isEmpty()) {
                XWPFParagraph stepsHeader = doc.createParagraph();
                XWPFRun stepsHeaderRun = stepsHeader.createRun();
                stepsHeaderRun.setBold(true);
                stepsHeaderRun.setFontSize(14);
                stepsHeaderRun.setText("Шаги выполнения");

                for (ScenarioRunStepResponse step : runDetail.steps()) {
                    XWPFParagraph stepPara = doc.createParagraph();
                    XWPFRun stepRun = stepPara.createRun();
                    stepRun.setBold(true);
                    stepRun.setText("Узел: " + step.nodeId() + " (" + step.nodeType() + ") — " + step.status());

                    if (step.outputData() != null) {
                        String stepText = step.outputData().toString();
                        writeMarkdownToDocx(doc, stepText);
                    }
                }
            }

            // Result
            if (runDetail.result() != null) {
                XWPFParagraph resultHeader = doc.createParagraph();
                XWPFRun resultHeaderRun = resultHeader.createRun();
                resultHeaderRun.setBold(true);
                resultHeaderRun.setFontSize(14);
                resultHeaderRun.setText("Итоговый результат");

                String resultText = runDetail.result() != null ? runDetail.result().toString() : "";
                writeMarkdownToDocx(doc, resultText);
            }

            doc.write(baos);

            String filename = "result_" + runId.toString().substring(0, 8) + ".docx";
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                    .contentType(MediaType.parseMediaType(
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
                    .body(new InputStreamResource(new ByteArrayInputStream(baos.toByteArray())));
        } catch (IOException e) {
            throw new RuntimeException("Failed to generate DOCX export", e);
        }
    }

    // ── Markdown → DOCX helpers ─────────────────────────────────────────

    private void writeMarkdownToDocx(XWPFDocument doc, String markdown) {
        String[] lines = markdown.split("\n");
        boolean inTable = false;
        List<String[]> tableRows = new ArrayList<>();

        for (String line : lines) {
            if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
                if (line.contains("---")) continue; // separator row
                String[] cells = Arrays.stream(line.split("\\|"))
                        .filter(s -> !s.trim().isEmpty())
                        .map(String::trim)
                        .toArray(String[]::new);
                tableRows.add(cells);
                inTable = true;
                continue;
            }
            if (inTable) {
                writeTable(doc, tableRows);
                tableRows.clear();
                inTable = false;
            }
            if (line.trim().isEmpty()) {
                doc.createParagraph();
            } else if (line.startsWith("### ")) {
                XWPFParagraph p = doc.createParagraph();
                XWPFRun r = p.createRun();
                r.setBold(true);
                r.setFontSize(13);
                r.setText(line.substring(4));
            } else if (line.startsWith("## ")) {
                XWPFParagraph p = doc.createParagraph();
                XWPFRun r = p.createRun();
                r.setBold(true);
                r.setFontSize(14);
                r.setText(line.substring(3));
            } else if (line.startsWith("# ")) {
                XWPFParagraph p = doc.createParagraph();
                XWPFRun r = p.createRun();
                r.setBold(true);
                r.setFontSize(16);
                r.setText(line.substring(2));
            } else if (line.startsWith("- ") || line.startsWith("* ")) {
                XWPFParagraph p = doc.createParagraph();
                p.setIndentationLeft(400);
                XWPFRun r = p.createRun();
                r.setText("\u2022 " + stripBold(line.substring(2)));
            } else {
                XWPFParagraph p = doc.createParagraph();
                writeBoldAwareLine(p, line);
            }
        }
        if (inTable && !tableRows.isEmpty()) {
            writeTable(doc, tableRows);
        }
    }

    private void writeTable(XWPFDocument doc, List<String[]> rows) {
        if (rows.isEmpty()) return;
        int cols = rows.get(0).length;
        XWPFTable table = doc.createTable(rows.size(), cols);
        table.setWidth("100%");
        for (int i = 0; i < rows.size(); i++) {
            XWPFTableRow row = table.getRow(i);
            for (int j = 0; j < cols && j < rows.get(i).length; j++) {
                XWPFTableCell cell = row.getCell(j);
                cell.setText(stripBold(rows.get(i)[j]));
                if (i == 0) {
                    cell.getParagraphs().get(0).getRuns().forEach(r -> r.setBold(true));
                }
            }
        }
    }

    private String stripBold(String text) {
        return text.replaceAll("\\*\\*(.+?)\\*\\*", "$1");
    }

    private void writeBoldAwareLine(XWPFParagraph p, String line) {
        Pattern bold = Pattern.compile("\\*\\*(.+?)\\*\\*");
        Matcher m = bold.matcher(line);
        int last = 0;
        while (m.find()) {
            if (m.start() > last) {
                XWPFRun r = p.createRun();
                r.setText(line.substring(last, m.start()));
            }
            XWPFRun r = p.createRun();
            r.setBold(true);
            r.setText(m.group(1));
            last = m.end();
        }
        if (last < line.length()) {
            XWPFRun r = p.createRun();
            r.setText(line.substring(last));
        }
    }
}
