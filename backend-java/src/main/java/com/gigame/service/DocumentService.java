package com.gigame.service;

import com.gigame.model.Document;
import com.gigame.repository.DocumentRepository;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.http.codec.multipart.FilePart;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Handles file upload, text extraction, and document indexing.
 */
@Service
public class DocumentService {

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    /**
     * Documents shorter than this threshold are injected as full text in the prompt.
     * Longer documents get chunked + embedded for similarity search.
     */
    private static final int CONTEXT_CHAR_LIMIT = 12_000;

    private static final Map<String, String> EXTENSION_MAP = Map.of(
            "pdf", "pdf",
            "docx", "docx",
            "xlsx", "xlsx",
            "xls", "xlsx",
            "txt", "txt",
            "text", "txt"
    );

    @Value("${app.upload-dir}")
    private String uploadDir;

    private final DocumentRepository documentRepository;
    private final EmbeddingService embeddingService;
    private final GigaChatClient gigaChatClient;
    private final TextSplitter textSplitter;

    public DocumentService(DocumentRepository documentRepository,
                           EmbeddingService embeddingService,
                           GigaChatClient gigaChatClient,
                           TextSplitter textSplitter) {
        this.documentRepository = documentRepository;
        this.embeddingService = embeddingService;
        this.gigaChatClient = gigaChatClient;
        this.textSplitter = textSplitter;
    }

    // -------------------------------------------------------------------------
    // Upload
    // -------------------------------------------------------------------------

    /**
     * Save uploaded file to disk, extract text, persist in DB, and index if large.
     *
     * @param file the multipart upload
     * @return DTO with document metadata
     */
    public DocumentResponse uploadDocument(FilePart file) {
        String filename = file.filename();
        if (filename == null || filename.isBlank()) {
            filename = "unnamed";
        }
        String contentType = detectContentType(filename);

        UUID fileId = UUID.randomUUID();
        String ext = extractExtension(filename);
        String storedName = fileId + "." + ext;
        Path dirPath = Path.of(uploadDir);
        Path filePath = dirPath.resolve(storedName);

        try {
            Files.createDirectories(dirPath);
            file.transferTo(filePath).block();
        } catch (Exception e) {
            throw new RuntimeException("Failed to save uploaded file", e);
        }

        String extractedText;
        try {
            extractedText = parseText(filePath, contentType);
        } catch (Exception e) {
            // Clean up the saved file before rethrowing
            try {
                Files.deleteIfExists(filePath);
            } catch (IOException deleteEx) {
                log.warn("Failed to delete file after extraction failure: {}", filePath, deleteEx);
            }
            throw new RuntimeException("Failed to extract text from " + filename, e);
        }

        int sizeBytes;
        try {
            sizeBytes = (int) Files.size(filePath);
        } catch (IOException e) {
            sizeBytes = 0;
        }

        Document document = new Document();
        // Don't set ID — let JPA @GeneratedValue handle it
        document.setFilename(filename);
        document.setContentType(contentType);
        document.setFilePath(filePath.toString());
        document.setExtractedText(extractedText);
        document.setSizeBytes(sizeBytes);

        document = documentRepository.save(document);

        // Index large documents for similarity search
        if (extractedText.length() > CONTEXT_CHAR_LIMIT) {
            try {
                indexDocument(document.getId(), extractedText);
            } catch (Exception e) {
                log.error("Failed to index document {}", document.getId(), e);
            }
        }

        return toDto(document);
    }

    // -------------------------------------------------------------------------
    // Text extraction
    // -------------------------------------------------------------------------

    /**
     * Extract plain text from a document file based on its content type.
     *
     * @param filePath    path to the file on disk
     * @param contentType "pdf", "docx", or "txt"
     * @return extracted text
     */
    public String parseText(Path filePath, String contentType) throws IOException {
        return switch (contentType) {
            case "pdf" -> parsePdf(filePath);
            case "docx" -> parseDocx(filePath);
            case "xlsx" -> parseXlsx(filePath);
            case "txt" -> Files.readString(filePath);
            default -> throw new IllegalArgumentException("Unsupported content type: " + contentType);
        };
    }

    private String parsePdf(Path filePath) throws IOException {
        File file = filePath.toFile();
        try (PDDocument doc = Loader.loadPDF(file)) {
            PDFTextStripper stripper = new PDFTextStripper();
            return stripper.getText(doc);
        }
    }

    private String parseDocx(Path filePath) throws IOException {
        List<String> parts = new ArrayList<>();
        try (FileInputStream fis = new FileInputStream(filePath.toFile());
             XWPFDocument doc = new XWPFDocument(fis)) {

            // Paragraphs
            for (XWPFParagraph p : doc.getParagraphs()) {
                String text = p.getText();
                if (text != null && !text.isBlank()) {
                    parts.add(text.strip());
                }
            }

            // Tables (critical for procurement / spec docs)
            for (XWPFTable table : doc.getTables()) {
                for (XWPFTableRow row : table.getRows()) {
                    List<String> cells = row.getTableCells().stream()
                            .map(XWPFTableCell::getText)
                            .map(String::strip)
                            .collect(Collectors.toList());
                    if (cells.stream().anyMatch(c -> !c.isEmpty())) {
                        parts.add(String.join(" | ", cells));
                    }
                }
            }
        }
        return String.join("\n\n", parts);
    }

