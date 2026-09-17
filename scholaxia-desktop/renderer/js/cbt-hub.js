/** CBT Practice hub — exam-type packages (JAMB / WAEC / NECO) via practice attempts. */

var cbtHubState = {
  home: null,
  view: "types", // types | board
  board: null,
  jambPicked: {},
  busy: false,
};

var DEFAULT_JAMB_SUBJECTS = [
  "Use of English", "Mathematics", "Physics", "Chemistry", "Biology",
  "Economics", "Government", "Literature in English", "Geography",
  "Christian Religious Studies", "Islamic Religious Studies", "Commerce", "Accounting",
];
var DEFAULT_SSCE_SUBJECTS = [
  "English Language", "Mathematics", "Biology", "Chemistry", "Physics",
  "Economics", "Government", "Literature in English", "Geography",
  "Agricultural Science", "Further Mathematics", "Commerce", "Financial Accounting",
];

function cbtEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function cbtAttemptToPack(attempt) {
  var allQuestions = [];
  var sections = [];
  (attempt.sections || []).forEach(function (sec) {
    var start = allQuestions.length;
    (sec.questions || []).forEach(function (q) {
      var row = {
        id: q.id,
        question_text: q.question_text || q.text || "",
        topic: q.topic,
        image_url: q.image_url,
      };
      (q.options || []).forEach(function (opt) {
        var k = String(opt.key || "").toUpperCase();
        if (k) row["option_" + k.toLowerCase()] = opt.text || "";
      });
      allQuestions.push(row);
    });
    sections.push({
      subject: sec.subject || "Subject",
      start: start,
      count: (sec.questions || []).length,
      completed: !!sec.completed,
    });
  });
  return {
    title: (attempt.exam_type || "CBT") + " Practice",
    subject: (attempt.subjects || []).join(" · "),
    duration_minutes: attempt.duration_minutes || 60,
    questions: allQuestions,
    sections: sections,
    practice_attempt_id: attempt.attempt_id,
    exam_type: attempt.exam_type,
    seconds_left: attempt.seconds_left,
    answers: attempt.answers || {},
    section_index: attempt.section_index || 0,
  };
}

async function loadCbtHubPage() {
  var grid = document.getElementById("cbt-grid");
  var tabsEl = document.getElementById("cbt-hub-tabs");
  var subjEl = document.getElementById("cbt-hub-subjects");
  if (!grid) return;
  if (typeof isCbtExamActive === "function" && isCbtExamActive()) return;
  if (typeof showCbtListView === "function") showCbtListView();
  if (tabsEl) {
    tabsEl.innerHTML = "";
    tabsEl.classList.add("hidden");
  }
  if (subjEl) {
    subjEl.innerHTML = "";
    subjEl.classList.add("hidden");
  }
  grid.innerHTML = '<div class="loading">Loading CBT practice…</div>';
  cbtHubState.view = "types";
  cbtHubState.board = null;
  try {
    var data = await api("/api/v1/cbt/practice/home");
    cbtHubState.home = data || {};
    renderCbtHub();
  } catch (e) {
    grid.innerHTML =
      '<div class="empty-state-premium"><h3>Could not load CBT</h3><p>' +
      cbtEsc(e.message) +
      '</p><button type="button" class="btn-action" onclick="loadCbtHubPage()">Retry</button></div>';
  }
}

function renderCbtHub() {
  var grid = document.getElementById("cbt-grid");
  if (!grid) return;
  var home = cbtHubState.home || {};
  var settings = home.settings || {};
  if (settings.cbt_enabled === false) {
    grid.innerHTML = '<div class="empty-state-premium"><h3>CBT disabled</h3><p>Admin has turned off CBT practice.</p></div>';
    return;
  }
  if (cbtHubState.view === "board" && cbtHubState.board) {
    renderCbtBoard(grid);
    return;
  }
  var types = home.exam_types || [];
  if (!types.length) {
    grid.innerHTML = '<div class="empty-state-premium"><h3>No exam types</h3><p>CBT is not configured yet.</p></div>';
    return;
  }
  grid.innerHTML = '<div class="cbt-hub-wrap">' +
    '<p class="cbt-hub-note">Choose <strong>JAMB</strong>, <strong>WAEC</strong>, or <strong>NECO</strong>. Question counts and timers come from admin CBT Settings.</p>' +
    '<div class="cbt-type-grid">' +
    types
      .map(function (t) {
        var locked = !t.has_access;
        var logo = t.exam_type === "JAMB" ? "img/jamb-logo.svg" : t.exam_type === "WAEC" ? "img/waec-logo.svg" : "img/neco-logo.svg";
        var accent = t.exam_type === "JAMB" ? "cbt-type-jamb" : t.exam_type === "WAEC" ? "cbt-type-waec" : "cbt-type-neco";
        return (
          '<div class="cbt-type-card ' + accent + '" onclick="cbtHubOpenBoard(\'' +
          cbtEsc(t.exam_type) +
          "')\">" +
          '<div class="cbt-type-logo"><img src="' + logo + '" alt="' + cbtEsc(t.exam_type) + '" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'cbt-logo-fallback\');this.parentNode.innerHTML=\'&#127919;\'" /></div>' +
          '<div class="cbt-type-body">' +
          "<h3>" + cbtEsc(t.exam_type) + "</h3>" +
          '<p class="cbt-type-sub">' +
          (t.exam_type === "JAMB"
            ? "Combined package · pick " + (settings.jamb_subjects_required || 4) + " subjects"
            : "Subject practice from your registered list") +
          "</p>" +
          '<span class="cbt-type-badge ' + (locked ? "is-locked" : "is-open") + '">' +
          (locked ? "&#128274; Locked — pay or coupon" : "&#128275; Unlocked") +
          "</span>" +
          "</div>" +
          '<span class="cbt-type-arrow">&#8594;</span>' +
          "</div>"
        );
      })
      .join("") +
    "</div></div>";
}

