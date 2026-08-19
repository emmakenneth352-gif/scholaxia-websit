(function () {
  var api = window.ScholaxiaAPI;
  if (!api) return;
  var DB_NAME = "scholaxia_external";
  var state = {
    rec: "",
    candidateId: "",
    access: "",
    candidate: null,
    exam: null,
    pack: null,
    attempt: null,
    answers: {},
    qIndex: 0,
    timer: null,
    expiresAt: null,
  };

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ["step-login", "step-id", "step-ready", "step-exam", "step-done"].forEach(function (s) {
      if ($(s)) $(s).classList.toggle("hidden", s !== id);
    });
    var nav = $("exam-site-nav");
    if (nav) nav.classList.toggle("hidden", id !== "step-login");
    document.body.classList.toggle("is-exam-live", id === "step-exam");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("packages")) db.createObjectStore("packages");
        if (!db.objectStoreNames.contains("answers")) db.createObjectStore("answers");
        if (!db.objectStoreNames.contains("attempts")) db.createObjectStore("attempts");
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { autoIncrement: true });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(store, key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(store, key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, "readonly");
        var req = tx.objectStore(store).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function isStudent() {
    return (localStorage.getItem("sia_role") || "") === "student" && !!(api.getToken && api.getToken());
  }

  function creds() {
    return {};
  }

  function parseId(raw) {
    raw = (raw || "").trim().toUpperCase();
    if (raw.indexOf("SCH-") === 0) {
      state.candidateId = raw;
      state.rec = "";
    } else {
      state.rec = raw;
      state.candidateId = "";
    }
  }

  function fillIdentity(c) {
    c = c || {};
    state.candidate = c;
    if ($("id-name")) $("id-name").textContent = c.full_name || "—";
    if ($("id-cid")) $("id-cid").textContent = c.school_student_id || c.candidate_id || "—";
    if ($("id-school")) $("id-school").textContent = c.school_name || "—";
    if ($("id-class")) $("id-class").textContent = c.class_name || "—";
    if ($("ready-name")) $("ready-name").textContent = c.full_name || "—";
    if ($("ready-class")) $("ready-class").textContent = c.class_name || "—";
    if ($("ready-school")) $("ready-school").textContent = c.school_name || "—";
    if ($("ready-sid")) $("ready-sid").textContent = c.school_student_id || c.candidate_id || "—";
  }

  function renderIdentity(data) {
    fillIdentity(data.candidate || data.student);
    var st = state.candidate || {};
    if ($("exam-hello")) {
      $("exam-hello").textContent = "Hello, " + (st.full_name || "student");
    }
    var exams = data.exams || [];
    if (!exams.length) {
      $("exam-list").innerHTML = '<div class="empty-exam">No exam yet</div>';
      return;
    }
    $("exam-list").innerHTML = exams.map(function (e) {
      return '<div class="take-box"><h3>' + esc(e.title) + "</h3><p>" +
        esc(e.subject || "") + (e.duration_minutes ? " · " + esc(e.duration_minutes) + " min" : "") +
        "</p><button type=\"button\" class=\"btn btn-gold\" data-exam=\"" + esc(e.id) + "\">Take exam</button></div>";
    }).join("");
  }

  function setProgress(n) {
    $("ready-bar").style.width = n + "%";
    $("ready-pct").textContent = "Exam package ready — " + n + "%";
  }

  async function downloadPack(examId) {
    show("step-ready");
    setProgress(15);
    $("btn-start").classList.add("hidden");
    try {
        var pack = await api.api("/api/v1/external-exams/package", {
        method: "POST",
        timeout: 45000,
        body: { exam_id: examId },
      });
      setProgress(70);
      state.pack = pack;
      state.exam = pack.exam;
      if (pack.candidate) fillIdentity(pack.candidate);
      await idbPut("packages", examId, pack);
      setProgress(100);
      $("ready-title").textContent = pack.exam.title;
      $("ready-sub").textContent =
        (pack.exam.duration_minutes || 120) + " minutes · " +
        ((pack.questions && pack.questions.length) || pack.exam.total_questions || 0) +
        " questions. Your name, class and school cannot be changed.";
      $("btn-start").classList.remove("hidden");
    } catch (e) {
      var cached = await idbGet("packages", examId);
      if (cached) {
        state.pack = cached;
        state.exam = cached.exam;
        if (cached.candidate) fillIdentity(cached.candidate);
        setProgress(100);
        $("ready-title").textContent = cached.exam.title + " (offline copy)";
        $("btn-start").classList.remove("hidden");
      } else {
        $("ready-err").textContent = e.message || "Could not download the exam.";
      }
    }
  }

  function questions() {
    return (state.pack && state.pack.questions) || [];
  }

  function renderQ() {
    var qs = questions();
    var q = qs[state.qIndex];
    if (!q) return;
    $("q-count").textContent = "Question " + (state.qIndex + 1) + " of " + qs.length;
    $("q-text").textContent = q.question_text;
    $("opt-a").textContent = "A. " + q.option_a;
    $("opt-b").textContent = "B. " + q.option_b;
    $("opt-c").textContent = "C. " + q.option_c;
    $("opt-d").textContent = "D. " + q.option_d;
    document.querySelectorAll(".opt").forEach(function (btn) {
      btn.classList.toggle("on", state.answers[q.id] === btn.getAttribute("data-opt"));
    });
    $("q-nav").innerHTML = qs.map(function (item, i) {
      var cls = i === state.qIndex ? "cur" : (state.answers[item.id] ? "done" : "");
      return '<button type="button" class="' + cls + '" data-goto="' + i + '">' + (i + 1) + "</button>";
    }).join("");
  }

  function tick() {
    if (!state.expiresAt) return;
    var left = Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000));
    var h = Math.floor(left / 3600);
    var m = Math.floor((left % 3600) / 60);
    var s = left % 60;
    $("exam-timer").textContent =
      h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    if (left <= 0) submitExam(true);
  }

  async function startExam() {
    var examId = state.exam.id;
    var localCode = "ATT-" + new Date().getUTCFullYear() + "-" + Math.random().toString(16).slice(2, 10).toUpperCase();
    try {
      var started = await api.api("/api/v1/external-exams/start", {
        method: "POST",
        body: { exam_id: examId, attempt_code: localCode },
      });
      state.attempt = started;
      state.expiresAt = started.expires_at ? Date.parse(started.expires_at) : Date.now() + (state.exam.duration_minutes || 120) * 60000;
    } catch (e) {
      state.attempt = { attempt_code: localCode };
      state.expiresAt = Date.now() + (state.exam.duration_minutes || 120) * 60000;
    }
    await idbPut("attempts", examId, { attempt: state.attempt, expiresAt: state.expiresAt, startedAt: Date.now() });
    var who = state.candidate || (state.pack && state.pack.candidate) || {};
    state.candidate = who;
    $("exam-title").textContent = state.exam.title;
    $("exam-cand").textContent = (who.full_name || "") + " · " + (who.class_name || "") + " · " + (who.school_name || "");
    show("step-exam");
    renderQ();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(tick, 1000);
    tick();
  }

  async function saveAnswer(opt) {
    var q = questions()[state.qIndex];
    if (!q) return;
    state.answers[q.id] = opt;
    await idbPut("answers", state.exam.id, state.answers);
    renderQ();
  }

  async function submitExam(auto) {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    var payload = {
      exam_id: state.exam.id,
      attempt_code: (state.attempt && state.attempt.attempt_code) || "",
      started_at: new Date(state.expiresAt - (state.exam.duration_minutes || 120) * 60000).toISOString(),
      answers: state.answers,
    };
    await idbPut("queue", Date.now(), payload);
    show("step-done");
    try {
      var res = await api.api("/api/v1/external-exams/submit", {
        method: "POST",
        timeout: 45000,
        body: payload,
      });
      $("done-copy").textContent = auto
        ? "Time is up. Your answers were auto-submitted and marked by the server for your school."
        : "Submitted. Official marks were calculated on the server for your school.";
      $("done-grid").innerHTML =
        '<div class="id-box"><span>Student</span><strong>' + esc(res.student_name || state.candidate.full_name) + "</strong></div>" +
        '<div class="id-box"><span>ID</span><strong>' + esc(res.candidate_id || state.candidate.candidate_id) + "</strong></div>" +
        '<div class="id-box"><span>Score</span><strong>' + esc(res.score) + " / " + esc(res.total_marks) + "</strong></div>" +
        '<div class="id-box"><span>Status</span><strong>' + esc(res.status) + "</strong></div>";
    } catch (e) {
      $("done-copy").textContent = "Saved on this computer (pending sync). When internet returns, reopen this page and your result will go to the school dashboard.";
      $("done-grid").innerHTML = "<p>" + esc(e.message) + "</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (reg) { reg.unregister(); });
      });
    }

    async function showExams() {
      var data = await api.api("/api/v1/external-exams/mine");
      renderIdentity({ candidate: data.student, exams: data.exams || [] });
      show("step-id");
      if ($("btn-hall-out")) $("btn-hall-out").hidden = false;
    }

    async function bootStudent() {
      try {
        await showExams();
      } catch (e) {
        show("step-login");
        $("hall-err").textContent = e.message || "Log in with the details your school gave you.";
      }
    }

    $("btn-identify").addEventListener("click", async function () {
      $("hall-err").textContent = "";
      var email = ($("hall-email") && $("hall-email").value.trim()) || "";
      var password = ($("hall-password") && $("hall-password").value) || "";
      if (!email || !password) {
        $("hall-err").textContent = "Enter the email and password your school gave you.";
        return;
      }
      try {
        var data = api.loginApi
          ? await api.loginApi(email, password)
          : await api.api("/api/v1/auth/login", {
              method: "POST",
              noAuth: true,
              timeout: 60000,
              retries: 3,
              body: { email: email, password: password },
            });
        if (data.role !== "student") {
          $("hall-err").textContent = "This exam login is for students only. Use the account your school created.";
          return;
        }
        api.saveSession(data, email, data.user && data.user.full_name);
        await showExams();
      } catch (e) {
        $("hall-err").textContent = e.message || "Login failed.";
      }
    });

    if ($("btn-hall-out")) {
      $("btn-hall-out").addEventListener("click", function () {
        localStorage.removeItem("sia_token");
        if (localStorage.getItem("sia_role") === "student") localStorage.removeItem("sia_role");
        window.location.reload();
      });
    }

    if (isStudent()) bootStudent();
    else show("step-login");
    if ($("exam-list")) $("exam-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-exam]");
      if (!b) return;
      downloadPack(b.getAttribute("data-exam"));
    });
    $("btn-start").addEventListener("click", startExam);
    document.querySelectorAll(".opt").forEach(function (btn) {
      btn.addEventListener("click", function () { saveAnswer(btn.getAttribute("data-opt")); });
    });
    $("btn-prev").addEventListener("click", function () {
      if (state.qIndex > 0) { state.qIndex -= 1; renderQ(); }
    });
    $("btn-next").addEventListener("click", function () {
      if (state.qIndex < questions().length - 1) { state.qIndex += 1; renderQ(); }
    });
    $("q-nav").addEventListener("click", function (e) {
      var b = e.target.closest("[data-goto]");
      if (!b) return;
      state.qIndex = Number(b.getAttribute("data-goto"));
      renderQ();
    });
    $("btn-submit").addEventListener("click", function () {
      if (confirm("Submit this exam? You cannot change answers after this.")) submitExam(false);
    });
  });
})();
