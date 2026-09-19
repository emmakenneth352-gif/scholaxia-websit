"""
Sia AI Service
--------------
Raw DeepSeek passthrough for all student features.
Decision: no system prompts, no persona stack, no prompt templates, no output
rewriting — each feature sends the student's text to the model as-is and
returns the reply untouched (minus output sanitisation for child safety).
"""

from app.ai.model_backend import run_inference
from app.ai.weakness_analyzer import record_interaction, get_weak_topics

SIA_MAX_TOKENS = 8192


async def _run_sia_inference(
    prompt: str,
    conversation_history: list = None,
    max_tokens: int = None,
) -> str:
    """Run inference in RAW mode — the model answers purely on its own."""
    return await run_inference(
        prompt,
        conversation_history=conversation_history,
        system_prompt="",
        max_tokens=max_tokens or SIA_MAX_TOKENS,
        temperature=None,
    )


async def get_ai_response(question: str, subject: str, education_level: str,
                          language: str, student_id: str, student_name: str = "there",
                          conversation_history: list = None,
                          tutor_mode: str = "smart") -> str:
    try:
        raw = await _run_sia_inference(
            question,
            conversation_history=conversation_history,
        )
    except RuntimeError as e:
        return (
            f"Sia is temporarily unavailable ({str(e)[:120]}). "
            f"Please try again shortly, {student_name}."
        )
    except Exception as e:
        if "429" in str(e) or "rate limit" in str(e).lower():
            return f"I'm getting too many requests right now, {student_name}. Please wait a moment and try again."
        return (
            f"I couldn't think that through properly, {student_name}. "
            "Please rephrase your question or try again in a moment."
        )
    answer = raw.strip()
    await record_interaction(student_id=student_id, subject=subject, question=question, answer=answer)
    return answer


async def sia_explain(topic: str, subject: str, education_level: str,
                      language: str, student_id: str, student_name: str) -> str:
    return (await _run_sia_inference(topic))


async def sia_solve(question: str, subject: str, education_level: str,
                    language: str, student_id: str, student_name: str) -> str:
    try:
        raw = await _run_sia_inference(question)
    except Exception as e:
        if "429" in str(e) or "rate limit" in str(e).lower():
            return f"Too many requests right now, {student_name}. Please wait a moment and try again."
        raise
    answer = raw.strip()
    await record_interaction(student_id=student_id, subject=subject, question=question, answer=answer)
    return answer


async def sia_evaluate(question: str, student_answer: str, subject: str,
                       education_level: str, language: str, student_id: str, student_name: str) -> str:
    evaluate_ask = (
        f"Question: {question}\n\nStudent's answer: {student_answer}\n\n"
        "Mark this student answer: say whether it is correct, give the mark, "
        "and explain any mistakes."
    )
    return (await _run_sia_inference(evaluate_ask))


async def sia_generate_questions(topic: str, number: int, subject: str, education_level: str,
                                  language: str, student_name: str, curriculum: str = "WAEC",
                                  student_id: str = "") -> str:
    questions_ask = (
        f"Generate {number} practice questions on the topic: {topic} "
        f"({curriculum} standard). Include answers."
    )
    return (await _run_sia_inference(questions_ask))


async def sia_performance_feedback(weak_topics: list, subject: str, education_level: str,
                                    language: str, student_id: str, student_name: str,
                                    score: float = None) -> str:
    feedback_ask = (
        f"A student is weak in these topics: {', '.join(str(t) for t in weak_topics)}. "
        "Give short motivating feedback and what to practise next."
    )
    return (await _run_sia_inference(feedback_ask))


async def sia_explain_wrong_answer(question: str, wrong_answer: str, correct_answer: str,
                                    subject: str, education_level: str, language: str,
                                    student_name: str, student_id: str = "") -> str:
    wrong_ask = (
        f"Question: {question}\nStudent answered: {wrong_answer}\n"
        f"Correct answer: {correct_answer}\n\n"
        "Explain why the student's answer is wrong and how to get it right."
    )
    return (await _run_sia_inference(wrong_ask))


async def sia_lesson(topic: str, subject: str, education_level: str, language: str,
                     student_id: str, student_name: str, curriculum: str,
                     step: int = 1, previous_response: str = "") -> str:
    lesson_ask = (
        f"Teach the topic: {topic} ({curriculum} standard)."
        + (f"\n\nContinue from this previous lesson part:\n{previous_response}" if previous_response else "")
    )
    return (await _run_sia_inference(lesson_ask))


async def sia_anti_cheat(question: str, submitted_answer: str,
                          subject: str, student_name: str) -> str:
    cheat_ask = (
        f"Question: {question}\nStudent submitted: {submitted_answer}\n\n"
        "Is this answer original work or copied/cheated? Answer briefly."
    )
    return (await _run_sia_inference(cheat_ask))


async def sia_debate(topic: str, student_position: str,
                     subject: str, student_name: str) -> str:
    debate_ask = (
        f"Topic: {topic}\nStudent's position: {student_position}\n\n"
        "Debate this with the student — challenge their points respectfully."
    )
    return (await _run_sia_inference(debate_ask))


async def sia_study_companion(student_name: str, last_subject: str,
                               last_topic: str, days_inactive: int) -> str:
    companion_ask = (
        f"A student named {student_name} has been away for {days_inactive} days. "
        f"They last studied {last_subject} ({last_topic}). Write a short welcome-back nudge."
    )
    return (await _run_sia_inference(companion_ask))


async def sia_process_pdf(pdf_content: str, output_type: str, subject: str,
                           education_level: str, curriculum: str, exam_standard: str,
                           student_name: str, language: str = "english") -> str:
    pdf_ask = (
        f"Study this document and help with it ({output_type}):\n\n{pdf_content}"
    )
    return (await _run_sia_inference(pdf_ask))


async def sia_language_immersion(target_language: str, student_message: str,
                                  student_name: str, student_level: str = "beginner",
                                  approach: str = "bilingual") -> str:
    immerse_ask = (
        f"Reply to this message in {target_language} (student is {student_level}): "
        f"{student_message}"
    )
    return (await _run_sia_inference(immerse_ask))


async def sia_generate_study_plan(student_name: str, level: str, exam_target: str,
                                   student_id: str, hours_per_day: float,
                                   days_until_exam: int) -> str:
    weak = await get_weak_topics(student_id)
    weak_names = (
        ", ".join(str(k) for k in weak.keys())
        if isinstance(weak, dict) and weak
        else "not recorded"
    )
    plan_ask = (
        f"Create a study plan for a {level} student targeting {exam_target}. "
        f"Weak subjects: {weak_names}. Study time: {hours_per_day} h/day, "
        f"{days_until_exam} days until the exam."
    )
    return (await _run_sia_inference(plan_ask))


async def sia_cambridge_teach(topic: str, subject: str, education_level: str,
                               student_id: str, student_name: str) -> str:
    return (await _run_sia_inference(topic))


async def sia_parent_report(student_name: str, level: str, profile_data: dict) -> str:
    report_ask = (
        f"Write a short parent report for {student_name} ({level}). "
        f"Sessions: {profile_data.get('total_ai_sessions', 0)}, "
        f"study minutes: {profile_data.get('total_study_minutes', 0)}, "
        f"streak: {profile_data.get('streak_days', 0)} days, "
        f"average score: {profile_data.get('avg_score', 0.0)}."
    )
    return (await _run_sia_inference(report_ask))
