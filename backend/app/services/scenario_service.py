from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.scenario import Scenario, ScenarioRun


async def get_scenarios(db: AsyncSession) -> list[Scenario]:
    result = await db.execute(
        select(Scenario).order_by(Scenario.updated_at.desc())
    )
    return list(result.scalars().all())


async def get_scenario(db: AsyncSession, scenario_id: str) -> Scenario | None:
    result = await db.execute(
        select(Scenario).where(Scenario.id == scenario_id)
    )
    return result.scalar_one_or_none()


async def create_scenario(
    db: AsyncSession, name: str, description: str | None = None, graph_data: dict | None = None
) -> Scenario:
    scenario = Scenario(
        name=name,
        description=description,
        graph_data=graph_data or {},
    )
    db.add(scenario)
    await db.commit()
    await db.refresh(scenario)
    return scenario


async def update_scenario(
    db: AsyncSession,
    scenario_id: str,
    name: str | None = None,
    description: str | None = None,
    graph_data: dict | None = None,
) -> Scenario | None:
    scenario = await get_scenario(db, scenario_id)
    if not scenario:
        return None
    if name is not None:
        scenario.name = name
    if description is not None:
        scenario.description = description
    if graph_data is not None:
        scenario.graph_data = graph_data
    await db.commit()
    await db.refresh(scenario)
    return scenario


async def duplicate_scenario(db: AsyncSession, scenario_id: str) -> Scenario | None:
    original = await get_scenario(db, scenario_id)
    if not original:
        return None
    copy = Scenario(
        name=f"{original.name} (копия)",
        description=original.description,
        graph_data=original.graph_data,
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return copy


async def delete_scenario(db: AsyncSession, scenario_id: str) -> bool:
    scenario = await get_scenario(db, scenario_id)
    if not scenario:
        return False
    await db.delete(scenario)
    await db.commit()
    return True


async def get_scenario_runs(db: AsyncSession, scenario_id: str) -> list[ScenarioRun]:
    result = await db.execute(
        select(ScenarioRun)
        .where(ScenarioRun.scenario_id == scenario_id)
        .order_by(ScenarioRun.started_at.desc())
    )
    return list(result.scalars().all())


async def get_scenario_run(db: AsyncSession, run_id: str) -> ScenarioRun | None:
    result = await db.execute(
        select(ScenarioRun)
        .where(ScenarioRun.id == run_id)
        .options(selectinload(ScenarioRun.steps))
    )
    return result.scalar_one_or_none()
