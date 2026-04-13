package com.gigame.controller;

import com.gigame.dto.kb.*;
import com.gigame.service.KBService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/knowledge-bases")
@RequiredArgsConstructor
public class KnowledgeBaseController {

    private final KBService kbService;

    @GetMapping
    public Mono<List<KBResponse>> listKnowledgeBases(@RequestParam(value = "q", defaultValue = "") String q) {
        return Mono.fromCallable(() -> kbService.getKnowledgeBases(q))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<KBResponse> createKnowledgeBase(@RequestBody KBCreate body) {
        return Mono.fromCallable(() -> kbService.createKnowledgeBase(body.name(), body.description()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @GetMapping("/{id}")
    public Mono<KBDetailResponse> getKnowledgeBase(@PathVariable UUID id) {
        return Mono.fromCallable(() -> kbService.getKnowledgeBase(id))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PutMapping("/{id}")
    public Mono<KBResponse> updateKnowledgeBase(@PathVariable UUID id, @RequestBody KBUpdate body) {
        return Mono.fromCallable(() -> kbService.updateKnowledgeBase(id, body.name(), body.description()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{id}")
    public Mono<ResponseEntity<Void>> deleteKnowledgeBase(@PathVariable UUID id) {
        return Mono.fromRunnable(() -> kbService.deleteKnowledgeBase(id))
                .subscribeOn(Schedulers.boundedElastic())
                .then(Mono.just(ResponseEntity.noContent().<Void>build()));
    }

    @PostMapping(value = "/{id}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<KBDocumentResponse> uploadDocumentToKB(
            @PathVariable UUID id,
            @RequestPart("file") FilePart file) {
        return Mono.fromCallable(() -> kbService.addDocumentToKB(id, file))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping("/{id}/documents/{docId}/reindex")
    public Mono<KBDocumentResponse> reindexDocument(@PathVariable UUID id, @PathVariable UUID docId) {
        return Mono.fromCallable(() -> kbService.reindexDocument(id, docId))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{id}/documents/{docId}")
    public Mono<ResponseEntity<Void>> removeDocumentFromKB(@PathVariable UUID id, @PathVariable UUID docId) {
        return Mono.fromRunnable(() -> kbService.removeDocumentFromKB(id, docId))
                .subscribeOn(Schedulers.boundedElastic())
                .then(Mono.just(ResponseEntity.noContent().<Void>build()));
    }
}
