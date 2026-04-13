package com.gigame.controller;

import com.gigame.dto.document.DocumentResponse;
import com.gigame.model.Document;
import com.gigame.repository.DocumentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

@RestController
@RequestMapping("/api/documents")
@RequiredArgsConstructor
public class DocumentController {

    private final DocumentRepository documentRepository;

    @PostMapping(value = "/upload", consumes = org.springframework.http.MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentResponse uploadDocument(@RequestPart("file") FilePart file) {
        // Save FilePart to temp file, then persist entity
        String filename = file.filename();
        try {
            Path tempFile = Files.createTempFile("upload_", "_" + filename);
            file.transferTo(tempFile).block();
            long size = Files.size(tempFile);
            Files.deleteIfExists(tempFile);

            var entity = new Document();
            entity.setFilename(filename);
            entity.setContentType(null);
            entity.setSizeBytes((int) size);
            entity = documentRepository.save(entity);
            return toResponse(entity);
        } catch (IOException e) {
            throw new RuntimeException("Failed to process uploaded file: " + filename, e);
        }
    }

    @GetMapping("/{id}")
    public DocumentResponse getDocument(@PathVariable UUID id) {
        var entity = documentRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found"));
        return toResponse(entity);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteDocument(@PathVariable UUID id) {
        if (!documentRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found");
        }
        documentRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    // ── Mapping helper ───────────────────────────────────────────────────

    private DocumentResponse toResponse(Document d) {
        return new DocumentResponse(
                d.getId(),
                d.getFilename(),
                d.getContentType(),
                d.getSizeBytes() != null ? d.getSizeBytes() : 0,
                d.getExtractedText(),
                d.getCreatedAt(),
                d.getUpdatedAt()
        );
    }
}
