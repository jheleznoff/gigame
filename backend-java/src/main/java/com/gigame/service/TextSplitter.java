package com.gigame.service;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Port of langchain RecursiveCharacterTextSplitter.
 * Splits text into overlapping chunks using recursive separator strategy.
 */
@Component
public class TextSplitter {

    private static final String[] SEPARATORS = {"\n\n", "\n", ". ", " ", ""};

    /**
     * Split text into chunks with default settings (chunkSize=1000, overlap=200).
     */
    public List<String> split(String text) {
        return split(text, 1000, 200);
    }

    /**
     * Split text into overlapping chunks using recursive character splitting.
     *
     * @param text      the text to split
     * @param chunkSize maximum chunk size in characters
     * @param overlap   overlap between consecutive chunks in characters
     * @return list of text chunks
     */
    public List<String> split(String text, int chunkSize, int overlap) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        List<String> chunks = splitRecursive(text, chunkSize, 0);
        return mergeWithOverlap(chunks, chunkSize, overlap);
    }

    /**
     * Recursively split text by finding the first separator that produces sub-chunks.
     * If any sub-chunk is still larger than chunkSize, recurse with the next separator.
     */
    private List<String> splitRecursive(String text, int chunkSize, int separatorIndex) {
        if (text.length() <= chunkSize) {
            return List.of(text);
        }

        if (separatorIndex >= SEPARATORS.length) {
            // No more separators — hard-cut at chunkSize
            List<String> result = new ArrayList<>();
            for (int i = 0; i < text.length(); i += chunkSize) {
                result.add(text.substring(i, Math.min(i + chunkSize, text.length())));
            }
            return result;
        }

        String separator = SEPARATORS[separatorIndex];
        String[] parts;
        if (separator.isEmpty()) {
            // Empty separator: split into individual characters grouped by chunkSize
            List<String> result = new ArrayList<>();
            for (int i = 0; i < text.length(); i += chunkSize) {
                result.add(text.substring(i, Math.min(i + chunkSize, text.length())));
            }
            return result;
        } else {
            parts = text.split(java.util.regex.Pattern.quote(separator), -1);
        }

        if (parts.length <= 1) {
            // Separator not found — try next one
            return splitRecursive(text, chunkSize, separatorIndex + 1);
        }

        List<String> result = new ArrayList<>();
        for (String part : parts) {
            String trimmed = part.strip();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (trimmed.length() <= chunkSize) {
                result.add(trimmed);
            } else {
                // Sub-chunk still too large — recurse with next separator
                result.addAll(splitRecursive(trimmed, chunkSize, separatorIndex + 1));
            }
        }
        return result;
    }

    /**
     * Merge small consecutive chunks together up to chunkSize, with overlap
     * by re-including trailing text from the previous merged chunk.
     */
    private List<String> mergeWithOverlap(List<String> chunks, int chunkSize, int overlap) {
        if (chunks.isEmpty()) {
            return chunks;
        }

        List<String> merged = new ArrayList<>();
        StringBuilder current = new StringBuilder();

        for (String chunk : chunks) {
            if (current.isEmpty()) {
                current.append(chunk);
            } else if (current.length() + 1 + chunk.length() <= chunkSize) {
                current.append(" ").append(chunk);
            } else {
                merged.add(current.toString());
                // Start new chunk with overlap from the end of the previous one
                String prev = current.toString();
                current = new StringBuilder();
                if (overlap > 0 && prev.length() > overlap) {
                    String overlapText = prev.substring(prev.length() - overlap);
                    // Try to start overlap at a word boundary
                    int spaceIdx = overlapText.indexOf(' ');
                    if (spaceIdx >= 0 && spaceIdx < overlapText.length() - 1) {
                        overlapText = overlapText.substring(spaceIdx + 1);
                    }
                    current.append(overlapText).append(" ").append(chunk);
                } else {
                    current.append(chunk);
                }
            }
        }

        if (!current.isEmpty()) {
            merged.add(current.toString());
        }

        return merged;
    }
}
