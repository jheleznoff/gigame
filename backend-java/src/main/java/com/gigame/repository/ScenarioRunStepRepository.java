package com.gigame.repository;

import com.gigame.model.ScenarioRunStep;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ScenarioRunStepRepository extends JpaRepository<ScenarioRunStep, UUID> {

    List<ScenarioRunStep> findByRunIdOrderByStartedAtAsc(UUID runId);
}