function cbtHubOpenBoard(board) {
  cbtHubState.board = board;
  cbtHubState.view = "board";
  cbtHubState.jambPicked = {};
  renderCbtHub();
}

function renderCbtBoard(grid) {
  var board = cbtHubState.board;
  var home = cbtHubState.home || {};
  var settings = home.settings || {};
  var profile = home.profile || {};
  var info = (home.exam_types || []).find(function (t) {
    return t.exam_type === board;
  }) || { has_access: false };

  var html = '<div class="cbt-hub-wrap">' +
    '<p class="cbt-hub-note"><button type="button" class="btn-secondary btn-sm" onclick="loadCbtHubPage()">← Exam types</button></p>' +
    "<h3 style=\"margin:8px 0\">" +
    cbtEsc(board) +
    " CBT</h3>";

  if (!info.has_access) {
    html +=
      '<div class="empty-state-premium"><h3>Package required</h3><p>Unlock ' +
      cbtEsc(board) +
      " with Paystack or a coupon.</p>" +
      '<button type="button" class="btn-join" onclick="cbtHubUnlockBoard()">Unlock ' +
      cbtEsc(board) +
      "</button></div>";
    grid.innerHTML = html;
    return;
  }

  if (board === "JAMB") {
    var need = settings.jamb_subjects_required || 4;
    var jambSubs =
      profile.jamb_subjects && profile.jamb_subjects.length
        ? profile.jamb_subjects
        : DEFAULT_JAMB_SUBJECTS;
    var pickedCount = Object.keys(cbtHubState.jambPicked).length;
    html +=
      '<p class="cbt-hub-note">Select exactly <strong>' +
      need +
      "</strong> subjects, then START CBT. Subjects run as separate sections in one exam.</p>";
    html += '<div class="cbt-subject-grid">';
    html += jambSubs
      .map(function (s) {
        var on = !!cbtHubState.jambPicked[s];
        return (
          '<button type="button" class="cbt-subject-chip' + (on ? " is-on" : "") +
          '" onclick="cbtHubToggleJamb(\'' +
          cbtEsc(s).replace(/'/g, "\\'") +
          "')\"><span class='cbt-chip-check'>" + (on ? "&#10003;" : "") + "</span>" +
          cbtEsc(s) +
          "</button>"
        );
      })
      .join("");
    html += "</div>";
    html +=
      '<div class="cbt-start-bar"><span id="cbt-jamb-count" class="cbt-start-count">' +
      pickedCount + " / " + need + " selected</span>" +
      '<button type="button" class="btn-join" onclick="cbtHubStartJambPractice()">START CBT &#8594;</button></div>';
    grid.innerHTML = html;
    return;
  }

  var registered =
    profile.ssce_subjects && profile.ssce_subjects.length
      ? profile.ssce_subjects
      : DEFAULT_SSCE_SUBJECTS;
  html +=
    '<p class="cbt-hub-note">Choose one subject to practice. Only your registered subjects are listed.</p>';
  html += '<div class="cbt-subject-grid">';
  html += registered
    .map(function (s) {
      return (
        '<div class="cbt-type-card cbt-type-subject" onclick="cbtHubStartSubject(\'' +
        cbtEsc(s).replace(/'/g, "\\'") +
        "')\">" +
        '<div class="cbt-type-icon">&#128221;</div>' +
        '<div class="cbt-type-body"><h3>' + cbtEsc(s) + '</h3>' +
        '<p class="cbt-type-sub">' + cbtEsc(board) + " practice</p></div>" +
        '<span class="cbt-type-arrow">&#9654;</span></div>'
      );
    })
    .join("");
  html += "</div>";
  html += '</div>';
  grid.innerHTML = html;
}

function cbtHubToggleJamb(subject, on) {
  if (on === undefined) on = !cbtHubState.jambPicked[subject];
  if (on) cbtHubState.jambPicked[subject] = true;
  else delete cbtHubState.jambPicked[subject];
  renderCbtHub();
}

function cbtHubUnlockBoard() {
  if (typeof openCbtUnlockModal === "function") {
    openCbtUnlockModal(function () {
      loadCbtHubPage().then(function () {
        if (cbtHubState.board) cbtHubOpenBoard(cbtHubState.board);
      });
    });
  } else if (typeof showPage === "function") {
    showPage("cbt-packages");
  }
}

async function cbtHubStartJambPractice() {
  var settings = (cbtHubState.home && cbtHubState.home.settings) || {};
  var need = settings.jamb_subjects_required || 4;
  var picked = Object.keys(cbtHubState.jambPicked || {});
  if (picked.length !== need) {
    alert("Select exactly " + need + " JAMB subjects.");
    return;
  }
  await cbtHubStartPractice("JAMB", picked);
}

async function cbtHubStartSubject(subject) {
  await cbtHubStartPractice(cbtHubState.board, [subject]);
}

async function cbtHubStartPractice(examType, subjects) {
  if (cbtHubState.busy) return;
  cbtHubState.busy = true;
  try {
    var attempt = await api("/api/v1/cbt/practice/start", {
      method: "POST",
      body: JSON.stringify({ exam_type: examType, subjects: subjects }),
    });
    launchPracticeAttempt(attempt);
  } catch (e) {
    var msg = (e && e.message) || "";
    if (/402|cbt_package|package|paid|required/i.test(msg) || (e && e.status === 402)) {
      if (typeof openCbtUnlockModal === "function") {
        openCbtUnlockModal(function () {
          cbtHubStartPractice(examType, subjects);
        });
      } else {
        alert(msg);
      }
    } else {
      alert(msg || "Could not start CBT.");
    }
  } finally {
    cbtHubState.busy = false;
  }
}

function launchPracticeAttempt(attempt) {
  var pack = cbtAttemptToPack(attempt);
  if (!pack.questions.length) {
    alert("No questions generated. Ask admin to upload bank questions for these subjects.");
    return;
  }
  currentExam = pack;
  currentSession = {
    session_id: null,
    practice_attempt_id: attempt.attempt_id,
    is_practice: true,
  };
  answers = {};
  // Restore saved answers by question index
  (pack.questions || []).forEach(function (q, i) {
    if (pack.answers && pack.answers[q.id]) answers[i] = pack.answers[q.id];
  });
  currentQ = 0;
  if (pack.sections && pack.sections.length > 1 && pack.section_index) {
    var sec = pack.sections[pack.section_index];
    if (sec) currentQ = sec.start || 0;
  }
  secondsLeft =
    typeof pack.seconds_left === "number" ? pack.seconds_left : (pack.duration_minutes || 60) * 60;

  if (typeof showCbtExamView === "function") showCbtExamView();
  document.getElementById("exam-title").textContent = pack.title;
  document.getElementById("exam-meta").textContent =
    (pack.subject || examTypeLabel(attempt.exam_type)) +
    " · " +
    pack.questions.length +
    " questions · Settings timer";
  if (typeof buildSubjectTabs === "function") buildSubjectTabs();
  if (typeof buildQNav === "function") buildQNav();
  if (typeof renderQuestion === "function") renderQuestion();
  if (typeof startTimer === "function") startTimer();
}

function examTypeLabel(t) {
  return t || "CBT";
}

// Legacy stubs so old onclick handlers do not crash
function cbtHubSetTab() {}
function cbtHubSetSubject() {}
function cbtHubDownload() {
  alert("Download offline packs will sync with practice attempts in a follow-up update. Start CBT online for now.");
}
function cbtHubDownloadJamb() {
  cbtHubDownload();
}
function cbtHubStart() {
  alert("Use START CBT from the JAMB / WAEC / NECO flow.");
}
function cbtHubStartJamb() {
  alert("Select your 4 subjects, then tap START CBT.");
}

if (typeof window !== "undefined") {
  window.loadCbtHubPage = loadCbtHubPage;
  window.cbtHubOpenBoard = cbtHubOpenBoard;
  window.cbtHubToggleJamb = cbtHubToggleJamb;
  window.cbtHubUnlockBoard = cbtHubUnlockBoard;
  window.cbtHubStartJambPractice = cbtHubStartJambPractice;
  window.cbtHubStartSubject = cbtHubStartSubject;
  window.cbtHubSetTab = cbtHubSetTab;
  window.cbtHubSetSubject = cbtHubSetSubject;
  window.cbtHubDownload = cbtHubDownload;
  window.cbtHubDownloadJamb = cbtHubDownloadJamb;
  window.cbtHubStart = cbtHubStart;
  window.cbtHubStartJamb = cbtHubStartJamb;
}
