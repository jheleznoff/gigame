"""Scenario execution engine — traverses the node graph and executes each step."""

import asyncio
import logging
from collections import defaultdict
from collections.abc import AsyncGenerator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import partial

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scenario import ScenarioRun, ScenarioRunStep
from app.services import gigachat_client

_executor = ThreadPoolExecutor(max_workers=2)

logger = logging.getLogger(__name__)

# Step-by-step debug mode state (in-memory, per run_id)
_pause_events: dict[str, asyncio.Event] = {}
_step_mode_runs: set[str] = set()


def enable_step_mode(run_id: str) -> None:
    """Enable step-by-step pause mode for a run."""
    _step_mode_runs.add(run_id)
    _pause_events[run_id] = asyncio.Event()


def disable_step_mode(run_id: str) -> None:
    """Disable step mode (continue without further pauses)."""
    _step_mode_runs.discard(run_id)
    ev = _pause_events.get(run_id)
    if ev:
        ev.set()  # release any waiter


def continue_step(run_id: str) -> bool:
    """Signal the engine to proceed past the current pause point."""
    ev = _pause_events.get(run_id)
    if ev is None:
        return False
    ev.set()
    return True


def cleanup_run(run_id: str) -> None:
    """Cleanup run state after completion."""
    _pause_events.pop(run_id, None)
    _step_mode_runs.discard(run_id)


async def _pause_if_step_mode(run_id: str, step_data: dict) -> dict | None:
    """If run is in step mode, pause and return a step_paused event."""
    if run_id not in _step_mode_runs:
        return None
    return {"type": "step_paused", **step_data}


# Marker format for structured Loop output (classify_strict mode)
# This lets Switch parse loop results and filter original documents per branch.
DOC_MARKER_START = "<<<DOC_{idx}|CLASS:{cls}>>>"
DOC_MARKER_END = "<<<END_DOC_{idx}>>>"
import re as _re
_DOC_BLOCK_RE = _re.compile(
    r"<<<DOC_(\d+)\|CLASS:(.+?)>>>\n(.*?)\n<<<END_DOC_\1>>>",
    _re.DOTALL,
)


def parse_classified_docs(text: str) -> list[tuple[int, str, str]]:
    """Parse Loop output that uses DOC_MARKER format.

    Returns list of (doc_index, class_name, original_text) tuples.
    Empty list if input doesn't contain markers.
    """
    if "<<<DOC_" not in text:
        return []
    results = []
    for m in _DOC_BLOCK_RE.finditer(text):
        idx = int(m.group(1))
        cls = m.group(2).strip()
        original = m.group(3).strip()
        results.append((idx, cls, original))
    return results


def build_filtered_documents(classified: list[tuple[int, str, str]], allowed_classes: set[str]) -> str:
    """Build a documents_text containing only docs whose class matches allowed_classes."""
    matching = [
        f"=== Документ {idx} ({cls}) ===\n{original}"
        for idx, cls, original in classified
        if cls.lower() in {c.lower() for c in allowed_classes}
    ]
    return "\n\n---\n\n".join(matching)


