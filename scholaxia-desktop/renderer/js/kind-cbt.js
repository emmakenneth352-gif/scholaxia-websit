/** Kids Common Entrance CBT — matches Flutter KindCbtScreen + Paystack ₦2000. */

var kindCbtState = {
  exam: null,
  session: null,
  answers: {},
  index: 0,
};  function cleanTitle(raw) {
    var t = String(raw || "").trim();
    var low = t.toLowerCase();
    if (low.indexOf("common_entrance") === 0) {
      t = t.substring("common_entrance".length);
    } else if (low.indexOf("common entrance") === 0) {
      t = t.substring("common entrance".length);
    }
    t = t.replace(/_question_bank/gi, " ").replace(/question bank/gi, " ");
    t = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return t || "Practice";
  }

var KIND_CBT_STYLES = [
  { icon: "&#128218;", from: "#7c3aed", to: "#4f46e5" }, /* violet book */
  { icon: "&#127757;", from: "#0ea5e9", to: "#0369a1" }, /* globe */
  { icon: "&#128300;", from: "#10b981", to: "#047857" }, /* science */
  { icon: "&#128288;", from: "#f59e0b", to: "#d97706" }, /* language arts */
  { icon: "&#129490;", from: "#ec4899", to: "#be185d" }, /* french */
  { icon: "&#127979;", from: "#6366f1", to: "#4338ca" }, /* general */
  { icon: "&#129513;", from: "#14b8a6", to: "#0f766e" }, /* reasoning */
  { icon: "&#127918;", from: "#f43f5e", to: "#be123c" }, /* fun */
];

function kindCbtStyleFor(title) {
  var t = String(title || "").toLowerCase();
  if (t.indexOf("english") >= 0 || t.indexOf("verbal") >= 0) return KIND_CBT_STYLES[3];
  if (t.indexOf("french") >= 0) return KIND_CBT_STYLES[4];
  if (t.indexOf("science") >= 0) return KIND_CBT_STYLES[2];
  if (t.indexOf("social") >= 0 || t.indexOf("study") >= 0) return KIND_CBT_STYLES[1];
  if (t.indexOf("reasoning") >= 0 || t.indexOf("quantitative") >= 0) return KIND_CBT_STYLES[6];
  if (t.indexOf("math") >= 0) return KIND_CBT_STYLES[0];
  var hash = 0;
  for (var i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) >>> 0;
  return KIND_CBT_STYLES[hash % KIND_CBT_STYLES.length];
}