    private String parseXlsx(Path filePath) throws IOException {
        List<String> parts = new ArrayList<>();
        try (FileInputStream fis = new FileInputStream(filePath.toFile());
             org.apache.poi.xssf.usermodel.XSSFWorkbook wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook(fis)) {

            org.apache.poi.ss.usermodel.DataFormatter fmt = new org.apache.poi.ss.usermodel.DataFormatter();

            for (int s = 0; s < wb.getNumberOfSheets(); s++) {
                org.apache.poi.xssf.usermodel.XSSFSheet sheet = wb.getSheetAt(s);
                String sheetName = sheet.getSheetName();
                if (wb.getNumberOfSheets() > 1) {
                    parts.add("=== Лист: " + sheetName + " ===");
                }
                for (org.apache.poi.ss.usermodel.Row row : sheet) {
                    List<String> cells = new ArrayList<>();
                    for (int c = 0; c < row.getLastCellNum(); c++) {
                        org.apache.poi.ss.usermodel.Cell cell = row.getCell(c);
                        String val = cell != null ? fmt.formatCellValue(cell).strip() : "";
                        cells.add(val);
                    }
                    if (cells.stream().anyMatch(v -> !v.isEmpty())) {
                        parts.add(String.join(" | ", cells));
                    }
                }
                parts.add(""); // blank line between sheets
            }
        }
        return String.join("\n", parts);
    }

    // -------------------------------------------------------------------------
    // Indexing
    // -------------------------------------------------------------------------

    /**
     * Chunk text, compute embeddings, and store in the vector store.
     *
     * @param documentId the document UUID
     * @param text       the full extracted text
     * @return number of chunks created
     */
    public int indexDocument(UUID documentId, String text) {
        List<String> chunks = textSplitter.split(text);
        if (chunks.isEmpty()) {
            return 0;
        }

        // Embed in batches of 50 (GigaChat API limit)
        List<float[]> allEmbeddings = new ArrayList<>();
        for (int i = 0; i < chunks.size(); i += 50) {
            List<String> batch = chunks.subList(i, Math.min(i + 50, chunks.size()));
            allEmbeddings.addAll(gigaChatClient.getEmbeddings(batch));
        }

        embeddingService.storeDocumentChunks(documentId, chunks, allEmbeddings);
        log.info("Indexed document {}: {} chunks", documentId, chunks.size());
        return chunks.size();
    }

    // -------------------------------------------------------------------------
    // Content type detection
    // -------------------------------------------------------------------------

    /**
     * Map filename extension to a normalized content type string.
     *
     * @param filename the original filename
     * @return "pdf", "docx", or "txt"
     * @throws IllegalArgumentException for unsupported extensions
     */
    public String detectContentType(String filename) {
        String ext = extractExtension(filename).toLowerCase();
        String type = EXTENSION_MAP.get(ext);
        if (type == null) {
            throw new IllegalArgumentException("Unsupported file extension: ." + ext);
        }
        return type;
    }

    // -------------------------------------------------------------------------
    // Delete
    // -------------------------------------------------------------------------

    /**
     * Delete a document: remove file from disk, embeddings, and DB record.
     *
     * @param documentId the document UUID
     */
    public void deleteDocument(UUID documentId) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));

        // Delete file from disk
        try {
            Path path = Path.of(doc.getFilePath());
            Files.deleteIfExists(path);
        } catch (IOException e) {
            log.warn("Failed to delete file for document {}: {}", documentId, e.getMessage());
        }

        // Delete embeddings
        embeddingService.deleteDocumentChunks(documentId);

        // Delete DB record
        documentRepository.delete(doc);
    }

    // -------------------------------------------------------------------------
    // DTO conversion
    // -------------------------------------------------------------------------

    /**
     * Convert a Document entity to a DocumentResponse DTO.
     */
    public DocumentResponse toDto(Document doc) {
        return new DocumentResponse(
                doc.getId(),
                doc.getFilename(),
                doc.getContentType(),
                doc.getSizeBytes(),
                doc.getExtractedText() != null ? doc.getExtractedText().length() : 0,
                doc.getCreatedAt(),
                doc.getUpdatedAt()
        );
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static String extractExtension(String filename) {
        int dotIdx = filename.lastIndexOf('.');
        if (dotIdx < 0) {
            return "bin";
        }
        return filename.substring(dotIdx + 1);
    }

    // -------------------------------------------------------------------------
    // DTO record
    // -------------------------------------------------------------------------

    /**
     * Immutable response DTO for document metadata.
     */
    public record DocumentResponse(
            UUID id,
            String filename,
            String contentType,
            Integer sizeBytes,
            int textLength,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt
    ) {}
}
