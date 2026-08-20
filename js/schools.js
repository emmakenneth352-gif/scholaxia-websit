(function () {
  function getApi() { return window.ScholaxiaAPI || window.api; }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function office(path, options) {
    var api = getApi();
    if (!api || typeof api.api !== "function") {
      return Promise.reject(new Error("School office is still loading. Wait a second and try again."));
    }
    return api.api("/api/v1/admin/school-office" + path, options || {});
  }

  function setMsg(id, text, isErr) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isErr ? "#b91c1c" : "";
  }

  function withBusy(btn, label, fn) {
    return async function () {
      if (!btn || btn.disabled) return;
      var prev = btn.textContent;
      btn.disabled = true;
      if (label) btn.textContent = label;
      try {
        await fn();
      } finally {
        btn.disabled = false;
        if (label) btn.textContent = prev;
      }
    };
  }

  function hasSession() {
    return !!(localStorage.getItem("sia_school_token") && localStorage.getItem("sia_role") === "school_admin");
  }

  function showLogin() {
    document.body.classList.remove("is-office");
    $("login-screen").classList.remove("hidden");
    $("app-screen").classList.add("hidden");
    $("sch-logout").classList.add("hidden");
    $("sch-user-label").classList.add("hidden");
  }

  function showApp() {
    document.body.classList.add("is-office");
    $("login-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");
    $("sch-logout").classList.remove("hidden");
    $("sch-user-label").classList.remove("hidden");
    var campus = localStorage.getItem("sia_school_campus") || "School office";
    var name = localStorage.getItem("sia_name") || "";
    $("school-title").textContent = campus;
    $("sch-user-label").textContent = name + " · " + (localStorage.getItem("sia_email") || "");
    loadOffice();
  }

  function parseQuestions(text) {
    return String(text || "")
      .split(/\n+/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) {
        var parts = line.split("|").map(function (p) { return p.trim(); });
        if (parts.length < 6) throw new Error("Each question needs 6 parts separated by |");
        return {
          question_text: parts[0],
          option_a: parts[1],
          option_b: parts[2],
          option_c: parts[3],
          option_d: parts[4],
          correct_option: (parts[5] || "A").charAt(0).toUpperCase(),
        };
      });
  }

  function printSlip(row) {
    var w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups to print the slip."); return; }
    w.document.write("<html><head><title>Registration slip</title><style>body{font-family:Georgia,serif;padding:32px}h1{font-size:20px}table{border-collapse:collapse;width:100%}td{padding:8px;border-bottom:1px solid #ddd}</style></head><body>");
    w.document.write("<h1>" + esc(row.print_title || (row.school_name || "Scholaxia") + " — Exam registration slip") + "</h1>");
    w.document.write("<table><tr><td>Name</td><td>" + esc(row.full_name) + "</td></tr><tr><td>Candidate ID</td><td><strong>" + esc(row.candidate_id || "—") + "</strong></td></tr><tr><td>Class</td><td>" + esc(row.class_name) + "</td></tr><tr><td>Rec number</td><td><strong>" + esc(row.rec_number) + "</strong></td></tr><tr><td>Access code</td><td><strong>" + esc(row.access_code) + "</strong></td></tr><tr><td>Subjects</td><td>" + esc((row.subjects || []).join(", ")) + "</td></tr></table><p>Take this slip to the exam hall. You will confirm your name and ID before the 2-hour exam starts.</p><script>window.print()<\/script></body></html>");
    w.document.close();
  }

  async function loadOffice() {
    try {
      var me = await office("/me");
      if (me && me.school_name) {
        localStorage.setItem("sia_school_campus", me.school_name);
        $("school-title").textContent = me.school_name;
      }
    } catch (e) {}
    loadSchoolStudents();
  }

  async function loadCandidates() {
    var el = $("so-candidates");
    if (!el) return;
    var q = ($("so-search") && $("so-search").value) || "";
    try {
      var data = await office("/candidates" + (q ? "?q=" + encodeURIComponent(q) : ""));
      var rows = (data && data.candidates) || [];
      if (!rows.length) { el.innerHTML = '<div class="empty">No registered exam students yet.</div>'; return; }
      el.innerHTML = '<table><thead><tr><th>Name</th><th>Candidate ID</th><th>Class</th><th>Rec</th><th>Access</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          return "<tr><td>" + esc(r.full_name) + "</td><td>" + esc(r.candidate_id || "—") + "</td><td>" + esc(r.class_name) +
            "</td><td>" + esc(r.rec_number) + "</td><td>" + esc(r.access_code) +
            '</td><td><button type="button" class="btn-sm" data-slip="' + esc(r.id) + '">Print slip</button></td></tr>';
        }).join("") + "</tbody></table>";
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
    }
  }

  async function loadExamCounts() {
    var el = $("so-exam-counts");
    if (!el) return;
    try {
      var data = await office("/exam-counts");
      var rows = (data && data.exams) || [];
      if (!rows.length) { el.innerHTML = '<div class="empty">No school exams yet.</div>'; return; }
      el.innerHTML = "<table><thead><tr><th>Exam ID</th><th>Title</th><th>Subject</th><th>Taken</th><th>Window</th></tr></thead><tbody>" +
        rows.map(function (r) {
          return "<tr><td><code>" + esc(r.id) + "</code></td><td>" + esc(r.title) + "</td><td>" + esc(r.subject) +
            "</td><td>" + esc(r.taken_count) + "</td><td>" + esc((r.scheduled_start || "—") + " → " + (r.scheduled_end || "—")) + "</td></tr>";
        }).join("") + "</tbody></table>";
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
    }
  }

  async function loadResults() {
    var el = $("so-results");
    if (!el) return;
    var qs = [];
    var cls = ($("so-res-class") && $("so-res-class").value.trim()) || "";
    var sub = ($("so-res-subject") && $("so-res-subject").value.trim()) || "";
    if (cls) qs.push("class_name=" + encodeURIComponent(cls));
    if (sub) qs.push("subject=" + encodeURIComponent(sub));
    try {
      var data = await office("/results" + (qs.length ? "?" + qs.join("&") : ""));
      var rows = (data && data.results) || [];
      if (!rows.length) { el.innerHTML = '<div class="empty">No submitted results yet.</div>'; return; }
      el.innerHTML = "<table><thead><tr><th>Student</th><th>Email</th><th>Exam</th><th>Subject</th><th>%</th></tr></thead><tbody>" +
        rows.map(function (r) {
          return "<tr><td>" + esc(r.student_name) + "</td><td>" + esc(r.email) + "</td><td>" + esc(r.exam_title) + "</td><td>" + esc(r.subject) + "</td><td>" + esc(r.percentage) + "</td></tr>";
        }).join("") + "</tbody></table>";
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
    }
  }

  async function loadTeachers() {
    var el = $("so-teachers");
    try {
      var data = await office("/teachers");
      var rows = (data && data.teachers) || [];
      if (!rows.length) { el.innerHTML = '<div class="empty">No teachers yet.</div>'; return; }
      el.innerHTML = "<table><thead><tr><th>Name</th><th>Email</th><th>Subjects</th><th>Classes</th></tr></thead><tbody>" +
        rows.map(function (r) {
          return "<tr><td>" + esc(r.full_name) + "</td><td>" + esc(r.email) + "</td><td>" + esc((r.subjects || []).join(", ")) + "</td><td>" + esc((r.academic_classes || []).join(", ")) + "</td></tr>";
        }).join("") + "</tbody></table>";
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
    }
  }

  async function enterClassroom(classId, title, subject) {
    var token = await api.api("/api/v1/live-classes/" + classId + "/token");
    localStorage.setItem("live_session", JSON.stringify({
      class_id: classId,
      classId: classId,
      room_id: token.room_id || token.channel_id,
      channel_id: token.channel_id || token.room_id,
      livekit_token: token.livekit_token || token.token,
      livekit_url: token.livekit_url,
      identity: token.identity,
      title: title || "Live Class",
      subject: subject || "",
      teacher_name: localStorage.getItem("sia_name") || "School admin",
      role: "teacher",
    }));
    window.location.href = "classroom.html";
  }

  async function enterClassroom(classId, title, subject) {
    var api = getApi();
    var token = await api.api("/api/v1/live-classes/" + classId + "/token");
    localStorage.setItem("live_session", JSON.stringify({
      class_id: classId,
      classId: classId,
      room_id: token.room_id || token.channel_id,
      channel_id: token.channel_id || token.room_id,
      livekit_token: token.livekit_token || token.token,
      livekit_url: token.livekit_url,
      identity: token.identity,
      title: title || "Live Class",
      subject: subject || "",
      teacher_name: localStorage.getItem("sia_name") || "School admin",
      role: "teacher",
    }));
    window.location.href = "classroom.html";
  }

  function bindOffice() {
    var api = getApi();
    if (!api || typeof api.api !== "function") {
      setTimeout(bindOffice, 50);
      return;
    }
    if (window.__scholaxiaOfficeBound) return;
    window.__scholaxiaOfficeBound = true;

    if (hasSession()) showApp();
    else showLogin();

    if ($("sch-login")) $("sch-login").addEventListener("submit", async function (e) {
      e.preventDefault();
      var err = $("login-error");
      var btn = $("btn-login");
      if (err) err.textContent = "";
      if (btn) btn.disabled = true;
      try {
        var email = $("login-email").value.trim();
        var password = $("login-password").value;
        var data = api.loginApi
          ? await api.loginApi(email, password)
          : await api.api("/api/v1/auth/login", {
              method: "POST",
              noAuth: true,
              timeout: 60000,
              retries: 3,
              body: { email: email, password: password },
            });
        if (data.role !== "school_admin") {
          if (err) err.textContent = "This login is for school admins only. Students use Sign in on the home page. Main admin uses the main admin site.";
          return;
        }
        api.saveSession(data, email, data.user && data.user.full_name);
        if (data.user && data.user.school_id) localStorage.setItem("sia_school_id", data.user.school_id);
        if (data.user && data.user.school_name) localStorage.setItem("sia_school_campus", data.user.school_name);
        showApp();
      } catch (ex) {
        if (err) err.textContent = ex.message || "Login failed.";
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    if ($("sch-logout")) $("sch-logout").addEventListener("click", function () {
      localStorage.removeItem("sia_school_token");
      localStorage.removeItem("sia_school_campus");
      localStorage.removeItem("sia_school_id");
      if (localStorage.getItem("sia_role") === "school_admin") {
        localStorage.removeItem("sia_teacher_token");
        localStorage.removeItem("sia_role");
      }
      showLogin();
    });

    function switchTab(name) {
      document.querySelectorAll("#sch-tabs button").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-tab") === name);
      });
      document.querySelectorAll(".tab-panel").forEach(function (p) {
        p.classList.toggle("hidden", p.id !== "tab-" + name);
      });
      if (name === "students") loadSchoolStudents();
      if (name === "upload" || name === "papers" || name === "schedule" || name === "retake" || name === "settings" || name === "results") {
        loadExternalExams();
      }
      if (name === "results") loadEeResults();
    }
    if ($("sch-tabs")) $("sch-tabs").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      switchTab(btn.getAttribute("data-tab"));
    });
    document.querySelectorAll("[data-goto-tab]").forEach(function (chip) {
      chip.addEventListener("click", function () { switchTab(chip.getAttribute("data-goto-tab")); });
    });

    if ($("btn-register")) $("btn-register").addEventListener("click", async function () {
      var msg = $("so-reg-msg");
      try {
        var row = await office("/candidates", {
          method: "POST",
          body: {
            class_name: $("so-class").value,
            full_name: $("so-name").value.trim(),
            email: $("so-email").value.trim() || null,
            phone: $("so-phone").value.trim() || null,
            subjects: ($("so-subjects").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
          },
        });
        if (msg) msg.textContent = "Registered. ID: " + (row.candidate_id || "") + " · Rec: " + row.rec_number + " · Access: " + row.access_code;
        printSlip(row);
        loadCandidates();
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    });

    if ($("so-search")) $("so-search").addEventListener("input", loadCandidates);
    if ($("so-candidates")) $("so-candidates").addEventListener("click", async function (e) {
      var b = e.target.closest("[data-slip]");
      if (!b) return;
      try {
        printSlip(await office("/candidates/" + b.getAttribute("data-slip") + "/slip"));
      } catch (err) { alert(err.message); }
    });

    if ($("btn-exam")) $("btn-exam").addEventListener("click", async function () {
      var msg = $("ex-msg");
      try {
        var questions = parseQuestions($("ex-questions").value);
        var created = await office("/exams", {
          method: "POST",
          body: {
            title: $("ex-title").value.trim(),
            subject: $("ex-subject").value.trim(),
            duration_minutes: Number($("ex-duration").value) || 45,
            scheduled_start: $("ex-start").value || null,
            scheduled_end: $("ex-end").value || null,
            questions: questions,
          },
        });
        if (msg) msg.textContent = "Exam saved: " + created.title + " (" + created.total_questions + " questions).";
        $("ex-questions").value = "";
        loadExamCounts();
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    });

    function openPrintWindow(title, bodyHtml) {
      var w = window.open("", "_blank");
      if (!w) { window.print(); return; }
      w.document.write("<html><head><title>" + esc(title) + "</title><style>");
      w.document.write("body{font-family:Georgia,serif;padding:32px;color:#111}h1{font-size:22px;margin:0 0 8px}h2{font-size:16px;font-weight:600}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}button{display:none}.slip{border:2px solid #111;padding:24px;max-width:520px}.row{display:flex;justify-content:space-between;margin:8px 0;border-bottom:1px dotted #ccc;padding-bottom:6px}.muted{color:#555;font-size:13px}");
      w.document.write("</style></head><body>");
      w.document.write(bodyHtml);
      w.document.write("<script>window.print()<\/script></body></html>");
      w.document.close();
    }

    function reprintStudent(r) {
      var examName = ($("ee-result-exam") && $("ee-result-exam").selectedOptions[0] && $("ee-result-exam").selectedOptions[0].text) || "Examination";
      var school = localStorage.getItem("sia_school_campus") || "School";
      openPrintWindow("Result reprint",
        '<div class="slip"><p class="muted">SCHOLAXIA · RESULT REPRINT</p><h1>' + esc(examName) + "</h1>" +
        '<div class="row"><span>Student</span><strong>' + esc(r.student_name) + "</strong></div>" +
        '<div class="row"><span>School</span><strong>' + esc(school) + "</strong></div>" +
        '<div class="row"><span>Class</span><strong>' + esc(r.class_name) + "</strong></div>" +
        '<div class="row"><span>Student ID</span><strong>' + esc(r.candidate_id) + "</strong></div>" +
        '<div class="row"><span>Score</span><strong>' + esc(r.score) + "/" + esc(r.total_marks) + "</strong></div>" +
        '<div class="row"><span>Percentage</span><strong>' + esc(r.percentage) + "%</strong></div>" +
        '<div class="row"><span>Grade</span><strong>' + esc(r.grade || "—") + "</strong></div>" +
        '<div class="row"><span>Status</span><strong>' + esc(r.status) + "</strong></div>" +
        '<p class="muted">Attempt ' + esc(r.attempt_code || "") + (r.result_code ? " · Result " + esc(r.result_code) : "") + "</p></div>"
      );
    }
    if ($("btn-results")) $("btn-results").addEventListener("click", loadResults);
    if ($("btn-print-results")) $("btn-print-results").addEventListener("click", function () {
      var examName = ($("ee-result-exam") && $("ee-result-exam").selectedOptions[0] && $("ee-result-exam").selectedOptions[0].text) || "Results";
      var html = ($("ee-results") && $("ee-results").innerHTML) || "";
      var school = localStorage.getItem("sia_school_campus") || "School";
      openPrintWindow("Reprint results", "<h1>" + esc(school) + "</h1><h2>" + esc(examName) + "</h2>" + html);
    });
    if ($("btn-retake")) $("btn-retake").addEventListener("click", withBusy($("btn-retake"), "Saving…", async function () {
      setMsg("so-retake-msg", "");
      try {
        var data = await office("/retake", {
          method: "POST",
          body: {
            student_email: $("so-retake-email").value.trim(),
            exam_id: $("so-retake-exam").value.trim(),
          },
        });
        setMsg("so-retake-msg", data.message || "Retake granted.");
      } catch (e) {
        setMsg("so-retake-msg", e.message, true);
      }
    }));

    if ($("btn-teacher")) $("btn-teacher").addEventListener("click", async function () {
      var msg = $("so-t-msg");
      try {
        await office("/teachers", {
          method: "POST",
          body: {
            full_name: $("so-t-name").value.trim(),
            email: $("so-t-email").value.trim(),
            password: $("so-t-pass").value,
            subjects: ($("so-t-subjects").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
            academic_classes: ($("so-t-classes").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
          },
        });
        if (msg) msg.textContent = "Teacher created. They can sign in on the teacher portal.";
        $("so-t-pass").value = "";
        loadTeachers();
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    });

    async function hostLive(startNow) {
      var msg = $("so-live-msg");
      try {
        var created = await office("/live-classes", {
          method: "POST",
          body: {
            title: $("so-live-title").value.trim(),
            subject: $("so-live-subject").value.trim(),
            start_now: startNow,
            visibility: $("so-live-vis").value,
            academic_class: $("so-live-class").value,
          },
        });
        if (msg) msg.textContent = startNow ? "Class is live." : "Class created.";
        if (startNow && created && created.id && confirm("Open classroom now?")) {
          await enterClassroom(created.id, $("so-live-title").value.trim(), $("so-live-subject").value.trim());
        }
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    }
    if ($("btn-live-sched")) $("btn-live-sched").addEventListener("click", function () { hostLive(false); });
    if ($("btn-live-now")) $("btn-live-now").addEventListener("click", function () { hostLive(true); });

    var currentEeId = "";
    var lastEeResults = [];

    async function loadExternalExams() {
      var el = $("ee-list");
      try {
        var data = await office("/external-exams");
        var rows = (data && data.exams) || [];
        var examOpts = rows.map(function (r) {
          return '<option value="' + esc(r.id) + '">' + esc(r.title) + " · " + esc(r.status) + "</option>";
        }).join("");
        ["ee-result-exam", "so-retake-exam", "ee-sched-exam", "ee-set-exam"].forEach(function (id) {
          if ($(id)) $(id).innerHTML = examOpts || '<option value="">No exams yet</option>';
        });
        if (!el) return;
        if (!rows.length) { el.innerHTML = '<div class="empty">No external exams yet.</div>'; return; }
        el.innerHTML = "<table><thead><tr><th>Title</th><th>Class</th><th>Marks</th><th>Status</th><th></th></tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr><td>" + esc(r.title) + "</td><td>" + esc(r.class_name) + "</td><td>" + esc(r.total_marks) +
              "</td><td><span class=\"badge\">" + esc(r.status) + "</span></td><td>" +
              '<button type="button" class="btn-sm" data-ee-review="' + esc(r.id) + '">Review</button></td></tr>';
          }).join("") + "</tbody></table>";
      } catch (e) {
        if (el) el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
      }
    }

    function renderReview(questions) {
      if (!$("ee-review") || !$("ee-questions")) return;
      $("ee-review").classList.remove("hidden");
      $("ee-questions").innerHTML = (questions || []).map(function (q) {
        return '<div class="q-card" data-qid="' + esc(q.id) + '"><strong>Q' + esc(q.number) + '</strong>' +
          (q.issues && q.issues.length ? '<p class="hint">' + esc(q.issues.join("; ")) + "</p>" : "") +
          '<label>Question <textarea class="ee-q">' + esc(q.question_text) + "</textarea></label>" +
          '<div class="grid"><label>A <input class="ee-a" value="' + esc(q.option_a) + '" /></label>' +
          '<label>B <input class="ee-b" value="' + esc(q.option_b) + '" /></label>' +
          '<label>C <input class="ee-c" value="' + esc(q.option_c) + '" /></label>' +
          '<label>D <input class="ee-d" value="' + esc(q.option_d) + '" /></label>' +
          '<label>Correct' +
          '<select class="ee-correct"><option' + (q.correct_option === "A" ? " selected" : "") + ">A</option><option" +
          (q.correct_option === "B" ? " selected" : "") + ">B</option><option" +
          (q.correct_option === "C" ? " selected" : "") + ">C</option><option" +
          (q.correct_option === "D" ? " selected" : "") + ">D</option></select></label></div></div>";
      }).join("");
    }

    async function openReview(id) {
      currentEeId = id;
      var data = await office("/external-exams/" + id + "/questions");
      renderReview(data.questions || []);
    }

    function collectReview() {
      return Array.prototype.map.call(document.querySelectorAll("#ee-questions .q-card"), function (card) {
        return {
          id: card.getAttribute("data-qid"),
          question_text: card.querySelector(".ee-q").value,
          option_a: card.querySelector(".ee-a").value,
          option_b: card.querySelector(".ee-b").value,
          option_c: card.querySelector(".ee-c").value,
          option_d: card.querySelector(".ee-d").value,
          correct_option: card.querySelector(".ee-correct").value,
          is_approved: true,
        };
      });
    }

    if ($("btn-ee-create")) $("btn-ee-create").addEventListener("click", withBusy($("btn-ee-create"), "Working…", async function () {
      setMsg("ee-msg", "");
      var file = $("ee-file") && $("ee-file").files[0];
      if (!file) { setMsg("ee-msg", "Choose a PDF or DOCX paper.", true); return; }
      try {
        var created = await office("/external-exams", {
          method: "POST",
          body: {
            title: $("ee-title").value.trim(),
            subject: $("ee-subject").value.trim(),
            class_name: $("ee-class").value,
            extra_classes: Array.prototype.map.call(document.querySelectorAll(".ee-extra-chip:checked"), function (el) { return el.value; }),
            instructions: $("ee-notes").value.trim(),
            duration_minutes: Number($("ee-duration").value) || 120,
            total_marks: Number($("ee-marks").value) || 100,
            pass_mark: Number($("ee-pass").value) || 50,
            scheduled_start: null,
            scheduled_end: null,
          },
        });
        var fd = new FormData();
        fd.append("file", file);
        var uploaded = await api.apiUpload("/api/v1/admin/school-office/external-exams/" + created.id + "/upload", fd);
        var note = "Extracted " + ((uploaded.questions || []).length) + " questions. Review them before publish.";
        if (uploaded.warnings && uploaded.warnings.length) note += " " + uploaded.warnings.join(" ");
        setMsg("ee-msg", note);
        currentEeId = created.id;
        renderReview(uploaded.questions || []);
        loadExternalExams();
      } catch (e) {
        setMsg("ee-msg", e.message, true);
      }
    }));

    if ($("ee-list")) $("ee-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-ee-review]");
      if (!b) return;
      openReview(b.getAttribute("data-ee-review")).catch(function (err) { alert(err.message); });
    });

    if ($("btn-ee-save")) $("btn-ee-save").addEventListener("click", async function () {
      if (!currentEeId) return;
      try {
        await office("/external-exams/" + currentEeId + "/review", { method: "PUT", body: { questions: collectReview() } });
        setMsg("ee-msg", "Review saved. Publish when every answer is correct.");
      } catch (e) { setMsg("ee-msg", e.message, true); }
    });

    if ($("btn-ee-publish")) $("btn-ee-publish").addEventListener("click", async function () {
      if (!currentEeId) return;
      try {
        await office("/external-exams/" + currentEeId + "/review", { method: "PUT", body: { questions: collectReview() } });
        await office("/external-exams/" + currentEeId + "/publish", { method: "POST", body: {} });
        setMsg("ee-msg", "Published. Students in the selected class(es) will see it after they sign in.");
        loadExternalExams();
      } catch (e) { setMsg("ee-msg", e.message, true); }
    });

    function localToIso(val) {
      if (!val) return null;
      var d = new Date(val);
      return isNaN(d.getTime()) ? val : d.toISOString();
    }

    if ($("btn-ee-schedule")) $("btn-ee-schedule").addEventListener("click", withBusy($("btn-ee-schedule"), "Saving…", async function () {
      setMsg("ee-sched-msg", "");
      var examId = $("ee-sched-exam") && $("ee-sched-exam").value;
      if (!examId) { setMsg("ee-sched-msg", "Upload an exam first.", true); return; }
      try {
        await office("/external-exams/" + examId, {
          method: "PATCH",
          body: {
            scheduled_start: localToIso($("ee-start").value),
            scheduled_end: localToIso($("ee-end").value),
          },
        });
        setMsg("ee-sched-msg", "Schedule saved.");
        loadExternalExams();
      } catch (e) {
        setMsg("ee-sched-msg", e.message, true);
      }
    }));

    if ($("btn-ee-settings")) $("btn-ee-settings").addEventListener("click", withBusy($("btn-ee-settings"), "Saving…", async function () {
      setMsg("ee-set-msg", "");
      var examId = $("ee-set-exam") && $("ee-set-exam").value;
      if (!examId) { setMsg("ee-set-msg", "Upload an exam first.", true); return; }
      try {
        await office("/external-exams/" + examId, {
          method: "PATCH",
          body: {
            duration_minutes: Number($("ee-set-duration").value) || 120,
            pass_mark: Number($("ee-set-pass").value) || 50,
            extra_classes: Array.prototype.map.call(document.querySelectorAll(".ee-set-chip:checked"), function (el) { return el.value; }),
            instructions: ($("ee-set-notes") && $("ee-set-notes").value.trim()) || "",
          },
        });
        setMsg("ee-set-msg", "Settings saved.");
        loadExternalExams();
      } catch (e) {
        setMsg("ee-set-msg", e.message, true);
      }
    }));
    if ($("btn-ee-set-publish")) $("btn-ee-set-publish").addEventListener("click", withBusy($("btn-ee-set-publish"), "Publishing…", async function () {
      setMsg("ee-set-msg", "");
      var examId = $("ee-set-exam") && $("ee-set-exam").value;
      if (!examId) return;
      try {
        await office("/external-exams/" + examId + "/publish", { method: "POST", body: {} });
        setMsg("ee-set-msg", "Exam published.");
        loadExternalExams();
      } catch (e) {
        setMsg("ee-set-msg", e.message, true);
      }
    }));
    if ($("btn-ee-set-unpublish")) $("btn-ee-set-unpublish").addEventListener("click", withBusy($("btn-ee-set-unpublish"), "Working…", async function () {
      setMsg("ee-set-msg", "");
      var examId = $("ee-set-exam") && $("ee-set-exam").value;
      if (!examId) return;
      try {
        await office("/external-exams/" + examId + "/unpublish", { method: "POST", body: {} });
        setMsg("ee-set-msg", "Exam unpublished.");
        loadExternalExams();
      } catch (e) {
        setMsg("ee-set-msg", e.message, true);
      }
    }));

    async function loadEeResults() {
      var examId = $("ee-result-exam") && $("ee-result-exam").value;
      var el = $("ee-results");
      if (!el) return;
      if (!examId) { el.innerHTML = '<div class="empty">Upload an exam first, then load results.</div>'; return; }
      var qs = [];
      var cls = ($("so-res-class") && $("so-res-class").value.trim()) || "";
      var q = ($("ee-result-q") && $("ee-result-q").value.trim()) || "";
      if (cls) qs.push("class_name=" + encodeURIComponent(cls));
      if (q) qs.push("q=" + encodeURIComponent(q));
      try {
        var data = await office("/external-exams/" + examId + "/results" + (qs.length ? "?" + qs.join("&") : ""));
        var rows = (data && data.results) || [];
        lastEeResults = rows;
        if (!rows.length) { el.innerHTML = '<div class="empty">No synced results yet.</div>'; return; }
        el.innerHTML = "<table><thead><tr><th>Student</th><th>ID</th><th>Class</th><th>Score</th><th>%</th><th>Grade</th><th>Status</th><th></th></tr></thead><tbody>" +
          rows.map(function (r, i) {
            return "<tr><td>" + esc(r.student_name) + "</td><td>" + esc(r.candidate_id) + "</td><td>" + esc(r.class_name) +
              "</td><td>" + esc(r.score) + "/" + esc(r.total_marks) + "</td><td>" + esc(r.percentage) +
              "</td><td>" + esc(r.grade || "—") + "</td><td>" + esc(r.status) +
              '</td><td><button type="button" class="btn-sm" data-reprint="' + i + '">Reprint</button></td></tr>';
          }).join("") + "</tbody></table>";
      } catch (e) {
        el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
      }
    }
    if ($("btn-ee-results")) $("btn-ee-results").addEventListener("click", loadEeResults);
    if ($("ee-results")) $("ee-results").addEventListener("click", function (e) {
      var b = e.target.closest("[data-reprint]");
      if (!b) return;
      var row = lastEeResults[Number(b.getAttribute("data-reprint"))];
      if (row) reprintStudent(row);
    });

    async function loadSchoolStudents() {
      var el = $("st-list");
      if (!el) return;
      var q = ($("st-search") && $("st-search").value) || "";
      el.innerHTML = '<div class="empty">Loading…</div>';
      try {
        var data = await office("/students" + (q ? "?q=" + encodeURIComponent(q) : ""));
        var rows = (data && data.students) || [];
        if (!rows.length) { el.innerHTML = '<div class="empty">No students yet. Add one or import a CSV.</div>'; return; }
        el.innerHTML = "<table><thead><tr><th>Name</th><th>Email</th><th>Class</th><th>Student ID</th><th></th></tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr><td>" + esc(r.full_name) + "</td><td>" + esc(r.email) + "</td><td>" + esc(r.class_name || "—") +
              "</td><td>" + esc(r.student_id || "—") + '</td><td><button type="button" class="btn-sm" data-reset="' +
              esc(r.id) + '">Reset password</button></td></tr>';
          }).join("") + "</tbody></table>";
      } catch (e) {
        el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
      }
    }

    if ($("btn-st-add")) $("btn-st-add").addEventListener("click", withBusy($("btn-st-add"), "Adding…", async function () {
      setMsg("st-add-msg", "");
      setMsg("st-msg", "");
      var name = ($("st-name") && $("st-name").value.trim()) || "";
      var email = ($("st-email") && $("st-email").value.trim()) || "";
      if (!name || !email) {
        setMsg("st-add-msg", "Enter the student full name and email.", true);
        return;
      }
      try {
        var row = await office("/students", {
          method: "POST",
          body: {
            full_name: name,
            email: email,
            class_name: $("st-class").value,
            student_id: ($("st-sid") && $("st-sid").value.trim()) || null,
            password: ($("st-pass") && $("st-pass").value) || null,
          },
        });
        var ok = "Created. Give them: " + row.email + " / " + row.password + "  (Student ID " + (row.student_id || "") + ")";
        setMsg("st-add-msg", ok);
        setMsg("st-msg", ok);
        if ($("st-pass")) $("st-pass").value = "";
        if ($("st-name")) $("st-name").value = "";
        if ($("st-email")) $("st-email").value = "";
        if ($("st-sid")) $("st-sid").value = "";
        loadSchoolStudents();
      } catch (e) {
        setMsg("st-add-msg", e.message, true);
        setMsg("st-msg", e.message, true);
      }
    }));
    if ($("st-search")) $("st-search").addEventListener("input", loadSchoolStudents);
    if ($("btn-st-import")) $("btn-st-import").addEventListener("click", withBusy($("btn-st-import"), "Importing…", async function () {
      var file = $("st-csv") && $("st-csv").files[0];
      setMsg("st-msg", "");
      if (!file) { setMsg("st-msg", "Choose a CSV file first.", true); return; }
      var fd = new FormData();
      fd.append("file", file);
      try {
        var data = await api.apiUpload("/api/v1/admin/school-office/students/import", fd);
        var note = "Imported " + (data.created_count || 0) + " students." + ((data.errors || []).length ? " Issues: " + data.errors.join(" | ") : "");
        if (data.created && data.created.length) {
          note += " Logins: " + data.created.map(function (s) { return s.email + "/" + s.password; }).join("; ");
        }
        setMsg("st-msg", note);
        loadSchoolStudents();
      } catch (e) { setMsg("st-msg", e.message, true); }
    }));
    if ($("st-list")) $("st-list").addEventListener("click", async function (e) {
      var b = e.target.closest("[data-reset]");
      if (!b) return;
      var pw = window.prompt("New password (min 8 characters)");
      if (!pw) return;
      try {
        var row = await office("/students/" + b.getAttribute("data-reset"), { method: "PATCH", body: { password: pw } });
        setMsg("st-add-msg", "Password reset for " + row.email);
        setMsg("st-msg", "Password reset for " + row.email);
      } catch (err) {
        setMsg("st-add-msg", err.message, true);
        setMsg("st-msg", err.message, true);
      }
    });
    loadSchoolStudents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindOffice);
  } else {
    bindOffice();
  }
})();