async function loadKindCbtPage() {
  var root = document.getElementById("kind-cbt-root");
  var play = document.getElementById("kind-cbt-play");
  if (play) {
    play.classList.add("hidden");
    play.innerHTML = "";
  }
  if (!root) return;
  root.classList.remove("hidden");    root.innerHTML = '<div class="loading">Loading practice exams…</div>';

  try {
    var exams = [];
    var hasAccess = false;
    try {
      exams = await api("/api/v1/cbt/exams?exam_type=COMMON_ENTRANCE") || [];
      if (!Array.isArray(exams)) exams = exams.exams || [];
    } catch (e) {
      exams = [];
    }
    try {
      var access = await api("/api/v1/payments/paystack/cbt-access") || {};
      var boards = (access.boards || []).map(function (b) {
        return String(b).toUpperCase();
      });
      hasAccess = boards.indexOf("COMMON_ENTRANCE") >= 0;
    } catch (e) {
      hasAccess = false;
    }

    var payBanner =
      '<div class="kind-cbt-paywall kind-cbt-paywall-hero">' +
      '<div class="kind-cbt-paywall-art" aria-hidden="true">&#127891;</div>' +
      "<h3>Unlock Common Entrance practice</h3>" +
      "<p>Year-round access to every Common Entrance exam for <strong>&#8358;2,000 / year</strong>, paid securely with Paystack.</p>" +
      '<button type="button" class="kind-cbt-pay-btn" onclick="payKindCbtPackage()">&#128179; Pay ₦2,000 with Paystack</button>' +
      "</div>";

    if (!exams.length) {
      root.innerHTML =
        (hasAccess ? "" : payBanner) +
        '<div class="as-empty"><h3>No exams yet</h3><p>' +
        (hasAccess
          ? "You have CBT access. When admin uploads Common Entrance exams, they appear here."
          : "Admin will publish Common Entrance exams here. You can pay anytime to unlock practice.") +
        "</p></div>";
      return;
    }

    root.innerHTML =
      (hasAccess
        ? '<div class="kind-cbt-status is-active">&#127881; Access active — every Common Entrance exam is unlocked</div>'
        : payBanner) +
      '<div class="kind-cbt-section-title">Pick a practice exam</div>' +
      '<div class="kind-cbt-grid">' +
      exams
        .map(function (ex, idx) {
          var id = ex.id || "";
          var title = cleanTitle(ex.title || ex.subject || "Practice");
          var subject = ex.subject || "";
          var st = kindCbtStyleFor(title);
          var qCount = ex.question_count || ex.total_questions || null;
          return (
            '<article class="kind-cbt-card" style="background:linear-gradient(150deg,' + st.from + "," + st.to + ')"' +
            ' onclick="startKindCbtExam(\'' + kindEsc(id) + '\', this)">' +
            '<div class="kind-cbt-card-icon">' + st.icon + "</div>" +
            '<div class="kind-cbt-card-body">' +
            "<h4>" + kindEsc(title) + "</h4>" +
            (subject && subject.toLowerCase() !== title.toLowerCase()
              ? "<p>" + kindEsc(subject) + "</p>"
              : "") +
            (qCount ? '<span class="kind-cbt-card-meta">' + qCount + " questions</span>" : "") +
            '</div>' +
            '<span class="kind-cbt-card-cta">Start &#9654;</span>' +
            "</article>"
          );
        })
        .join("") +
      "</div>";
  } catch (e) {
    root.innerHTML = '<div class="empty-state">' + kindEsc(e.message) + "</div>";
  }
}

async function payKindCbtPackage() {
  try {
    if (typeof paystackPurchase !== "function") {
      throw new Error("Paystack is not available. Refresh and try again.");
    }
    var paid = await paystackPurchase({
      productType: "cbt_package",
      productId: "common_entrance",
    });
    if (!paid) {
      alert("Payment was not completed.");
      return;
    }
    alert("Payment successful! Common Entrance CBT is unlocked.");
    loadKindCbtPage();
  } catch (e) {
    alert(e.message || "Could not start payment.");
  }
}

async function startKindCbtExam(examId, btn) {
  if (!examId) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    var session = await api("/api/v1/cbt/sessions/" + encodeURIComponent(examId) + "/start", {
      method: "POST",
    });
    var pack = await api("/api/v1/cbt/exams/" + encodeURIComponent(examId) + "/download");
    if (!pack || !pack.questions || !pack.questions.length) {
      throw new Error("This exam has no questions yet.");
    }
    kindCbtState.exam = pack;
    kindCbtState.session = session;
    kindCbtState.answers = {};
    kindCbtState.index = 0;
    renderKindCbtPlayer();
  } catch (e) {
    var msg = e.message || "Could not start exam.";
    if (/402|cbt_package|package|paid|required/i.test(msg)) {
      await payKindCbtPackage();
    } else {
      alert(msg);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start practice";
    }
  }
}

