package com.gigame.controller;

import com.gigame.dto.chat.*;
import com.gigame.service.ChatService;
import com.gigame.service.DocumentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/conversations")
@RequiredArgsConstructor
public class ConversationController {

    private final ChatService chatService;
    private final DocumentService documentService;

    @GetMapping
    public Mono<List<ConversationResponse>> listConversations(@RequestParam(value = "q", defaultValue = "") String q) {
        return Mono.fromCallable(() -> chatService.getConversations(q))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<ConversationResponse> createConversation(@RequestBody ConversationCreate body) {
        return Mono.fromCallable(() -> chatService.createConversation(body.title(), body.knowledgeBaseId()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @GetMapping("/{id}")
    public Mono<ConversationWithMessages> getConversation(@PathVariable UUID id) {
        return Mono.fromCallable(() -> chatService.getConversation(id))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{id}")
    public Mono<ResponseEntity<Void>> deleteConversation(@PathVariable UUID id) {
        return Mono.fromRunnable(() -> chatService.deleteConversation(id))
                .subscribeOn(Schedulers.boundedElastic())
                .then(Mono.just(ResponseEntity.noContent().<Void>build()));
    }

    @PutMapping("/{id}")
    public Mono<ConversationResponse> updateConversation(@PathVariable UUID id, @RequestBody ConversationCreate body) {
        return Mono.fromCallable(() -> chatService.updateConversation(id, body.title()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping(value = "/{id}/messages", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Map<String, Object>>> sendMessage(
            @PathVariable UUID id,
            @RequestBody SendMessageRequest body) {
        // sendMessageStream already uses subscribeOn(boundedElastic) internally
        return chatService.sendMessageStream(id, body.content(), null, null);
    }

    @PostMapping(value = "/{id}/messages/upload",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
            produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Map<String, Object>>> sendMessageWithDocuments(
            @PathVariable UUID id,
            @RequestPart("content") String content,
            @RequestPart(value = "files", required = false) Flux<FilePart> fileFlux) {

        // Collect files on boundedElastic, then stream response
        Mono<List<FilePart>> filesMono = fileFlux != null
                ? fileFlux.collectList().subscribeOn(Schedulers.boundedElastic())
                : Mono.just(List.of());

        return filesMono.flatMapMany(files -> {
            List<String> documentTexts = new ArrayList<>();
            List<String> fileNames = new ArrayList<>();

            for (FilePart file : files) {
                try {
                    String filename = file.filename();
                    String ct = documentService.detectContentType(filename);
                    Path tempFile = Files.createTempFile("upload_", "_" + filename);
                    file.transferTo(tempFile).block();
                    String text = documentService.parseText(tempFile, ct);
                    documentTexts.add(text);
                    fileNames.add(filename);
                    Files.deleteIfExists(tempFile);
                } catch (Exception e) {
                    throw new RuntimeException("Failed to process file: " + file.filename(), e);
                }
            }

            String enrichedContent = content;
            if (!fileNames.isEmpty()) {
                enrichedContent = "Загруженные файлы: " + String.join(", ", fileNames) + "\n\n" + content;
            }

            return chatService.sendMessageStream(id, enrichedContent, null,
                    documentTexts.isEmpty() ? null : documentTexts);
        }).subscribeOn(Schedulers.boundedElastic());
    }
}
