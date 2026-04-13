package com.gigame.service;

import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.StreamingChatModel;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.embedding.EmbeddingOptions;
import org.springframework.ai.embedding.EmbeddingRequest;
import org.springframework.ai.embedding.EmbeddingResponse;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Thin wrapper around Spring AI models (auto-configured by the GigaChat starter).
 * Keeps the same public method signatures so ChatService and ScenarioEngine
 * don't need changes.
 */
@Service
public class GigaChatClient {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(GigaChatClient.class);

    private final ChatModel chatModel;
    private final EmbeddingModel embeddingModel;

    public GigaChatClient(ChatModel chatModel,
                          EmbeddingModel embeddingModel) {
        this.chatModel = chatModel;
        this.embeddingModel = embeddingModel;
    }

    // -------------------------------------------------------------------------
    // Chat completion (synchronous)
    // -------------------------------------------------------------------------

    /**
     * Synchronous chat completion.
     *
     * @param messages list of role/content message maps
     * @return the assistant's response content
     */
    public String chatCompletion(List<Map<String, String>> messages) {
        Prompt prompt = toPrompt(messages);
        ChatResponse response = chatModel.call(prompt);
        return response.getResult().getOutput().getText();
    }

    // -------------------------------------------------------------------------
    // Chat completion (streaming)
    // -------------------------------------------------------------------------

    /**
     * Streaming chat completion returning a Flux of content text chunks.
     *
     * @param messages list of role/content message maps
     * @return Flux of content delta strings
     */
    public Flux<String> chatCompletionStream(List<Map<String, String>> messages) {
        // Use sync call wrapped in Flux — spring-ai-gigachat streaming has
        // interop issues with JDK HttpClient + Reactor in WebFlux context.
        // The sync call is reliable and returns the full response.
        return Flux.defer(() -> {
            log.debug("Starting chat completion (sync-as-stream)");
            String result = chatCompletion(messages);
            log.debug("Chat completion done, {} chars", result.length());
            return Flux.just(result);
        });
    }

    // -------------------------------------------------------------------------
    // Embeddings
    // -------------------------------------------------------------------------

    /**
     * Get embeddings for a list of texts. Batches by 50, truncates each text
     * to 800 chars (GigaChat limit ~514 tokens).
     *
     * @param texts texts to embed
     * @return list of float[] embedding arrays
     */
    public List<float[]> getEmbeddings(List<String> texts) {
        List<String> truncated = texts.stream()
                .map(t -> t.length() > 800 ? t.substring(0, 800) : t)
                .toList();

        List<float[]> results = new ArrayList<>();
        for (int i = 0; i < truncated.size(); i += 50) {
            List<String> batch = truncated.subList(i, Math.min(i + 50, truncated.size()));
            // Use GigaChat-specific options to avoid NPE on getModel()
            var opts = chat.giga.springai.GigaChatEmbeddingOptions.builder()
                    .withModel("Embeddings").withDimensions(1024).build();
            EmbeddingResponse response = embeddingModel.call(
                    new EmbeddingRequest(batch, opts));
            for (var embedding : response.getResults()) {
                results.add(embedding.getOutput());
            }
        }
        return results;
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * Convert our List&lt;Map&lt;role,content&gt;&gt; format to a Spring AI Prompt.
     */
    private Prompt toPrompt(List<Map<String, String>> messages) {
        List<Message> aiMessages = new ArrayList<>();
        for (Map<String, String> msg : messages) {
            String role = msg.get("role");
            String content = msg.get("content");
            switch (role) {
                case "system" -> aiMessages.add(new SystemMessage(content));
                case "user" -> aiMessages.add(new UserMessage(content));
                case "assistant" -> aiMessages.add(new AssistantMessage(content));
                default -> aiMessages.add(new UserMessage(content));
            }
        }
        return new Prompt(aiMessages);
    }
}