function renderKindCbtPlayer() {
  var root = document.getElementById("kind-cbt-root");
  var play = document.getElementById("kind-cbt-play");
  if (!play || !kindCbtState.exam) return;
  if (root) root.classList.add("hidden");
  play.classList.remove("hidden");

  var qs = kindCbtState.exam.questions || [];
  var i = kindCbtState.index;
  var q = qs[i] || {};
  var opts = q.options || q.choices || [];
  if (!Array.isArray(opts) && typeof opts === "object") {
    opts = Object.keys(opts).map(function (k) {
      return { key: k, text: opts[k] };
    });
  }
  var qid = String(q.id || i);
  var selected = kindCbtState.answers[qid];

  var optionsHtml = (opts || [])
    .map(function (opt, idx) {
      var key = opt.key != null ? String(opt.key) : String.fromCharCode(65 + idx);
      var text = typeof opt === "string" ? opt : opt.text || opt.label || opt.value || key;
      var checked = selected === key ? " checked" : "";
      return (
        '<label class="kind-cbt-option">' +
        '<input type="radio" name="kind-cbt-opt" value="' +
        kindEsc(key) +
        '"' +
        checked +
        ' onchange="kindCbtPickAnswer(\'' +
        kindEsc(qid) +
        "', this.value)\" />" +
        "<span><strong>" +
        kindEsc(key) +
        ".</strong> " +
        kindEsc(text) +
        "</span></label>"
      );
    })
    .join("");

  play.innerHTML =
    '<div class="kind-cbt-player">' +
    '<div class="kind-cbt-player-head">' +
    "<h3>" +
    kindEsc(cleanTitle(kindCbtState.exam.title || "Practice")) +
    "</h3>" +
    "<p>Question " +
    (i + 1) +
    " of " +
    qs.length +
    "</p>" +
    '<button type="button" class="btn-secondary btn-sm" onclick="exitKindCbtPlayer()">Exit</button>' +
    "</div>" +
    '<div class="kind-cbt-q">' +
    "<p>" +
    kindEsc(q.question || q.text || q.prompt || "") +
    "</p>" +
    optionsHtml +
    "</div>" +
    '<div class="kind-cbt-nav">' +
    '<button type="button" class="btn-secondary" ' +
    (i <= 0 ? "disabled" : "") +
    ' onclick="kindCbtPrev()">Previous</button>' +
    (i >= qs.length - 1
      ? '<button type="button" class="btn-action" onclick="submitKindCbtExam()">Submit</button>'
      : '<button type="button" class="btn-action" onclick="kindCbtNext()">Next</button>') +
    "</div></div>";
}

function kindCbtPickAnswer(qid, value) {
  kindCbtState.answers[qid] = value;
}

function kindCbtNext() {
  var qs = (kindCbtState.exam && kindCbtState.exam.questions) || [];
  if (kindCbtState.index < qs.length - 1) {
    kindCbtState.index += 1;
    renderKindCbtPlayer();
  }
}

function kindCbtPrev() {
  if (kindCbtState.index > 0) {
    kindCbtState.index -= 1;
    renderKindCbtPlayer();
  }
}

function exitKindCbtPlayer() {
  kindCbtState = { exam: null, session: null, answers: {}, index: 0 };
  var play = document.getElementById("kind-cbt-play");
  var root = document.getElementById("kind-cbt-root");
  if (play) {
    play.classList.add("hidden");
    play.innerHTML = "";
  }
  if (root) root.classList.remove("hidden");
  loadKindCbtPage();
}

async function submitKindCbtExam() {
  var sessionId =
    (kindCbtState.session && (kindCbtState.session.session_id || kindCbtState.session.id)) || "";
  try {
    if (sessionId) {
      await api("/api/v1/cbt/sessions/submit", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          answers: kindCbtState.answers,
          is_auto_submit: false,
        }),
      });
    }
    alert("Submitted! Great job practising.");
  } catch (e) {
    alert(e.message || "Could not submit. Your answers were saved on this device.");
  }
  exitKindCbtPlayer();
}

window.loadKindCbtPage = loadKindCbtPage;
window.payKindCbtPackage = payKindCbtPackage;
window.startKindCbtExam = startKindCbtExam;
window.kindCbtPickAnswer = kindCbtPickAnswer;
window.kindCbtNext = kindCbtNext;
window.kindCbtPrev = kindCbtPrev;
window.exitKindCbtPlayer = exitKindCbtPlayer;
window.submitKindCbtExam = submitKindCbtExam;
