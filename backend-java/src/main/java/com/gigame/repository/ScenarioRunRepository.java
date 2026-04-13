package com.gigame.repository;

import com.gigame.model.ScenarioRun;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ScenarioRunRepository extends JpaRepository<ScenarioRun, UUID> {

    List<ScenarioRun> findByScenarioIdOrderByStartedAtDesc(UUID scenarioId);
}
