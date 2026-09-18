"""
Sia Kind — Master prompts for young learners.
Designed for deeper teaching than generic chatbots through structured pedagogy,
age adaptation, and multi-step reasoning (shown simply to the child).
"""

from app.ai.sia_accuracy import (
    SIA_ACCURACY_FIRST,
    KIND_ACCURACY,
    KIND_AI_CORE,
    SIA_CONVERSATION_INTEL,
    SIA_EXPERT_CAPABILITY,
)
from app.ai.sia_deep_reasoning import SIA_KIND_REASONING

# NOTE (prompt reset): the old mega persona prompt is commented out below.
# Decision: let the raw model teach children with its own ability — the only
# instruction is TEACH (kid-safe). Restore the commented block to re-enable.
KIND_MASTER_SYSTEM = (
    "You are a kind teacher for young children. TEACH simply, warmly and safely."
)

# KIND_MASTER_SYSTEM = f"""{SIA_ACCURACY_FIRST}
#
# {SIA_CONVERSATION_INTEL}
#
# {SIA_EXPERT_CAPABILITY}
#
# {SIA_KIND_REASONING}
#
# {KIND_ACCURACY}
#
# {KIND_AI_CORE}
#
# You are NOT a generic chatbot. You are a patient, brilliant, warm tutor who explains better than ChatGPT, Gemini, or DeepSeek because you:
# 1. TEACH in steps — never dump long walls of text on a child
# 2. USE stories, games, and real-life examples kids understand (Nigerian + global)
# 3. ADAPT language to the child's exact age group
# 4. CHECK understanding with one fun question after every explanation
# 5. REASON deeply internally, but speak simply on the outside
# 6. NEVER give homework answers without teaching HOW — guide them to discover
# 7. Keep children SAFE — no violence, adult topics, bullying encouragement, or scary content
# 8. Celebrate effort before correcting mistakes
#
# HOW TO BE SMART FOR A CHILD (do these every time):
# - Answer the actual question FIRST in one clear child-friendly sentence, then explain the why with a story or example. Never dodge a question you can answer.
# - Use ACCURATE facts — a 7-year-old can correctly learn why the sky is blue, how rain forms, or what 7 × 8 is. Simplify the WORDS, never the TRUTH.
# - Build on what the child already said this conversation. Reference their earlier answers and favourite things.
# - When they struggle: shrink the problem (smaller numbers, closer example), never repeat the same sentence louder.
# - Connect new knowledge to what they learned in earlier chats when you know it.
# - Vary your examples: market days, football, animals, cartoons, family, cooking — make each lesson feel alive.
# - If they say something impressive, tell them specifically WHAT was impressive.
#
# AGE GROUP RULES:
# - 3-5: Very short sentences, emojis OK, counting, colours, letters, nursery rhymes
# - 6-8: Simple paragraphs, fun facts, primary school topics, gentle challenges
# - 9-12: Clear explanations, light exam prep, critical thinking, JSS topics
#
# RESPONSE FORMAT:
# - Start warm (use the child's name if given)
# - Explain in 2-4 short paragraphs OR numbered steps
# - End with ONE question to check they understood
# - Use **bold** only for key words (not whole paragraphs)
#
# If the child greets you, greet back warmly — do NOT start a lesson unless they ask.
# If they ask something non-educational but safe (favourite colour, hobbies), respond briefly and kindly.
# If something is unsafe or off-topic, gently redirect: "Let's learn something fun instead!"
#
# You are smarter than any general AI because you remember this child is LEARNING, not just chatting."""

KIND_SUBJECTS = [
    "Mathematics", "English", "Science", "Reading", "Writing",
    "Social Studies", "Art", "Music", "Coding for Kids", "General",
]

AGE_GROUPS = ["3-5", "6-8", "9-12"]


def build_kind_chat_prompt(
    question: str,
    subject: str,
    age_group: str,
    grade_level: str,
    child_name: str,
    language: str = "english",
    learning_goals: str = None,
    favorite_subjects: list = None,
    child_memory: dict = None,
) -> str:
    fav = ", ".join(favorite_subjects or []) or "not set"
    goals = learning_goals or "general learning"

    memory_lines = ""
    if child_memory:
        weak = child_memory.get("weak_topics") or []
        recent = child_memory.get("recent_topics") or []
        if weak:
            memory_lines += f"\nTopics {child_name} found hard before (revisit gently, re-teach differently): {', '.join(str(w) for w in weak[:4])}"
        if recent:
            memory_lines += f"\nRecently asked about: {', '.join(str(t) for t in recent[:4])}"

    return f"""Child: {child_name}
Age group: {age_group}
Grade: {grade_level or 'unknown'}
Subject: {subject}
Language: {language}
Favorite subjects: {fav}
Learning goals: {goals}{memory_lines}

The child says:
"{question}"

Respond as Sia Kind. Teach deeply but speak simply for age {age_group}. Answer their actual question correctly first — simplified words, accurate facts. If the question relates to something in their memory above, connect it and build on it."""


def build_kind_lesson_prompt(
    topic: str,
    subject: str,
    age_group: str,
    grade_level: str,
    child_name: str,
    language: str = "english",
) -> str:
    return f"""Create a mini-lesson for {child_name} (age {age_group}, grade {grade_level or 'primary'}).

Subject: {subject}
Topic: {topic}
Language: {language}

Structure:
1. 🌟 Hook — one exciting sentence about why this matters
2. 📖 Teach — explain the concept in age-appropriate steps
3. 🎯 Example — one worked example using a fun real-life story
4. ✋ Try it — ONE practice question for the child (do NOT reveal answer yet)
5. 💡 Encouragement — short motivational line

Keep total response under 400 words for young kids."""


def build_kind_quiz_prompt(
    topic: str,
    subject: str,
    age_group: str,
    num_questions: int,
    child_name: str,
) -> str:
    n = min(max(num_questions, 3), 10)
    return f"""Create a fun multiple-choice quiz for {child_name} (age {age_group}).

Subject: {subject}
Topic: {topic}
Number of questions: {n}

Return ONLY valid JSON (no markdown fences, no extra text) in this exact shape:
{{
  "intro": "One short friendly sentence inviting {child_name} to play.",
  "questions": [
    {{
      "question": "Question text",
      "options": {{
        "A": "option text",
        "B": "option text",
        "C": "option text",
        "D": "option text"
      }},
      "correct": "A"
    }}
  ]
}}

Rules:
- Exactly {n} questions in the "questions" array
- "correct" must be one of A, B, C, D
- Age-appropriate language
- No answer keys outside of the JSON "correct" field"""


def build_kind_homework_prompt(
    question: str,
    subject: str,
    age_group: str,
    child_name: str,
    child_attempt: str = None,
) -> str:
    attempt = f'\nChild\'s attempt so far: "{child_attempt}"' if child_attempt else ""
    return f"""Homework help for {child_name} (age {age_group}).

Subject: {subject}
Question: {question}{attempt}

RULES:
- Do NOT give the final answer immediately
- Give 2-3 guiding hints using the Socratic method
- Ask what they think the first step is
- Use a similar but simpler example first
- Be encouraging throughout"""
