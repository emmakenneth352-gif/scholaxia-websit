"""
Sia Kind AI Service — raw DeepSeek passthrough for young learners.
Decision: no system prompt, no preamble wrapper — send the child's message to
DeepSeek as-is and return its reply untouched (minus output sanitisation).
"""

from app.ai.model_backend import run_inference
from app.ai.safety_filter import sanitize_output


async def _get_child_memory(user_id: str, subject: str) -> dict:
    """Child learning memory for prompt injection (same store as student Sia)."""
    try:
        from app.ai.weakness_analyzer import get_weak_topics, get_student_history
        from app.ai.sia_intelligence import extract_recent_topics

        weak = await get_weak_topics(user_id)
        history = await get_student_history(user_id)
        weak_list = weak.get(subject, []) if isinstance(weak, dict) else []
        return {
            "weak_topics": weak_list[:4],
            "recent_topics": extract_recent_topics(history, subject),
        }
    except Exception:
        return {}


async def kind_chat(
    question: str,
    subject: str,
    user_id: str,
    child_name: str,
    age_group: str = "6-8",
    grade_level: str = None,
    language: str = "english",
    learning_goals: str = None,
    favorite_subjects: list = None,
    conversation_history: list = None,
) -> str:
    try:
        raw = await run_inference(
            question,
            conversation_history=conversation_history,
            system_prompt="",
            max_tokens=4096,
            temperature=None,
        )
    except RuntimeError as e:
        return f"Sia Kind needs a moment — {str(e)[:100]}. Try again soon!"
    except Exception:
        return (
            f"Sorry {child_name}, I couldn't answer that properly. "
            "Can you ask again in different words?"
        )
    return sanitize_output(raw)


async def kind_lesson(
    topic: str,
    subject: str,
    user_id: str,
    child_name: str,
    age_group: str = "6-8",
    grade_level: str = None,
    language: str = "english",
) -> str:
    raw = await run_inference(topic, system_prompt="", max_tokens=4096, temperature=None)
    answer = sanitize_output(raw)
    return answer


async def kind_quiz(
    topic: str,
    subject: str,
    child_name: str,
    age_group: str = "6-8",
    num_questions: int = 5,
) -> dict:
    """Return structured quiz for the interactive Kids Learn & Play UI."""
    import json
    import re

    n = min(max(num_questions, 3), 10)
    quiz_instruction = (
        f"Create a fun multiple-choice quiz for {child_name} (age {age_group}) "
        f"on the topic: {topic}. Return ONLY valid JSON in this exact shape: "
        '{"intro": "One short friendly sentence.", "questions": [{"question": "...", '
        '"options": {"A": "...", "B": "...", "C": "...", "D": "..."}, "correct": "A"}]}. '
        f"Exactly {n} questions. No markdown fences, no extra text."
    )
    raw = await run_inference(
        quiz_instruction, system_prompt="", max_tokens=3000, temperature=None
    )
    text = sanitize_output(raw or "")

    questions: list[dict] = []
    intro = ""

    # Prefer JSON payload from the model.
    json_block = text
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    if fence:
        json_block = fence.group(1).strip()
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            json_block = text[start : end + 1]

    try:
        data = json.loads(json_block)
        intro = str(data.get("intro") or "").strip()
        raw_qs = data.get("questions") or []
        if isinstance(raw_qs, list):
            for i, q in enumerate(raw_qs):
                if not isinstance(q, dict):
                    continue
                opts = q.get("options") or {}
                if isinstance(opts, list) and len(opts) >= 4:
                    opts = {
                        "A": str(opts[0]),
                        "B": str(opts[1]),
                        "C": str(opts[2]),
                        "D": str(opts[3]),
                    }
                if not isinstance(opts, dict):
                    continue
                option_map = {
                    "A": str(opts.get("A") or opts.get("a") or "").strip(),
                    "B": str(opts.get("B") or opts.get("b") or "").strip(),
                    "C": str(opts.get("C") or opts.get("c") or "").strip(),
                    "D": str(opts.get("D") or opts.get("d") or "").strip(),
                }
                if not all(option_map.values()):
                    continue
                correct = str(q.get("correct") or "A").strip().upper()[:1]
                if correct not in option_map:
                    correct = "A"
                questions.append(
                    {
                        "id": str(q.get("id") or i + 1),
                        "question": str(q.get("question") or q.get("prompt") or "").strip(),
                        "options": option_map,
                        "correct": correct,
                    }
                )
    except Exception:
        questions = []

    # Fallback: parse classic Q1 / A) B) C) D) text quizzes.
    if not questions:
        blocks = re.split(r"(?=\n?\s*Q\d+[\.\)\:])", text)
        for block in blocks:
            qm = re.search(
                r"Q(\d+)[\.\)\:]\s*(.+?)(?=\n\s*[A-D][\.\)])",
                block,
                re.S | re.I,
            )
            if not qm:
                continue
            opts = {}
            for letter in "ABCD":
                om = re.search(
                    rf"{letter}[\.\)]\s*(.+?)(?=\n\s*[A-D][\.\)]|\n\s*Q\d+|\Z)",
                    block,
                    re.S | re.I,
                )
                if om:
                    opts[letter] = om.group(1).strip()
            if len(opts) >= 2:
                questions.append(
                    {
                        "id": qm.group(1),
                        "question": qm.group(2).strip(),
                        "options": {
                            "A": opts.get("A", ""),
                            "B": opts.get("B", ""),
                            "C": opts.get("C", ""),
                            "D": opts.get("D", ""),
                        },
                        "correct": "",  # unknown — app will ask Sia to check
                    }
                )

    if not intro and questions:
        intro = f"Hi {child_name}! Tap an answer for each question. Good luck!"

    return {
        "intro": intro or text,
        "questions": questions,
        "sia_kind": text,
        "topic": topic,
        "num_questions": len(questions) or num_questions,
    }



async def kind_homework_help(
    question: str,
    subject: str,
    user_id: str,
    child_name: str,
    age_group: str = "6-8",
    child_attempt: str = None,
) -> str:
    raw = await run_inference(question, system_prompt="", max_tokens=2048, temperature=None)
    answer = sanitize_output(raw)
    return answer
