package com.gigame.service;

import com.gigame.dto.chat.ConversationResponse;
import com.gigame.dto.chat.ConversationWithMessages;
import com.gigame.dto.chat.MessageResponse;
import com.gigame.model.Conversation;
import com.gigame.model.Document;
import com.gigame.model.Message;
import com.gigame.repository.ConversationRepository;
import com.gigame.repository.DocumentRepository;
import com.gigame.repository.MessageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Chat service — port of Python chat_service.py.
 * Manages conversations, messages, and streaming chat completions with
 * optional document context and RAG from knowledge bases.
 */
@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    /**
     * Documents shorter than this are included as full text in the prompt.
     * Larger documents use similarity search for relevant chunks.
     */
    private static final int CONTEXT_CHAR_LIMIT = 12_000;

    /**
     * Maximum number of conversation history messages to include in the prompt.
     * Older messages are dropped to keep the context window manageable.
     */
    private static final int MAX_HISTORY_MESSAGES = 20;

    private final ConversationRepository conversationRepository;
    private final MessageRepository messageRepository;
    private final DocumentRepository documentRepository;
    private final GigaChatClient gigaChatClient;
    private final EmbeddingService embeddingService;
    private final DocumentService documentService;

    public ChatService(ConversationRepository conversationRepository,
                       MessageRepository messageRepository,
                       DocumentRepository documentRepository,
                       GigaChatClient gigaChatClient,
                       EmbeddingService embeddingService,
                       DocumentService documentService) {
        this.conversationRepository = conversationRepository;
        this.messageRepository = messageRepository;
        this.documentRepository = documentRepository;
        this.gigaChatClient = gigaChatClient;
        this.embeddingService = embeddingService;
        this.documentService = documentService;
    }

    // -------------------------------------------------------------------------
    // Conversations CRUD
    // -------------------------------------------------------------------------

    /**
     * Return all conversations, optionally filtered by title substring.
     */
    public List<ConversationResponse> getConversations(String search) {
        List<Conversation> conversations;
        if (search != null && !search.isBlank()) {
            conversations = conversationRepository.findByTitleContainingIgnoreCaseOrderByUpdatedAtDesc(search);
        } else {
            conversations = conversationRepository.findAllByOrderByUpdatedAtDesc();
        }
        return conversations.stream().map(this::toConversationResponse).toList();
    }

    /**
     * Return a single conversation with its messages. Throws if not found.
     */
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ConversationWithMessages getConversation(UUID id) {
        Conversation conv = conversationRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + id));
        // Use direct query to avoid LazyInitializationException (open-in-view=false)
        List<MessageResponse> msgs = messageRepository.findByConversationIdOrderByCreatedAtAsc(id).stream()
                .map(this::toMessageResponse)
                .toList();
        return new ConversationWithMessages(
                conv.getId(),
                conv.getTitle(),
                conv.getKnowledgeBaseId() != null ? conv.getKnowledgeBaseId().toString() : null,
                conv.getCreatedAt(),
                conv.getUpdatedAt(),
                msgs
        );
    }

    /**
     * Create a new conversation.
     */
    @Transactional
    public ConversationResponse createConversation(String title, String knowledgeBaseId) {
        Conversation conv = new Conversation();
        conv.setTitle(title != null && !title.isBlank() ? title : "Новый диалог");
        if (knowledgeBaseId != null && !knowledgeBaseId.isBlank()) {
            conv.setKnowledgeBaseId(UUID.fromString(knowledgeBaseId));
        }
        conv = conversationRepository.save(conv);
        return toConversationResponse(conv);
    }

    /**
     * Update conversation title.
     */
    @Transactional
    public ConversationResponse updateConversation(UUID id, String title) {
        Conversation conv = conversationRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + id));
        if (title != null && !title.isBlank()) {
            conv.setTitle(title);
        }
        conv = conversationRepository.save(conv);
        return toConversationResponse(conv);
    }

    /**
     * Delete a conversation by id. Throws if not found.
     */
    @Transactional
    public void deleteConversation(UUID id) {
        Conversation conv = conversationRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + id));
        conversationRepository.delete(conv);
    }

    // -------------------------------------------------------------------------
    // Streaming chat
    // -------------------------------------------------------------------------

    /**
     * Send a user message and stream the assistant response as SSE events.
     *
     * <p>Flow:
     * <ol>
     *   <li>Load conversation (throw if missing)</li>
     *   <li>Save user message to DB</li>
     *   <li>Build GigaChat messages list (system context + history + user message)</li>
     *   <li>Stream response from GigaChat</li>
     *   <li>Save assistant message on completion</li>
     *   <li>Emit SSE: {content: chunk}, {usage: {...}}, {done: true}</li>
     * </ol>
     *
     * @param conversationId the conversation UUID
     * @param content        the user message text
     * @param documentIds    optional list of document UUIDs attached to this message
     * @param documentTexts  optional inline document texts (from upload)
     * @return Flux of SSE events
     */
    public Flux<ServerSentEvent<Map<String, Object>>> sendMessageStream(
            UUID conversationId,
            String content,
            List<String> documentIds,
            List<String> documentTexts) {

        // All blocking operations (JPA, GigaChat token refresh) must run
        // on boundedElastic, not the Netty event loop.
        // All blocking ops (JPA, token refresh) on boundedElastic
        return Flux.defer(() -> {
            Conversation conversation = conversationRepository.findById(conversationId)
                    .orElseThrow(() -> new IllegalArgumentException("Conversation not found: " + conversationId));

            Message userMessage = new Message();
            userMessage.setConversationId(conversationId);
            userMessage.setRole("user");
            userMessage.setContent(content);
            userMessage.setDocumentIds(documentIds);
            messageRepository.save(userMessage);

            List<Map<String, String>> chatMessages = buildChatMessages(conversation, content, documentIds, documentTexts);
            StringBuilder fullResponse = new StringBuilder();

            return gigaChatClient.chatCompletionStream(chatMessages)
                    .map(chunk -> {
                        fullResponse.append(chunk);
                        Map<String, Object> event = new HashMap<>();
                        event.put("content", chunk);
                        return ServerSentEvent.<Map<String, Object>>builder()
                                .data(event).build();
                    })
                    .concatWith(Mono.fromCallable(() -> {
                        saveAssistantMessage(conversationId, fullResponse.toString());
                        autoGenerateTitle(conversation, content);
                        Map<String, Object> doneEvent = new HashMap<>();
                        doneEvent.put("done", true);
                        return ServerSentEvent.<Map<String, Object>>builder()
                                .data(doneEvent).build();
                    }));
        }).subscribeOn(Schedulers.boundedElastic());
    }

    // -------------------------------------------------------------------------
    // Message building
    // -------------------------------------------------------------------------

    /**
     * Build the full messages list for GigaChat including system context,
     * conversation history, and the current user message.
     */
    private List<Map<String, String>> buildChatMessages(
            Conversation conversation,
            String userContent,
            List<String> documentIds,
            List<String> documentTexts) {

        List<Map<String, String>> messages = new ArrayList<>();

        // System context: attached documents or RAG
        if (documentTexts != null && !documentTexts.isEmpty()) {
            List<String> ids = documentIds != null ? documentIds : List.of();
            String docContext = buildDocumentsContext(ids, documentTexts, userContent);
            messages.add(Map.of("role", "system", "content", docContext));
        } else if (conversation.getKnowledgeBaseId() != null) {
            String ragContext = buildRagContext(conversation.getKnowledgeBaseId(), userContent);
            if (ragContext != null) {
                messages.add(Map.of("role", "system", "content", ragContext));
            }
        }

        // Conversation history (sliding window: keep only last MAX_HISTORY_MESSAGES)
        List<Message> history = messageRepository.findByConversationIdOrderByCreatedAtAsc(conversation.getId());
        if (history.size() > MAX_HISTORY_MESSAGES) {
            history = history.subList(history.size() - MAX_HISTORY_MESSAGES, history.size());
        }
        for (Message msg : history) {
            messages.add(Map.of("role", msg.getRole(), "content", msg.getContent()));
        }

        // Current user message
        messages.add(Map.of("role", "user", "content", userContent));

        return messages;
    }

    /**
     * Build system context from attached documents.
     *
     * <p>Strategy: small documents (&lt; CONTEXT_CHAR_LIMIT total) are included in full.
     * Large documents get similarity search for relevant chunks.
     */
    private String buildDocumentsContext(List<String> documentIds, List<String> documentTexts, String query) {
        String combined = String.join("\n\n", documentTexts);
        int totalLen = combined.length();

        if (totalLen <= CONTEXT_CHAR_LIMIT) {
            // All documents fit — include everything
            StringBuilder sb = new StringBuilder();
            sb.append("Пользователь загрузил ").append(documentTexts.size())
                    .append(" документ(ов). Используй их содержимое для ответа на вопросы.\n\n");
            for (int i = 0; i < documentTexts.size(); i++) {
                sb.append("--- ДОКУМЕНТ ").append(i + 1).append(" ---\n")
                        .append(documentTexts.get(i))
                        .append("\n--- КОНЕЦ ДОКУМЕНТА ").append(i + 1).append(" ---\n\n");
            }
            return sb.toString();
        }

        // Mixed strategy: small docs in full, large docs via similarity search
        List<String> parts = new ArrayList<>();
        int budget = CONTEXT_CHAR_LIMIT;
        float[] queryEmbedding = null;

        for (int i = 0; i < documentTexts.size(); i++) {
            String docId = i < documentIds.size() ? documentIds.get(i) : null;
            String text = documentTexts.get(i);
            int docNum = i + 1;

            if (text.length() <= budget) {
                parts.add("--- ДОКУМЕНТ " + docNum + " (полный текст) ---\n" + text
                        + "\n--- КОНЕЦ ДОКУМЕНТА " + docNum + " ---");
                budget -= text.length();
            } else {
                // Document too large — similarity search
                List<String> chunks = List.of();
                if (docId != null) {
                    try {
                        if (queryEmbedding == null) {
                            queryEmbedding = gigaChatClient.getEmbeddings(List.of(query)).get(0);
                        }
                        chunks = embeddingService.searchSimilar("doc", UUID.fromString(docId), queryEmbedding, 7);
                    } catch (Exception e) {
                        log.error("Similarity search failed for document {}", docId, e);
                    }
                }

                if (!chunks.isEmpty()) {
                    String joined = String.join("\n\n", chunks);
                    if (joined.length() > budget) {
                        joined = joined.substring(0, budget);
                    }
                    parts.add("--- ДОКУМЕНТ " + docNum + " (релевантные фрагменты) ---\n" + joined
                            + "\n--- КОНЕЦ ДОКУМЕНТА " + docNum + " ---");
                    budget -= joined.length();
                } else {
                    // Fallback: truncate
                    int cutLen = Math.max(budget, 2000);
                    String truncated = text.substring(0, Math.min(cutLen, text.length()));
                    parts.add("--- ДОКУМЕНТ " + docNum + " (обрезан) ---\n" + truncated
                            + "\n--- КОНЕЦ ДОКУМЕНТА " + docNum + " ---");
                    budget -= truncated.length();
                }
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("Пользователь загрузил ").append(documentTexts.size())
                .append(" документ(ов). Используй их содержимое для ответа на вопросы.\n\n");
        sb.append(String.join("\n\n", parts));
        return sb.toString();
    }

    /**
     * Search the knowledge base and build RAG system context.
     *
     * @param kbId  the knowledge base UUID
     * @param query the user's query text
     * @return system message content, or null if no relevant chunks found
     */
    private String buildRagContext(UUID kbId, String query) {
        try {
            float[] queryEmbedding = gigaChatClient.getEmbeddings(List.of(query)).get(0);
            List<String> chunks = embeddingService.searchSimilar("kb", kbId, queryEmbedding, 5);
            if (chunks.isEmpty()) {
                return null;
            }
            log.info("RAG: found {} chunks in KB {}", chunks.size(), kbId);
            String joined = String.join("\n\n---\n\n", chunks);
            return "Ты — ассистент с доступом к базе знаний. Используй приведённые ниже "
                    + "фрагменты для ответа на вопрос пользователя. Если информации недостаточно, "
                    + "скажи об этом.\n\n"
                    + "--- ФРАГМЕНТЫ ИЗ БАЗЫ ЗНАНИЙ ---\n"
                    + joined + "\n"
                    + "--- КОНЕЦ ФРАГМЕНТОВ ---";
        } catch (Exception e) {
            log.error("RAG search failed for KB {}", kbId, e);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Persistence helpers
    // -------------------------------------------------------------------------

    @Transactional
    protected void saveAssistantMessage(UUID conversationId, String content) {
        Message assistantMessage = new Message();
        assistantMessage.setConversationId(conversationId);
        assistantMessage.setRole("assistant");
        assistantMessage.setContent(content);
        messageRepository.save(assistantMessage);
    }

    /**
     * Auto-generate a conversation title after the first message exchange.
     */
    private void autoGenerateTitle(Conversation conversation, String userContent) {
        if (!"Новый диалог".equals(conversation.getTitle())) {
            return;
        }
        List<Message> msgs = messageRepository.findByConversationIdOrderByCreatedAtAsc(conversation.getId());
        // Only auto-title if this is the first exchange (user + assistant = 2 messages)
        if (msgs.size() > 2) {
            return;
        }
        try {
            String titleResponse = gigaChatClient.chatCompletion(List.of(
                    Map.of("role", "system",
                            "content", "Придумай короткий заголовок (3-5 слов) для диалога на основе первого сообщения пользователя. Верни только заголовок, без кавычек и пояснений."),
                    Map.of("role", "user", "content", userContent)
            ));
            String newTitle = titleResponse.strip();
            // Strip surrounding quotes
            if (newTitle.startsWith("\"") || newTitle.startsWith("'")) {
                newTitle = newTitle.substring(1);
            }
            if (newTitle.endsWith("\"") || newTitle.endsWith("'")) {
                newTitle = newTitle.substring(0, newTitle.length() - 1);
            }
            if (newTitle.length() > 100) {
                newTitle = newTitle.substring(0, 100);
            }
            if (!newTitle.isBlank()) {
                conversation.setTitle(newTitle);
                conversationRepository.save(conversation);
            }
        } catch (Exception e) {
            log.error("Failed to auto-generate title", e);
        }
    }

    // -------------------------------------------------------------------------
    // DTO mapping
    // -------------------------------------------------------------------------

    private ConversationResponse toConversationResponse(Conversation conv) {
        return new ConversationResponse(
                conv.getId(),
                conv.getTitle(),
                conv.getKnowledgeBaseId() != null ? conv.getKnowledgeBaseId().toString() : null,
                conv.getCreatedAt(),
                conv.getUpdatedAt()
        );
    }

    private MessageResponse toMessageResponse(Message msg) {
        return new MessageResponse(
                msg.getId(),
                msg.getConversationId(),
                msg.getRole(),
                msg.getContent(),
                msg.getDocumentIds(),
                msg.getCreatedAt()
        );
    }
}
