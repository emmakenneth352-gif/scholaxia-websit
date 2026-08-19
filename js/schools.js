(function () {
  var api = window.ScholaxiaAPI || window.api;
  if (!api) return;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function office(path, options) {
    return api.api("/api/v1/admin/school-office" + path, options || {});
  }

  function hasSession() {
    return !!(localStorage.getItem("sia_school_token") && localStorage.getItem("sia_role") === "school_admin");
  }

  function showLogin() {
    $("login-screen").classList.remove("hidden");
    $("app-screen").classList.add("hidden");
    $("sch-signed").classList.add("hidden");
  }

  function showApp() {
    $("login-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");
    $("sch-signed").classList.remove("hidden");
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
    w.document.write("<table><tr><td>Name</td><td>" + esc(row.full_name) + "</td></tr><tr><td>Class</td><td>" + esc(row.class_name) + "</td></tr><tr><td>Rec number</td><td><strong>" + esc(row.rec_number) + "</strong></td></tr><tr><td>Access code</td><td><strong>" + esc(row.access_code) + "</strong></td></tr><tr><td>Subjects</td><td>" + esc((row.subjects || []).join(", ")) + "</td></tr></table><p>Keep this slip. You need the access code and rec number on exam day.</p><script>window.print()<\/script></body></html>");
    w.document.close();
  }

  async function loadOffice() {
    try {
      var me = await office("/me");
      if (me && me.school_name) {
        localStorage.setItem("sia_school_campus", me.school_name);
        $("school-title").textContent = me.school_name;
      }
    } catch (e) {
      $("so-reg-msg").textContent = e.message || "Could not load school.";
    }
    loadCandidates();
    loadResults();
    loadExamCounts();
    loadTeachers();
  }

  async function loadCandidates() {
    var el = $("so-candidates");
    var q = ($("so-search") && $("so-search").value) || "";
    try {
      var data = await office("/candidates" + (q ? "?q=" + encodeURIComponent(q) : ""));
      var rows = (data && data.candidates) || [];
      if (!rows.length) { el.innerHTML = '<div class="empty">No registered exam students yet.</div>'; return; }
      el.innerHTML = '<table><thead><tr><th>Name</th><th>Class</th><th>Email</th><th>Rec</th><th>Access</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          return "<tr><td>" + esc(r.full_name) + "</td><td>" + esc(r.class_name) + "</td><td>" + esc(r.email || "—") +
            "</td><td>" + esc(r.rec_number) + "</td><td>" + esc(r.access_code) +
            '</td><td><button type="button" class="btn-sm" data-slip="' + esc(r.id) + '">Print slip</button></td></tr>';
        }).join("") + "</tbody></table>";
    } catch (e) {
      el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
    }
  }

  async function loadExamCounts() {
    var el = $("so-exam-counts");
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
    var qs = [];
    var cls = $("so-res-class").value.trim();
    var sub = $("so-res-subject").value.trim();
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

  document.addEventListener("DOMContentLoaded", function () {
    if (hasSession()) showApp();
    else showLogin();

    $("sch-login").addEventListener("submit", async function (e) {
      e.preventDefault();
      var err = $("login-error");
      var btn = $("btn-login");
      err.textContent = "";
      btn.disabled = true;
      try {
        if (api.wakeServer) await api.wakeServer(8000);
        var data = await api.api("/api/v1/auth/login", {
          method: "POST",
          noAuth: true,
          timeout: 45000,
          body: {
            email: $("login-email").value.trim(),
            password: $("login-password").value,
          },
        });
        if (data.role !== "school_admin") {
          err.textContent = "This login is for school admins only. Students use Sign in on the home page. Main admin uses the main admin site.";
          return;
        }
        api.saveSession(data, $("login-email").value.trim(), data.user && data.user.full_name);
        if (data.user && data.user.school_id) localStorage.setItem("sia_school_id", data.user.school_id);
        if (data.user && data.user.school_name) localStorage.setItem("sia_school_campus", data.user.school_name);
        showApp();
      } catch (ex) {
        err.textContent = ex.message || "Login failed.";
      } finally {
        btn.disabled = false;
      }
    });

    $("sch-logout").addEventListener("click", function () {
      localStorage.removeItem("sia_school_token");
      localStorage.removeItem("sia_school_campus");
      localStorage.removeItem("sia_school_id");
      if (localStorage.getItem("sia_role") === "school_admin") {
        localStorage.removeItem("sia_teacher_token");
        localStorage.removeItem("sia_role");
      }
      showLogin();
    });

    document.getElementById("sch-tabs").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      document.querySelectorAll("#sch-tabs button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      document.querySelectorAll(".tab-panel").forEach(function (p) {
        p.classList.toggle("hidden", p.id !== "tab-" + btn.getAttribute("data-tab"));
      });
    });

    $("btn-register").addEventListener("click", async function () {
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
        msg.textContent = "Registered. Rec: " + row.rec_number + " · Access: " + row.access_code;
        printSlip(row);
        loadCandidates();
      } catch (e) {
        msg.textContent = e.message;
      }
    });

    $("so-search").addEventListener("input", loadCandidates);
    $("so-candidates").addEventListener("click", async function (e) {
      var b = e.target.closest("[data-slip]");
      if (!b) return;
      try {
        printSlip(await office("/candidates/" + b.getAttribute("data-slip") + "/slip"));
      } catch (err) { alert(err.message); }
    });

    $("btn-exam").addEventListener("click", async function () {
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
        msg.textContent = "Exam saved: " + created.title + " (" + created.total_questions + " questions).";
        $("ex-questions").value = "";
        loadExamCounts();
      } catch (e) {
        msg.textContent = e.message;
      }
    });

    $("btn-results").addEventListener("click", loadResults);
    $("btn-print-results").addEventListener("click", function () { window.print(); });
    $("btn-retake").addEventListener("click", async function () {
      var msg = $("so-retake-msg");
      try {
        var data = await office("/retake", {
          method: "POST",
          body: {
            student_email: $("so-retake-email").value.trim(),
            exam_id: $("so-retake-exam").value.trim(),
          },
        });
        msg.textContent = data.message || "Retake granted.";
      } catch (e) {
        msg.textContent = e.message;
      }
    });

    $("btn-teacher").addEventListener("click", async function () {
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
        msg.textContent = "Teacher created. They can sign in on the teacher portal.";
        $("so-t-pass").value = "";
        loadTeachers();
      } catch (e) {
        msg.textContent = e.message;
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
        msg.textContent = startNow ? "Class is live." : "Class created.";
        if (startNow && created && created.id && confirm("Open classroom now?")) {
          await enterClassroom(created.id, $("so-live-title").value.trim(), $("so-live-subject").value.trim());
        }
      } catch (e) {
        msg.textContent = e.message;
      }
    }
    $("btn-live-sched").addEventListener("click", function () { hostLive(false); });
    $("btn-live-now").addEventListener("click", function () { hostLive(true); });
  });
})();
