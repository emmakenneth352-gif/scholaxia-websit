const API = "https://scholaxia1.onrender.com";
const token = localStorage.getItem("sia_token") || "";

let examType = "";
let selectedSubjects = [];
let subjectLimit = 4;
let allSubjects = [];

const LIMITS = { JAMB: 4, WAEC: 9, NECO: 9, JUNIOR_WAEC: 9 };

// BECE subjects for Junior WAEC (matches backend JUNIOR_WAEC_SUBJECTS)
const JUNIOR_WAEC_SUBJECTS = [
  "English Studies",
  "Mathematics",
  "Basic Science",
  "Basic Technology",
  "Social Studies",
  "Business Studies",
  "Civic Education",
  "Computer Studies/ICT",
  "Agricultural Science",
];

window.onload = async () => {
  if (!token) { window.location.href = "auth.html"; return; }
  try {
    const status = await fetch(`${API}/api/v1/students/setup-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status.ok) {
      const data = await status.json();
      if (data.setup_complete) {
        window.location.href = "home.html";
        return;
      }
    }
  } catch {}

  try {
    const res = await fetch(`${API}/api/v1/students/subjects`);
    const data = await res.json();
    allSubjects = data.subjects || [];
  } catch {
    allSubjects = [
      "Mathematics", "English Language", "Biology", "Chemistry", "Physics",
      "Economics", "Government", "Geography", "Literature",
    ];
  }
};

function selectExamType(type) {
  examType = type;
  subjectLimit = LIMITS[type] || 9;
  selectedSubjects = [];
  document.querySelectorAll(".type-card").forEach(c => {
    c.classList.toggle("selected", c.dataset.type === type);
  });

  const hint = document.getElementById("subject-hint");
  if (type === "JAMB") {
    hint.textContent = "Pick exactly 4 subjects for JAMB.";
  } else if (type === "JUNIOR_WAEC") {
    hint.textContent = "Pick up to 9 BECE subjects for Junior WAEC. Set your level to JSS3 below.";
    const lvl = document.getElementById("education-level");
    if (lvl) lvl.value = "JSS3";
  } else {
    hint.textContent = `Pick up to ${subjectLimit} subjects for ${type}.`;
  }

  renderSubjects();
  document.getElementById("step-type").classList.remove("active");
  document.getElementById("step-subjects").classList.add("active");
  updateCount();
}

function goToType() {
  document.getElementById("step-subjects").classList.remove("active");
  document.getElementById("step-type").classList.add("active");
  document.getElementById("setup-error").textContent = "";
}

function renderSubjects() {
  const grid = document.getElementById("subject-grid");
  const pool = examType === "JUNIOR_WAEC" ? JUNIOR_WAEC_SUBJECTS : allSubjects;
  grid.innerHTML = pool.map(s => `
    <button type="button" class="subject-chip" data-subject="${escAttr(s)}" onclick="toggleSubject('${escAttr(s)}')">
      ${escHtml(s)}
    </button>
  `).join("");
}

function toggleSubject(subject) {
  const idx = selectedSubjects.indexOf(subject);
  if (idx >= 0) {
    selectedSubjects.splice(idx, 1);
  } else {
    if (selectedSubjects.length >= subjectLimit) {
      document.getElementById("setup-error").textContent =
        examType === "JAMB"
          ? "JAMB allows exactly 4 subjects. Deselect one first."
          : `Maximum ${subjectLimit} subjects allowed.`;
      return;
    }
    selectedSubjects.push(subject);
  }
  document.getElementById("setup-error").textContent = "";
  document.querySelectorAll(".subject-chip").forEach(chip => {
    chip.classList.toggle("selected", selectedSubjects.includes(chip.dataset.subject));
  });
  updateCount();
}

function updateCount() {
  const el = document.getElementById("subject-count");
  if (examType === "JAMB") {
    el.textContent = `${selectedSubjects.length} / 4 selected`;
  } else {
    el.textContent = `${selectedSubjects.length} / ${subjectLimit} selected`;
  }
}

async function saveSetup() {
  const err = document.getElementById("setup-error");
  const btn = document.getElementById("btn-save");
  err.textContent = "";

  if (examType === "JAMB" && selectedSubjects.length !== 4) {
    err.textContent = "Please select exactly 4 subjects for JAMB.";
    return;
  }
  if (examType === "JUNIOR_WAEC") {
    const lvl = document.getElementById("education-level").value;
    if (!lvl.startsWith("JSS")) {
      err.textContent = "Junior WAEC is for JSS students — pick a JSS level.";
      return;
    }
    if (!selectedSubjects.length) {
      err.textContent = "Select at least one BECE subject.";
      return;
    }
  }
  if (!selectedSubjects.length) {
    err.textContent = "Select at least one subject.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const res = await fetch(`${API}/api/v1/students/setup-exam`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        exam_type: examType,
        subjects: selectedSubjects,
        education_level: document.getElementById("education-level").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.detail || "Setup failed.";
      return;
    }
    localStorage.setItem("sia_exam_type", examType);
    localStorage.setItem("sia_subjects", JSON.stringify(selectedSubjects));
    window.location.href = "home.html";
  } catch {
    err.textContent = "Network error. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Continue to Scholaxia";
  }
}

function escHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
