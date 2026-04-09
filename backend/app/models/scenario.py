import enum

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import JSON

from app.models.base import Base, TimestampMixin, UUIDMixin


class ScenarioRunStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Scenario(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "scenarios"

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    graph_data: Mapped[dict] = mapped_column(JSON, default=dict)

    runs: Mapped[list["ScenarioRun"]] = relationship(
        back_populates="scenario",
        cascade="all, delete-orphan",
        order_by="ScenarioRun.started_at.desc()",
    )


class ScenarioRun(Base, UUIDMixin):
    __tablename__ = "scenario_runs"

    scenario_id: Mapped[str] = mapped_column(
        ForeignKey("scenarios.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(String(20), default="pending")
    input_document_ids: Mapped[dict] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    started_at: Mapped[str | None] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[str | None] = mapped_column(DateTime, nullable=True)

    scenario: Mapped["Scenario"] = relationship(back_populates="runs")
    steps: Mapped[list["ScenarioRunStep"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ScenarioRunStep.started_at",
    )


class ScenarioRunStep(Base, UUIDMixin):
    __tablename__ = "scenario_run_steps"

    run_id: Mapped[str] = mapped_column(
        ForeignKey("scenario_runs.id", ondelete="CASCADE")
    )
    node_id: Mapped[str] = mapped_column(String(100))
    node_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    input_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    prompt_used: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[str | None] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[str | None] = mapped_column(DateTime, nullable=True)

    run: Mapped["ScenarioRun"] = relationship(back_populates="steps")
