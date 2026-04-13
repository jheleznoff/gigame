package com.gigame.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "scenario_runs")
@Getter
@Setter
@NoArgsConstructor
public class ScenarioRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "scenario_id", nullable = false)
    private UUID scenarioId;

    @Column(nullable = false, length = 50)
    private String status = "pending";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "input_document_ids", columnDefinition = "jsonb")
    private List<String> inputDocumentIds;

    @Column(columnDefinition = "TEXT")
    private String result;

    @Column(name = "started_at", nullable = false)
    private OffsetDateTime startedAt;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    @OneToMany(mappedBy = "runId", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("startedAt ASC")
    private List<ScenarioRunStep> steps = new ArrayList<>();

    @PrePersist
    private void prePersist() {
        if (startedAt == null) {
            startedAt = OffsetDateTime.now();
        }
    }
}