async def _async_chat_completion(messages: list[dict[str, str]]) -> str:
    """Run blocking GigaChat call in a thread pool to avoid blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor, partial(gigachat_client.chat_completion, messages)
    )


def _topological_sort(nodes: list[dict], edges: list[dict]) -> list[str]:
    """Sort node IDs in execution order based on edges."""
    graph: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}

    for edge in edges:
        src, tgt = edge["source"], edge["target"]
        graph[src].append(tgt)
        in_degree[tgt] = in_degree.get(tgt, 0) + 1

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    result = []
    while queue:
        nid = queue.pop(0)
        result.append(nid)
        for neighbor in graph[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    return result


def _get_all_descendants(node_id: str, graph: dict[str, list[str]]) -> set[str]:
    """Get all nodes reachable from node_id via DFS (including itself)."""
    visited: set[str] = set()
    stack = [node_id]
    while stack:
        nid = stack.pop()
        if nid in visited:
            continue
        visited.add(nid)
        stack.extend(graph.get(nid, []))
    return visited


def _get_skip_set(
    unchosen_targets: set[str],
    chosen_targets: set[str],
    successors: dict[str, list[str]],
) -> set[str]:
    """Compute nodes that should be skipped after a branching decision.

    A node is skipped only if it is reachable from unchosen branches AND
    NOT reachable from any chosen branch. This way merge-nodes (e.g. final
    report that all branches feed into) are NOT skipped — they still
    receive output from at least one active branch.
    """
    skip = set()
    reachable_from_chosen: set[str] = set()
    for ct in chosen_targets:
        reachable_from_chosen |= _get_all_descendants(ct, successors)
    for ut in unchosen_targets:
        for n in _get_all_descendants(ut, successors):
            if n not in reachable_from_chosen:
                skip.add(n)
    return skip


def _build_prompt(node: dict, input_data: dict) -> str:
    """Build a prompt for a node based on its type and config."""
    node_type = node.get("type", "")
    config = node.get("data", {})
    prompt_template = config.get("prompt", "")
    documents_text = input_data.get("documents_text", "")
    previous_output = input_data.get("previous_output", "")

    MAX_CONTEXT = 30000
    context_parts = []
    if documents_text:
        doc_text = documents_text
        if len(doc_text) > MAX_CONTEXT:
            doc_text = doc_text[:MAX_CONTEXT] + "\n\n[... документы обрезаны ...]"
        context_parts.append(f"Документы:\n{doc_text}")
    if previous_output:
        prev = previous_output
        if len(prev) > MAX_CONTEXT:
            prev = prev[:MAX_CONTEXT] + "\n\n[... обрезано ...]"
        context_parts.append(f"Результат предыдущего шага:\n{prev}")

    context = "\n\n".join(context_parts)

    if node_type == "classification":
        categories = config.get("categories", "")
        return (
            f"{prompt_template}\n\n"
            f"Категории: {categories}\n\n"
            f"{context}\n\n"
            "Определи категорию и верни только название категории."
        )
    elif node_type == "extraction":
        fields = config.get("fields", "")
        return (
            f"{prompt_template}\n\n"
            f"Извлеки следующие поля: {fields}\n\n"
            f"{context}\n\n"
            "Верни результат в формате JSON."
        )
    elif node_type == "condition":
        branches = config.get("branches", "")
        return (
            f"{prompt_template}\n\n"
            f"Возможные варианты: {branches}\n\n"
            f"{context}\n\n"
            f"Проанализируй и верни ТОЛЬКО одно слово — название подходящего варианта из списка: {branches}. "
            "Ничего больше не пиши, только название варианта."
        )
    elif node_type == "processing":
        return f"{prompt_template}\n\n{context}"
    elif node_type in ("loop", "loop_subgraph"):
        return f"{prompt_template}\n\n{context}"
    else:
        return f"{prompt_template}\n\n{context}" if context else prompt_template


async def execute_scenario(
    db: AsyncSession,
    run: ScenarioRun,
    graph_data: dict,
    documents_text: str,
) -> AsyncGenerator[dict, None]:
    """Execute a scenario graph and yield progress events."""
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])
    node_map = {n["id"]: n for n in nodes}

    sorted_ids = _topological_sort(nodes, edges)

    run.status = "running"
    await db.commit()
    yield {"type": "status", "run_id": run.id, "status": "running"}

    # Track outputs per node
    node_outputs: dict[str, str] = {}

    # Track skipped nodes (from condition branches not taken)
    skipped_nodes: set[str] = set()

    # Per-node documents_text override (set by Switch when filtering by class)
    # Maps target node_id → filtered documents text (only matching docs)
    branch_docs_override: dict[str, str] = {}

    # Build graph structures
    successors: dict[str, list[str]] = defaultdict(list)
    predecessors: dict[str, list[str]] = defaultdict(list)
    # Map: (source, target) -> edge data
    edge_map: dict[tuple[str, str], dict] = {}
    for edge in edges:
        src, tgt = edge["source"], edge["target"]
        successors[src].append(tgt)
        predecessors[tgt].append(src)
        edge_map[(src, tgt)] = edge.get("data", {}) or {}

    for node_id in sorted_ids:
        node = node_map.get(node_id)
        if not node:
            continue

        node_type = node.get("type", "unknown")
        node_label = node.get("data", {}).get("label", "") or node_type
        total_nodes = len(sorted_ids)
        node_index = sorted_ids.index(node_id) + 1

        # Check if this node was skipped by a condition
        if node_id in skipped_nodes:
            yield {
                "type": "node_status", "node_id": node_id,
                "node_label": node_label, "node_type": node_type,
                "status": "skipped", "step": node_index, "total": total_nodes,
            }
            continue

        # Skip input/output nodes
        if node_type == "input":
            node_outputs[node_id] = documents_text
            yield {"type": "node_status", "node_id": node_id, "node_label": node_label, "node_type": node_type, "status": "completed", "step": node_index, "total": total_nodes}
            continue
        if node_type == "output":
            prev = predecessors.get(node_id, [])
            # Concatenate output from ALL non-skipped predecessors
            outputs = [
                node_outputs[pid]
                for pid in prev
                if pid not in skipped_nodes and pid in node_outputs
            ]
            output = "\n\n".join(outputs)
            node_outputs[node_id] = output
            yield {"type": "node_status", "node_id": node_id, "node_label": node_label, "node_type": node_type, "status": "completed", "step": node_index, "total": total_nodes}
            continue

        # Create step record
        step = ScenarioRunStep(
            run_id=run.id,
            node_id=node_id,
            node_type=node_type,
            status="running",
        )
        db.add(step)
        await db.commit()
        await db.refresh(step)

        yield {"type": "node_status", "node_id": node_id, "node_label": node_label, "node_type": node_type, "status": "running", "step": node_index, "total": total_nodes}

        # Gather input from non-skipped predecessors
        prev_ids = predecessors.get(node_id, [])
        previous_output = "\n\n".join(
            node_outputs[pid] for pid in prev_ids
            if pid in node_outputs and pid not in skipped_nodes
        )

        # If a previous Switch filtered docs for this node, use the filtered set
        # instead of the global documents_text. This makes branches receive
        # ONLY the original text of documents matching their class.
        effective_documents = branch_docs_override.get(node_id, documents_text)

        input_data = {
            "documents_text": effective_documents,
            "previous_output": previous_output,
        }

        prompt = None  # initialized for safety; set in branches that build a prompt
        try:
            # Handle different node types
            if node_type == "loop":
                docs = documents_text.split("---") if documents_text else [documents_text]
                docs = [d.strip() for d in docs if d.strip()]
                loop_results = []
                # classify_strict mode: prompt asks ONLY for class, output uses markers
                # so downstream Switch can filter original documents per branch
                classify_strict = node.get("data", {}).get("classify_strict", False)
                classes_hint = node.get("data", {}).get("classes", "ПЗ, КП, ПРИКАЗ")

                for i, doc_part in enumerate(docs):
                    if classify_strict:
                        # Strict prompt: return ONLY class name, one word
                        strict_prompt = (
                            f"Определи тип документа. Верни СТРОГО ОДНО слово — название класса "
                            f"из списка: {classes_hint}.\n"
                            f"Не пиши пояснений, не повторяй задание, не добавляй знаков препинания.\n\n"
                            f"Документ:\n{doc_part}"
                        )
                        cls_raw = await _async_chat_completion([
                            {"role": "user", "content": strict_prompt}
                        ])
                        # Extract first non-empty token as class
                        cls = cls_raw.strip().split()[0].strip('".,:;()[]') if cls_raw.strip() else "UNKNOWN"
                        # Build structured marker block with original text
                        loop_results.append(
                            f"<<<DOC_{i + 1}|CLASS:{cls}>>>\n{doc_part}\n<<<END_DOC_{i + 1}>>>"
                        )
                        yield {
                            "type": "loop_progress", "node_id": node_id,
                            "iteration": i + 1, "total": len(docs),
                            "detail": f"classified as {cls}",
                        }
                    else:
                        # Original (analyze) mode: full prompt, free-form result
                        loop_input = {"documents_text": doc_part, "previous_output": ""}
                        prompt = _build_prompt(node, loop_input)
                        result = await _async_chat_completion([
                            {"role": "user", "content": prompt}
                        ])
                        loop_results.append(f"Документ {i + 1}:\n{result}")
                        yield {"type": "loop_progress", "node_id": node_id, "iteration": i + 1, "total": len(docs)}
                    if i < len(docs) - 1:
                        await asyncio.sleep(1)
                output = "\n\n".join(loop_results)

            elif node_type == "loop_subgraph":
                # Per-item branching: classify each doc, then run branch-specific prompt
                config = node.get("data", {})
                branches_str = config.get("branches", "")
                branch_names = [b.strip() for b in branches_str.split(",") if b.strip()]

                # Parse branch_prompts from config (JSON string → dict)
                branch_prompts_raw = config.get("branch_prompts", "{}")
                try:
                    if isinstance(branch_prompts_raw, str):
                        import json as _json
                        branch_prompts = _json.loads(branch_prompts_raw)
                    else:
                        branch_prompts = branch_prompts_raw
                except Exception:
                    branch_prompts = {}

                docs = documents_text.split("---") if documents_text else [documents_text]
                docs = [d.strip() for d in docs if d.strip()]

                # Accumulate results by branch
                branch_results: dict[str, list[str]] = {b: [] for b in branch_names}
                all_results: list[str] = []

                for i, doc_part in enumerate(docs):
                    # Step 1: classify + extract with the main prompt
                    loop_input = {"documents_text": doc_part, "previous_output": ""}
                    prompt = _build_prompt(node, loop_input)
                    classify_result = await _async_chat_completion([
                        {"role": "user", "content": prompt}
                    ])

                    yield {
                        "type": "loop_progress", "node_id": node_id,
                        "iteration": i + 1, "total": len(docs),
                        "detail": "classify",
                    }

                    # Step 2: determine which branch
                    matched_branch = None
                    classify_lower = classify_result.lower()
                    for bname in branch_names:
                        if bname.lower() in classify_lower:
                            matched_branch = bname
                            break

                    if not matched_branch:
                        # Check for default/else branch
                        for bname in branch_names:
                            if bname.lower() in ("прочее", "else", "другое", "*"):
                                matched_branch = bname
                                break

                    yield {
                        "type": "loop_branch", "node_id": node_id,
                        "iteration": i + 1, "branch": matched_branch or "—",
                        "detail": f"doc {i+1} → {matched_branch or 'no match'}",
                    }

                    # Step 3: run branch-specific prompt if it exists
                    branch_prompt_template = branch_prompts.get(matched_branch or "", "")
                    if branch_prompt_template and matched_branch:
                        branch_context = (
                            f"Документ:\n{doc_part}\n\n"
                            f"Результат классификации:\n{classify_result}"
                        )
                        full_branch_prompt = f"{branch_prompt_template}\n\n{branch_context}"
                        branch_result = await _async_chat_completion([
                            {"role": "user", "content": full_branch_prompt}
                        ])
                        branch_results[matched_branch].append(
                            f"Документ {i + 1}:\n{branch_result}"
                        )
                        all_results.append(
                            f"[{matched_branch}] Документ {i + 1}:\n{branch_result}"
                        )
                        yield {
                            "type": "loop_progress", "node_id": node_id,
                            "iteration": i + 1, "total": len(docs),
                            "detail": f"branch:{matched_branch}",
                        }
                    else:
                        # No branch prompt — just store classification result
                        if matched_branch:
                            branch_results[matched_branch].append(
                                f"Документ {i + 1}:\n{classify_result}"
                            )
                        all_results.append(
                            f"[{matched_branch or 'НЕИЗВЕСТНЫЙ'}] Документ {i + 1}:\n{classify_result}"
                        )

                    if i < len(docs) - 1:
                        await asyncio.sleep(1)

                # Build structured output
                output_parts = []
                for bname in branch_names:
                    items = branch_results.get(bname, [])
                    if items:
                        output_parts.append(f"=== {bname} ({len(items)} документов) ===\n" + "\n\n".join(items))
                output = "\n\n".join(output_parts) if output_parts else "\n\n".join(all_results)

            elif node_type == "condition":
                # Condition node: ask GigaChat to pick a branch
                prompt = _build_prompt(node, input_data)
                raw_answer = await _async_chat_completion([
                    {"role": "user", "content": prompt}
                ])
                chosen_branch = raw_answer.strip().strip('"').strip("'").strip('.')

                # Find which outgoing edges match the chosen branch
                outgoing = successors.get(node_id, [])
                chosen_targets: set[str] = set()
                unchosen_targets: set[str] = set()

                for target_id in outgoing:
                    edge_data = edge_map.get((node_id, target_id), {})
                    edge_label = (edge_data.get("label", "") or "").strip()

                    if edge_label and chosen_branch.lower().find(edge_label.lower()) != -1:
                        chosen_targets.add(target_id)
                    elif edge_label.lower() in ("else", "прочее", "другое", "иначе", "*"):
                        # Wildcard/else branch — chosen only if nothing else matches
                        pass
                    elif edge_label:
                        unchosen_targets.add(target_id)

                # If no specific match, look for else/wildcard branch
                if not chosen_targets:
                    for target_id in outgoing:
                        edge_data = edge_map.get((node_id, target_id), {})
                        edge_label = (edge_data.get("label", "") or "").strip().lower()
                        if edge_label in ("else", "прочее", "другое", "иначе", "*"):
                            chosen_targets.add(target_id)
                        elif not edge_data.get("label"):
                            # Unlabeled edge = default
                            chosen_targets.add(target_id)

                # Mark only nodes that are reachable ONLY from unchosen branches.
                # Merge-nodes (reachable from both chosen and unchosen) are NOT skipped.
                skipped_nodes |= _get_skip_set(
                    unchosen_targets - chosen_targets,
                    chosen_targets,
                    dict(successors),
                )

                output = f"Выбрана ветка: {chosen_branch}"

                yield {
                    "type": "condition_result", "node_id": node_id,
                    "chosen_branch": chosen_branch,
                    "node_label": node_label,
                }

            elif node_type == "switch":
                # Switch node: route based on rules WITHOUT calling GigaChat
                config = node.get("data", {})
                mode = config.get("mode", "all")  # "first" or "all"
                rules_raw = config.get("rules", "[]")
                try:
                    import json as _json
                    rules = _json.loads(rules_raw) if isinstance(rules_raw, str) else rules_raw
                except Exception:
                    rules = []

                # Detect structured loop output (classify_strict mode)
                # Format: <<<DOC_N|CLASS:X>>> ... <<<END_DOC_N>>>
                classified = parse_classified_docs(previous_output)
                use_doc_filtering = len(classified) > 0

                # Evaluate rules — match against classes if structured, else against text
                matched_labels: list[str] = []
                if use_doc_filtering:
                    # Collect distinct classes from classified docs
                    doc_classes = {cls.lower() for _, cls, _ in classified}
                    for rule in rules:
                        value = (rule.get("value", "") or "").strip().lower()
                        label = rule.get("label", value)
                        # Match if any classified doc has this class
                        if any(value in cls or cls in value for cls in doc_classes):
                            matched_labels.append(label)
                            if mode == "first":
                                break
                else:
                    text_to_match = previous_output.lower()
                    for rule in rules:
                        value = (rule.get("value", "") or "").strip().lower()
                        operator = rule.get("operator", "contains")
                        label = rule.get("label", value)

                        match = False
                        if operator == "equals" and text_to_match.strip() == value:
                            match = True
                        elif operator == "contains" and value in text_to_match:
                            match = True
                        elif operator == "startswith" and text_to_match.strip().startswith(value):
                            match = True

                        if match:
                            matched_labels.append(label)
                            if mode == "first":
                                break

                # Route edges
                outgoing = successors.get(node_id, [])
                chosen_targets: set[str] = set()
                unchosen_targets: set[str] = set()

                matched_lower = {m.lower() for m in matched_labels}
                # Map: chosen target_id → its edge_label (used for doc filtering)
                target_label_map: dict[str, str] = {}
                for target_id in outgoing:
                    edge_data = edge_map.get((node_id, target_id), {})
                    edge_label = (edge_data.get("label", "") or "").strip()

                    if edge_label.lower() in matched_lower:
                        chosen_targets.add(target_id)
                        target_label_map[target_id] = edge_label
                    elif edge_label.lower() in ("else", "прочее", "другое", "иначе", "*", "default"):
                        pass  # handle below
                    elif edge_label:
                        unchosen_targets.add(target_id)

                if not chosen_targets:
                    for target_id in outgoing:
                        edge_data = edge_map.get((node_id, target_id), {})
                        edge_label = (edge_data.get("label", "") or "").strip().lower()
                        if edge_label in ("else", "прочее", "другое", "иначе", "*", "default") or not edge_label:
                            chosen_targets.add(target_id)
                            target_label_map[target_id] = edge_label or "default"

                # Skip only nodes reachable ONLY from unchosen branches.
                skipped_nodes |= _get_skip_set(
                    unchosen_targets - chosen_targets,
                    chosen_targets,
                    dict(successors),
                )

                # If structured input — populate branch_docs_override per chosen target
                # so each branch sees ONLY its matching original documents
                if use_doc_filtering:
                    for target_id in chosen_targets:
                        edge_label = target_label_map.get(target_id, "")
                        # Find rule labels matching this edge — collect their values
                        allowed_classes: set[str] = set()
                        for rule in rules:
                            r_label = (rule.get("label", "") or "").strip()
                            if r_label.lower() == edge_label.lower():
                                allowed_classes.add((rule.get("value", "") or "").strip())
                        if not allowed_classes:
                            allowed_classes.add(edge_label)  # fallback
                        filtered = build_filtered_documents(classified, allowed_classes)
                        if filtered:
                            branch_docs_override[target_id] = filtered

                output = f"Switch → {', '.join(matched_labels) if matched_labels else 'default'}"
                if use_doc_filtering:
                    output += f"\n[фильтрация документов: {len(classified)} классифицировано → ветки получат только свои]"
                yield {
                    "type": "switch_result", "node_id": node_id,
                    "matched_rule": ', '.join(matched_labels) if matched_labels else 'default',
                    "node_label": node_label,
                }

            elif node_type == "if_node":
                # If node: binary routing (true/false) WITHOUT calling GigaChat
                config = node.get("data", {})
                field = config.get("field", "").strip()
                operator = config.get("operator", "contains")
                compare_value = config.get("value", "").strip()

                text_to_check = previous_output
                # If field specified, try to extract it from structured output
                if field:
                    for line in previous_output.split("\n"):
                        if field.lower() in line.lower():
                            text_to_check = line
                            break

                text_lower = text_to_check.lower()
                compare_lower = compare_value.lower()

                # Evaluate condition
                if operator == "contains":
                    condition_met = compare_lower in text_lower
                elif operator == "not_contains":
                    condition_met = compare_lower not in text_lower
                elif operator == "equals":
                    condition_met = text_lower.strip() == compare_lower
                elif operator == "greater_than":
                    try:
                        # Extract numbers from text
                        import re
                        nums = re.findall(r'[\d\s]+[,.]?\d*', text_to_check.replace(' ', ''))
                        val = float(nums[0].replace(',', '.').replace(' ', '')) if nums else 0
                        threshold = float(compare_value.replace(',', '.').replace(' ', ''))
                        condition_met = val > threshold
                    except Exception:
                        condition_met = False
                elif operator == "less_than":
                    try:
                        import re
                        nums = re.findall(r'[\d\s]+[,.]?\d*', text_to_check.replace(' ', ''))
                        val = float(nums[0].replace(',', '.').replace(' ', '')) if nums else 0
                        threshold = float(compare_value.replace(',', '.').replace(' ', ''))
                        condition_met = val < threshold
                    except Exception:
                        condition_met = False
                else:
                    condition_met = compare_lower in text_lower

                # Route: edges labeled "true"/"да" go one way, "false"/"нет" go other.
                # Collect chosen vs unchosen and use _get_skip_set so merge nodes survive.
                outgoing = successors.get(node_id, [])
                if_chosen: set[str] = set()
                if_unchosen: set[str] = set()
                for target_id in outgoing:
                    edge_data = edge_map.get((node_id, target_id), {})
                    edge_label = (edge_data.get("label", "") or "").strip().lower()
                    is_true_branch = edge_label in ("true", "да", "истина", "yes")
                    is_false_branch = edge_label in ("false", "нет", "ложь", "no")

                    if is_true_branch:
                        (if_chosen if condition_met else if_unchosen).add(target_id)
                    elif is_false_branch:
                        (if_unchosen if condition_met else if_chosen).add(target_id)
                    else:
                        # Unlabeled edge — always taken
                        if_chosen.add(target_id)

                skipped_nodes |= _get_skip_set(if_unchosen, if_chosen, dict(successors))

                branch_name = "true" if condition_met else "false"
                output = f"If ({field} {operator} {compare_value}) → {branch_name}"
                yield {
                    "type": "if_result", "node_id": node_id,
                    "condition_met": condition_met,
                    "branch": branch_name,
                    "node_label": node_label,
                }

            else:
                prompt = _build_prompt(node, input_data)
                output = await _async_chat_completion([
                    {"role": "user", "content": prompt}
                ])

            step.status = "completed"
            step.input_data = input_data
            step.output_data = {"result": output}
            if node_type == "loop":
                step.prompt_used = "(loop — see iterations)"
            elif node_type == "loop_subgraph":
                step.prompt_used = "(loop_subgraph — multiple prompts per iteration)"
            elif node_type in ("switch", "if_node"):
                step.prompt_used = None
            else:
                step.prompt_used = prompt if isinstance(prompt, str) else None
            step.completed_at = datetime.utcnow()
            node_outputs[node_id] = output

            yield {"type": "node_status", "node_id": node_id, "node_label": node_label, "node_type": node_type, "status": "completed", "step": node_index, "total": total_nodes}

            # Emit full step data for live debugging
            yield {
                "type": "step_complete",
                "step_id": step.id,
                "node_id": node_id,
                "node_label": node_label,
                "node_type": node_type,
                "input_data": input_data,
                "output_data": {"result": output},
                "prompt_used": step.prompt_used,
                "step_index": node_index,
                "total_steps": total_nodes,
            }

            # Pause if step mode is enabled
            if run.id in _step_mode_runs:
                yield {
                    "type": "step_paused",
                    "node_id": node_id,
                    "node_label": node_label,
                    "step_index": node_index,
                    "total_steps": total_nodes,
                }
                pause_ev = _pause_events.get(run.id)
                if pause_ev:
                    pause_ev.clear()
                    await pause_ev.wait()

        except Exception as e:
            logger.exception("Node %s failed", node_id)
            step.status = "failed"
            step.output_data = {"error": str(e)}
            step.completed_at = datetime.utcnow()
            node_outputs[node_id] = ""

            yield {"type": "node_status", "node_id": node_id, "node_label": node_label, "node_type": node_type, "status": "failed", "step": node_index, "total": total_nodes, "error": str(e)}

            run.status = "failed"
            await db.commit()
            yield {"type": "status", "run_id": run.id, "status": "failed"}
            cleanup_run(run.id)
            return

        await db.commit()

    # Find output node result
    output_nodes = [n for n in nodes if n.get("type") == "output"]
    final_result = ""
    if output_nodes:
        for on in output_nodes:
            r = node_outputs.get(on["id"], "")
            if r:
                final_result = r
                break
    if not final_result and sorted_ids:
        final_result = node_outputs.get(sorted_ids[-1], "")

    run.status = "completed"
    run.result = {"output": final_result}
    run.completed_at = datetime.utcnow()
    await db.commit()

    yield {"type": "status", "run_id": run.id, "status": "completed", "result": final_result}
    cleanup_run(run.id)
