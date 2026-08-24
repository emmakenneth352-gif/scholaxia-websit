/* Scholaxia — Student Portal
   Functional dashboard wired to the production backend via window.ScholaxiaAPI.
*/
(function () {
  "use strict";

  var api = window.ScholaxiaAPI;
  if (!api || !api.requireAuth(["student"])) return;

  /* =====================================================================
     Small utilities
     ===================================================================== */

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function errMsg(err) {
    var msg = (err && err.message) || "Something went wrong. Please try again.";
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return "Cannot reach the Scholaxia API. Wait a minute if the server is waking up, then tap Try again.";
    }
    if (/aborted|abort/i.test(msg) || (err && err.name === "AbortError")) {
      return "Server took too long. Wait 30 seconds and try again (Render may be waking up).";
    }
    // Unwrap JSON-looking detail blobs from FastAPI
    try {
      if (msg.charAt(0) === "{") {
        var parsed = JSON.parse(msg);
        if (parsed && (parsed.message || parsed.detail || parsed.code)) {
          return parsed.message || parsed.detail || msg;
        }
      }
    } catch (e) { /* ignore */ }
    if (err && err.data) {
      var d = err.data.detail || err.data.message || err.data;
      if (typeof d === "object" && d) return d.message || d.detail || JSON.stringify(d);
      if (typeof d === "string") return d;
    }
    return msg;
  }

  function isCbtPackageError(err) {
    var raw = ((err && err.message) || "") + JSON.stringify((err && err.data) || {});
    return /cbt_package|package_required|402/i.test(raw);
  }

  function loadingHtml(msg) {
    return '<div class="loading-state">' + esc(msg || "Loading…") + "</div>";
  }

  function emptyHtml(icon, msg) {
    return (
      '<div class="empty-state"><span class="empty-icon">' +
      (icon || "✨") +
      "</span><strong style=\"display:block;margin-bottom:0.35rem;color:#0f172a\">Nothing here yet</strong>" +
      esc(msg || "Check back soon.") +
      "</div>"
    );
  }

  function errorHtml(msg, retryAttr) {
    return (
      '<div class="error-state">⚠ ' +
      esc(msg || "Could not load this.") +
      (retryAttr
        ? '<br /><button type="button" data-retry="' + retryAttr + '">Try again</button>'
        : "") +
      "</div>"
    );
  }

  function setStatus(el, msg, ok) {
    if (!el) return;
    el.textContent = msg || "";
    el.className = "form-status" + (msg ? (ok ? " ok" : " err") : "");
  }

  function firstArray(data, keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]])) return data[keys[i]];
    }
    return [];
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(null, args);
      }, ms || 250);
    };
  }

  function readLocalJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeLocalJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  /* =====================================================================
     Header / identity
     ===================================================================== */

  var user = api.getUser();
  var nameEl = $("userName");
  var av = $("userAv");
  if (nameEl) nameEl.textContent = user.name;
  if (av) av.textContent = (user.name || "S").charAt(0).toUpperCase();

  var hour = new Date().getHours();
  var greet =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  var dashGreetingEl = $("dashGreeting");
  if (dashGreetingEl) {
    dashGreetingEl.textContent =
      greet + ", " + (user.name || "Student").split(" ")[0];
  }

  function refreshLocalExamBadges() {
    var examType = localStorage.getItem("sia_exam_type") || "";
    var subjects = readLocalJson("sia_subjects", []);
    if (!Array.isArray(subjects)) subjects = [];

    if ($("examPill")) $("examPill").textContent = examType ? examType.toUpperCase() : "Student";
    if ($("dashExamType")) $("dashExamType").textContent = examType ? examType.toUpperCase() : "Your exam";
    if ($("dashSubjCount"))
      $("dashSubjCount").textContent = subjects.length ? subjects.length + " subjects" : "Your subjects";
    if ($("dashFocus")) $("dashFocus").textContent = subjects.length ? subjects.slice(0, 2).join(", ") : "Set up subjects";
    if ($("dashSubjectsText"))
      $("dashSubjectsText").textContent =
        subjects.length + " subject" + (subjects.length === 1 ? "" : "s") + " selected";
    if ($("statSubjects")) $("statSubjects").textContent = String(subjects.length);
    if ($("profileExam")) $("profileExam").textContent = examType ? examType.toUpperCase() : "Not set";
    if ($("profileSubjects")) $("profileSubjects").textContent = subjects.length ? subjects.join(", ") : "None selected";
    return { examType: examType, subjects: subjects };
  }
  refreshLocalExamBadges();

  if ($("profileText")) {
    $("profileText").textContent = user.name + " · " + user.email + " · Student";
  }

  var logoutBtn = $("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      api.clearSession();
      window.location.href = "auth.html";
    });
  }

  /* =====================================================================
     Navigation / lazy page loading
     ===================================================================== */

  var PAGE_TITLES = {
    home: "Home",
    "study-materials": "Video Tutorials",
    "past-questions": "Past Questions",
    cbt: "CBT Practice",
    school: "Scholaxia Exam",
    "access-code": "Live Class",
    live: "Live Class",
    "school-portal": "Examinations",
    subscription: "Subscription",
    skills: "Skills",
    library: "Library",
    assignments: "Assignments",
    sia: "Tutor AI",
    community: "Community",
    groups: "Groups",
    saved: "Saved",
    about: "About",
    contact: "Contact",
    profile: "Profile",
  };

  var loadedPages = {};

  var PAGE_LOADERS = {
    home: loadHome,
    "study-materials": loadStudyMaterials,
    "past-questions": loadPastQuestions,
    cbt: loadCbt,
    school: loadSchoolExams,
    "access-code": function () { showPage("live"); },
    live: loadLive,
    "school-portal": loadSchoolPortal,
    subscription: loadSubscription,
    skills: loadSkills,
    library: loadLibrary,
    assignments: loadAssignments,
    community: loadCommunity,
    groups: loadGroups,
    saved: loadSaved,
    profile: loadProfile,
  };

  var pageHistory = [];
  var currentPageId = "home";

  function showPage(id, opts) {
    opts = opts || {};
    if (id === "access-code") id = "live";
    if (!PAGE_TITLES.hasOwnProperty(id)) id = "home";

    if (!opts.replace && currentPageId && currentPageId !== id) {
      pageHistory.push(currentPageId);
      if (pageHistory.length > 20) pageHistory = pageHistory.slice(-20);
    }
    currentPageId = id;

    document.querySelectorAll(".page").forEach(function (p) {
      p.classList.toggle("is-on", p.id === "page-" + id);
    });
    document.querySelectorAll(".side-link").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.page === id || (id === "live" && b.dataset.page === "live"));
    });
    if ($("pageTitle")) $("pageTitle").textContent = PAGE_TITLES[id] || "";
    var main = document.querySelector(".app-content");
    if (main) main.scrollTop = 0;

    updateBackBtn();

    if (!loadedPages[id] && PAGE_LOADERS[id]) {
      loadedPages[id] = true;
      try {
        PAGE_LOADERS[id]();
      } catch (e) {
        console.error("Page load failed for", id, e);
      }
    }
  }

  function updateBackBtn() {
    var btn = $("backBtn");
    if (!btn) return;
    var show = currentPageId !== "home";
    btn.hidden = !show;
    btn.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function goBack() {
    var prev = null;
    while (pageHistory.length) {
      prev = pageHistory.pop();
      if (prev && prev !== currentPageId) break;
      prev = null;
    }
    showPage(prev || "home", { replace: true });
  }

  document.querySelectorAll(".side-link, [data-goto]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var page = el.dataset.page || el.dataset.goto;
      if (page) {
        showPage(page);
        if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
      }
    });
  });

  // Capture-phase fallback so mobile taps on icons/text still switch pages
  var sideNav = document.querySelector(".student-side");
  if (sideNav) {
    sideNav.addEventListener(
      "click",
      function (e) {
        var btn = e.target.closest(".side-link, [data-goto]");
        if (!btn) return;
        var page = btn.getAttribute("data-page") || btn.getAttribute("data-goto");
        if (!page) return;
        e.preventDefault();
        e.stopPropagation();
        showPage(page);
        if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
      },
      true
    );
  }

  document.addEventListener("click", function (e) {
    var retryBtn = e.target.closest("[data-retry]");
    if (retryBtn) {
      var page = retryBtn.dataset.retry;
      loadedPages[page] = false;
      examsCacheByKind = {};
      examsForMeCache = null;
      var go = function () {
        if (PAGE_LOADERS[page]) PAGE_LOADERS[page]();
      };
      if (api.wakeServer) {
        retryBtn.disabled = true;
        retryBtn.textContent = "Waking server…";
        api
          .wakeServer(60000)
          .catch(function () { return null; })
          .then(go)
          .finally(function () {
            retryBtn.disabled = false;
            retryBtn.textContent = "Try again";
          });
      } else {
        go();
      }
      return;
    }
    var refreshBtn = e.target.closest("[data-refresh]");
    if (refreshBtn) {
      var p2 = refreshBtn.dataset.refresh;
      loadedPages[p2] = false;
      if (PAGE_LOADERS[p2]) PAGE_LOADERS[p2]();
    }
  });

  /* =====================================================================
     HOME
     ===================================================================== */

  function renderLiveCardMini(c) {
    var title = c.title || c.topic || c.subject || "Live class";
    var teacher = c.teacher_name || c.host_name || c.teacher || "";
    return (
      '<div class="card">' +
      '<span class="card-tag">🔴 LIVE</span>' +
      "<h4>" +
      esc(title) +
      "</h4>" +
      (teacher ? '<p class="muted">' + esc(teacher) + "</p>" : "") +
      '<div class="card-foot"><button type="button" class="btn btn-primary btn-mini" data-goto="live">Join now</button></div>' +
      "</div>"
    );
  }

  function loadHome() {
    api
      .api("/api/v1/students/me")
      .then(function (me) {
        if (!me) return;
        var name = me.full_name || me.name || user.name;
        if (nameEl && name) nameEl.textContent = name;
        if (av && name) av.textContent = String(name).charAt(0).toUpperCase();
        if (dashGreetingEl && name) {
          dashGreetingEl.textContent = greet + ", " + String(name).split(" ")[0];
        }
        if (me.exam_type) localStorage.setItem("sia_exam_type", me.exam_type);
        if (Array.isArray(me.subjects)) writeLocalJson("sia_subjects", me.subjects);
        refreshLocalExamBadges();
      })
      .catch(function () {});

    api
      .api("/api/v1/live-classes/?status=live")
      .then(function (data) {
        var items = firstArray(data, ["classes", "items", "results", "live_classes"]);
        if ($("statLive")) $("statLive").textContent = String(items.length || 0);
        var wrap = $("homeLiveNow");
        var titleWrap = $("homeLiveNowTitle");
        if (!wrap) return;
        if (!items.length) {
          wrap.innerHTML = "";
          if (titleWrap) titleWrap.style.display = "none";
          return;
        }
        if (titleWrap) titleWrap.style.display = "flex";
        wrap.innerHTML = items.slice(0, 3).map(renderLiveCardMini).join("");
      })
      .catch(function () {
        if ($("statLive")) $("statLive").textContent = "0";
      });

    api
      .api("/api/v1/cbt/exams/for-me")
      .then(function (data) {
        data = data || {};
        var count =
          (data.practice_exams || []).length +
          (data.jamb_exams || []).length +
          (data.ssce_exams || []).length +
          (data.school_exams || []).length;
        if ($("statExams")) $("statExams").textContent = String(count);
        cacheExamsForMe(data);
      })
      .catch(function () {
        if ($("statExams")) $("statExams").textContent = "—";
      });
  }

  /* =====================================================================
     STUDY MATERIALS  — recommendations feed
     ===================================================================== */

  function youtubeEmbed(url) {
    var u = String(url || "").trim();
    var m = u.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{6,})/);
    if (m) return "https://www.youtube.com/embed/" + m[1];
    return u;
  }

  function loadStudyMaterials() {
    var wrap = $("studyMaterialsList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading video tutorials…");
    api
      .api("/api/v1/videos")
      .then(function (data) {
        var items = firstArray(data, ["videos", "items", "results"]);
        if (!items.length) {
          wrap.innerHTML = emptyHtml("▶", "No video tutorials yet. Admin will post YouTube lessons here.");
          return;
        }
        wrap.innerHTML = items
          .map(function (it) {
            var src = youtubeEmbed(it.video_url || it.url || "");
            return (
              '<div class="card">' +
              '<span class="card-tag">' +
              esc(it.subject || "Tutorial") +
              "</span><h4>" +
              esc(it.title || "Video") +
              "</h4>" +
              (src
                ? '<div class="video-frame"><iframe src="' +
                  esc(src) +
                  '" title="' +
                  esc(it.title || "Video") +
                  '" allowfullscreen loading="lazy"></iframe></div>'
                : "") +
              "</div>"
            );
          })
          .join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "study-materials");
      });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("#libReaderClose")) {
      closeLibraryReader();
      return;
    }
    var openBtn = e.target.closest("[data-open-book]");
    if (openBtn) openLibraryRead(openBtn.dataset.openBook, openBtn);
    var dlBtn = e.target.closest("[data-download-book]");
    if (dlBtn) downloadLibraryPdf(dlBtn.dataset.downloadBook, dlBtn);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLibraryReader();
  });

  var libReaderTask = 0;

  function closeLibraryReader() {
    libReaderTask += 1;
    var overlay = $("libReader");
    var pages = $("libReaderPages");
    if (overlay) overlay.hidden = true;
    if (pages) pages.innerHTML = "";
  }

  function loadPdfJs() {
    return new Promise(function (resolve, reject) {
      if (window.pdfjsLib) {
        resolve(window.pdfjsLib);
        return;
      }
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = function () {
        if (!window.pdfjsLib) {
          reject(new Error("PDF reader failed to load"));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = function () {
        reject(new Error("Could not load the PDF reader. Check your connection."));
      };
      document.head.appendChild(s);
    });
  }

  async function renderPdfPages(bytes, taskId) {
    var pages = $("libReaderPages");
    if (!pages) return;
    pages.innerHTML = '<p class="lib-reader-status">Opening pages…</p>';
    var pdfjs = await loadPdfJs();
    if (taskId !== libReaderTask) return;
    var pdf = await pdfjs.getDocument({ data: bytes }).promise;
    if (taskId !== libReaderTask) return;
    pages.innerHTML = "";
    var maxW = Math.max(280, pages.clientWidth - 16);
    for (var n = 1; n <= pdf.numPages; n++) {
      if (taskId !== libReaderTask) return;
      var page = await pdf.getPage(n);
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(1.6, maxW / base.width);
      var viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      var canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = Math.floor(base.width * scale) + "px";
      pages.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    }
  }

  async function fetchLibraryPdf(id) {
    var token = api.getToken();
    var res = await fetch(api.API_BASE + "/api/v1/library/" + encodeURIComponent(id) + "/file", {
      headers: { Authorization: "Bearer " + token, Accept: "application/pdf" },
      credentials: "omit",
      cache: "no-store",
      signal: api.fetchTimeout ? api.fetchTimeout(120000) : undefined,
    });
    if (res.status === 402) throw new Error("Pay to unlock this material.");
    if (!res.ok) {
      var data = await res.json().catch(function () { return {}; });
      var detail = data && data.detail;
      if (typeof detail === "object") detail = JSON.stringify(detail);
      throw new Error(detail || "Could not open this material (" + res.status + ")");
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  function isLibraryDownloadable(it) {
    if (!it) return false;
    if (it.is_downloadable === true) return true;
    return !!(it.drm && it.drm.is_downloadable);
  }

  async function downloadLibraryPdf(id, btn) {
    if (!id) return;
    var prev = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    try {
      var token = api.getToken();
      var res = await fetch(
        api.API_BASE + "/api/v1/library/" + encodeURIComponent(id) + "/file?download=1",
        {
          headers: { Authorization: "Bearer " + token, Accept: "application/pdf" },
          credentials: "omit",
          cache: "no-store",
          signal: api.fetchTimeout ? api.fetchTimeout(120000) : undefined,
        }
      );
      if (res.status === 402) throw new Error("Pay to unlock this material.");
      if (res.status === 403) throw new Error("This file is not downloadable.");
      if (!res.ok) {
        var data = await res.json().catch(function () { return {}; });
        var detail = data && data.detail;
        if (typeof detail === "object") detail = JSON.stringify(detail);
        throw new Error(detail || "Could not download this material.");
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "scholaxia-material.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (err) {
      alert(err && err.message ? err.message : "Download failed.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "Download";
      }
    }
  }

  function openLibraryRead(id, btn) {
    if (!id) return;
    var prevText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Opening…";
    }
    var reset = function () {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = prevText || "Read";
    };
    var title = "";
    if (btn && btn.closest(".card")) {
      var h = btn.closest(".card").querySelector("h4");
      title = (h && h.textContent) || "";
    }
    var overlay = $("libReader");
    var titleEl = $("libReaderTitle");
    var pages = $("libReaderPages");
    if (titleEl) titleEl.textContent = title || "Reading";
    if (pages) pages.innerHTML = '<p class="lib-reader-status">Loading PDF…</p>';
    if (overlay) overlay.hidden = false;
    var taskId = ++libReaderTask;
    fetchLibraryPdf(id)
      .then(function (bytes) {
        if (taskId !== libReaderTask) return;
        return renderPdfPages(bytes, taskId);
      })
      .then(function () { reset(); })
      .catch(function (err) {
        if (pages) {
          pages.innerHTML =
            '<p class="lib-reader-status">' + esc(errMsg(err) || "Could not open this PDF on this phone.") + "</p>";
        } else {
          alert("Could not open resource: " + errMsg(err));
        }
        reset();
      });
  }

  /* =====================================================================
     PAST QUESTIONS — timed CBT papers (not library PDFs, not CBT Practice)
     ===================================================================== */

  var pastQuestionsCache = null;
  var pqActiveCat = "all";

  function loadPastQuestions() {
    var wrap = $("pastQuestionsList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading past question papers…");
    fetchExamsForMe("past_questions")
      .then(function (data) {
        var seen = {};
        pastQuestionsCache = []
          .concat((data && data.practice_exams) || [])
          .concat((data && data.jamb_exams) || [])
          .concat((data && data.ssce_exams) || [])
          .filter(function (exam) {
            var id = exam && (exam.id || exam.exam_id);
            if (!id || seen[id]) return false;
            seen[id] = true;
            return true;
          });
        renderPastQuestions();
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "past-questions");
      });
  }

  function renderPastQuestions() {
    var wrap = $("pastQuestionsList");
    if (!wrap || !pastQuestionsCache) return;
    var items = pastQuestionsCache;
    if (pqActiveCat !== "all") {
      items = items.filter(function (it) {
        var hay = ((it.exam_type || "") + " " + (it.title || "") + " " + (it.subject || "")).toLowerCase();
        return hay.indexOf(pqActiveCat) > -1 || (pqActiveCat === "post" && hay.indexOf("utme") > -1);
      });
    }
    if (!items.length) {
      wrap.innerHTML = emptyHtml(
        "📄",
        "No past-question papers yet. Admin uploads them under the Past Questions tab. You sit them here as timed CBT — not as library PDFs, and not mixed with CBT Practice."
      );
      return;
    }
    wrap.innerHTML = items
      .map(function (exam) {
        return renderExamCard(exam, { badge: exam.exam_type || "PAST" });
      })
      .join("");
  }

  var pqTabs = $("pqFilterTabs");
  if (pqTabs) {
    pqTabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".tab");
      if (!btn) return;
      pqTabs.querySelectorAll(".tab").forEach(function (t) {
        t.classList.toggle("is-active", t === btn);
      });
      pqActiveCat = btn.dataset.cat;
      renderPastQuestions();
    });
  }

  function renderLibraryCard(it) {
    var title = it.title || it.name || "Resource";
    var cat = it.category || it.type || "Library";
    var desc = it.description || it.subject || "";
    var price = Number(it.price || 0);
    var hasAccess = !!(it.has_access || it.is_free || price <= 0);
    var canDownload = isLibraryDownloadable(it);
    var foot;
    if (hasAccess) {
      foot =
        '<button type="button" class="btn btn-primary btn-mini" data-open-book="' +
        esc(it.id) +
        '">Read</button>';
      if (canDownload) {
        foot +=
          '<button type="button" class="btn btn-secondary btn-mini" data-download-book="' +
          esc(it.id) +
          '">Download</button>';
      }
    } else {
      foot =
        "<strong>₦" +
        price.toLocaleString("en-NG") +
        '</strong><button type="button" class="btn btn-primary btn-mini" data-pay-type="library_book" data-pay-id="' +
        esc(it.id) +
        '">Pay with Paystack</button>';
    }
    return (
      '<div class="card">' +
      '<span class="card-tag">' +
      esc(cat) +
      "</span>" +
      (canDownload ? '<span class="card-tag is-downloadable">Downloadable</span>' : "") +
      "<h4>" +
      esc(title) +
      "</h4>" +
      (desc ? "<p>" + esc(desc) + "</p>" : "") +
      '<div class="card-foot">' +
      foot +
      "</div></div>"
    );
  }

  /* =====================================================================
     LIBRARY — full list with search / category filter
     ===================================================================== */

  var libraryCache = [];

  function loadLibrary() {
    var wrap = $("libraryGrid");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading library…");
    api
      .api("/api/v1/library/student")
      .then(function (data) {
        libraryCache = firstArray(data, ["items", "results", "library"]);
        var cats = Array.from(
          new Set(libraryCache.map(function (it) { return it.category || it.type; }).filter(Boolean))
        );
        var sel = $("libFilter");
        if (sel) {
          sel.innerHTML =
            '<option value="">All categories</option>' +
            cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
        }
        renderLibrary();
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "library");
      });
  }

  function renderLibrary() {
    var wrap = $("libraryGrid");
    if (!wrap) return;
    var q = ($("libSearch") && $("libSearch").value || "").toLowerCase().trim();
    var cat = ($("libFilter") && $("libFilter").value) || "";
    var items = libraryCache.filter(function (it) {
      if (cat && (it.category || it.type) !== cat) return false;
      if (q) {
        var hay = ((it.title || "") + " " + (it.description || "") + " " + (it.subject || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (!items.length) {
      wrap.innerHTML = emptyHtml("📚", "No library resources match your search.");
      return;
    }
    wrap.innerHTML = items.map(renderLibraryCard).join("");
  }

  if ($("libSearch")) $("libSearch").addEventListener("input", debounce(renderLibrary, 200));
  if ($("libFilter")) $("libFilter").addEventListener("change", renderLibrary);

  /* =====================================================================
     Exam data cache + shared exam engine (CBT / School / External)
     ===================================================================== */

  var examsForMeCache = null;

  var examsCacheByKind = {};

  function cacheExamsForMe(data) {
    examsForMeCache = data || {};
    examsCacheByKind.cbt_practice = examsForMeCache;
  }

  function bucketPublicExams(rows) {
    var jamb = [];
    var ssce = [];
    var practice = [];
    var school = [];
    (rows || []).forEach(function (e) {
      if (e.is_school_exam) {
        school.push(e);
        return;
      }
      var t = String(e.exam_type || "").toUpperCase();
      if (t.indexOf("JAMB") >= 0 || t.indexOf("UTME") >= 0) jamb.push(e);
      else if (
        t.indexOf("WAEC") >= 0 ||
        t.indexOf("NECO") >= 0 ||
        t.indexOf("JUNIOR") >= 0 ||
        t.indexOf("COMMON") >= 0
      ) {
        ssce.push(e);
      } else {
        practice.push(e);
      }
    });
    return {
      practice_exams: practice.concat(jamb, ssce),
      jamb_exams: jamb,
      ssce_exams: ssce,
      school_exams: school,
      boards: [].concat(jamb.length ? ["JAMB"] : [], ssce.length ? ["WAEC_NECO"] : []),
      _fallback: true,
    };
  }

  function fetchExamsForMe(paperKind) {
    paperKind = paperKind || "cbt_practice";
    if (examsCacheByKind[paperKind]) return Promise.resolve(examsCacheByKind[paperKind]);
    return api
      .api("/api/v1/cbt/exams/for-me?paper_kind=" + encodeURIComponent(paperKind), {
        timeout: 60000,
        retries: 3,
      })
      .then(function (data) {
        examsCacheByKind[paperKind] = data || {};
        if (paperKind === "cbt_practice") examsForMeCache = examsCacheByKind[paperKind];
        return examsCacheByKind[paperKind];
      })
      .catch(function (err) {
        // Fallback: public published list so Practice / Past Questions still show something
        return api
          .api(
            "/api/v1/cbt/exams?paper_kind=" + encodeURIComponent(paperKind),
            { timeout: 60000, retries: 2, noAuth: false }
          )
          .then(function (rows) {
            var data = bucketPublicExams(Array.isArray(rows) ? rows : []);
            examsCacheByKind[paperKind] = data;
            if (paperKind === "cbt_practice") examsForMeCache = data;
            return data;
          })
          .catch(function () {
            throw err;
          });
      });
  }

  function packKey(id, isExternal) {
    return isExternal ? "sia_cbt_pack_ext_" + id : "sia_cbt_pack_" + id;
  }

  function getPack(id, isExternal) {
    return readLocalJson(packKey(id, isExternal), null);
  }

  function setPack(id, isExternal, data) {
    writeLocalJson(packKey(id, isExternal), data);
  }

  function examMinutes(exam) {
    return exam.duration_minutes || exam.duration || exam.time_limit || 20;
  }

  function renderExamCard(exam, opts) {
    opts = opts || {};
    var id = exam.id || exam.exam_id;
    var title = exam.title || exam.name || exam.subject || "Exam";
    var subject = exam.subject || "";
    var year = exam.year || "";
    var qCount = exam.total_questions || exam.question_count || (exam.questions && exam.questions.length) || "";
    var hasPack = !!getPack(id, opts.isExternal);
    var badge = opts.badge || (exam.board ? exam.board.toUpperCase() : "EXAM");
    return (
      '<div class="card" data-exam-card="' +
      esc(id) +
      '">' +
      '<span class="card-tag">' +
      esc(badge) +
      "</span><h4>" +
      esc(title) +
      "</h4>" +
      '<p style="margin:0;color:#64748b;font-size:0.84rem;line-height:1.4">Timed CBT session ready when you are.</p>' +
      '<div class="card-meta-row">' +
      (subject ? "<span>" + esc(subject) + "</span>" : "") +
      (year ? "<span>" + esc(year) + "</span>" : "") +
      (qCount ? "<span>" + esc(qCount) + " Qs</span>" : "") +
      "<span>" + esc(examMinutes(exam)) + " mins</span>" +
      "</div>" +
      '<div class="card-foot">' +
      '<button type="button" class="btn btn-secondary btn-mini' +
      (hasPack ? " is-done" : "") +
      '" data-action="download" data-exam-id="' +
      esc(id) +
      '" data-external="' +
      (opts.isExternal ? "1" : "0") +
      '">' +
      (hasPack ? "Downloaded ✓" : "Download") +
      "</button>" +
      '<button type="button" class="btn btn-primary btn-mini" data-action="start" data-exam-id="' +
      esc(id) +
      '" data-external="' +
      (opts.isExternal ? "1" : "0") +
      '" data-school="' +
      (opts.isSchool ? "1" : "0") +
      '">Start exam</button>' +
      "</div></div>"
    );
  }

  function findExamById(list, id) {
    return (list || []).filter(function (e) { return String(e.id || e.exam_id) === String(id); })[0];
  }

  var cbtUnlockAfter = null;
  var cbtUnlockOpenedAt = 0;
  var startExamLock = false;

  function resetCbtUnlockModal() {
    if ($("cbtUnlockChoice")) $("cbtUnlockChoice").hidden = false;
    if ($("cbtUnlockCoupon")) $("cbtUnlockCoupon").hidden = true;
    if ($("cbtUnlockPay")) $("cbtUnlockPay").hidden = true;
    if ($("cbtUnlockStatus")) {
      $("cbtUnlockStatus").textContent = "";
      $("cbtUnlockStatus").className = "form-status";
    }
    if ($("cbtUnlockCode")) $("cbtUnlockCode").value = "";
  }

  function closeCbtUnlockModal(force) {
    // Ignore the same tap that opened the modal (common on phones)
    if (!force && cbtUnlockOpenedAt && Date.now() - cbtUnlockOpenedAt < 700) return;
    cbtUnlockOpenedAt = 0;
    var modal = $("cbtUnlockModal");
    if (modal) modal.classList.remove("is-on");
    cbtUnlockAfter = null;
    resetCbtUnlockModal();
  }

  function openCbtUnlockModal(afterUnlock) {
    cbtUnlockAfter = afterUnlock;
    resetCbtUnlockModal();
    var modal = $("cbtUnlockModal");
    if (!modal) {
      if (confirm("CBT package required. Open CBT packages to pay?")) showPage("cbt");
      return;
    }
    // Defer show so the Start click cannot hit the new overlay and instantly close it
    cbtUnlockOpenedAt = Date.now();
    setTimeout(function () {
      cbtUnlockOpenedAt = Date.now();
      modal.classList.add("is-on");
    }, 60);
  }

  function loadCbtUnlockPackages() {
    var list = $("cbtUnlockPayList");
    if (!list) return;
    list.innerHTML = loadingHtml("Loading packages…");
    api.api("/api/v1/payments/paystack/cbt-packages").then(function (catalog) {
      var packages = firstArray(catalog, ["packages", "items"]);
      if (!packages.length) {
        list.innerHTML = emptyHtml("📝", "No CBT packages listed yet.");
        return;
      }
      list.innerHTML = packages.map(function (p) {
        var id = p.id || p.package_id;
        var price = Number(p.price || p.amount || 0);
        return (
          '<div class="card-foot" style="margin-bottom:8px">' +
          "<strong>" + esc(p.name || p.title || id) + " · ₦" + price.toLocaleString("en-NG") + "</strong>" +
          '<button type="button" class="btn btn-primary btn-mini" data-pay-type="cbt_package" data-pay-id="' +
          esc(id) +
          '">Pay</button></div>'
        );
      }).join("");
    }).catch(function (err) {
      list.innerHTML = errorHtml(errMsg(err));
    });
  }

  // Delegated handlers for exam cards (download / start) across cbt / school / school-portal
  document.addEventListener("click", function (e) {
    var openSchool = e.target.closest("[data-open-school-exam]");
    if (openSchool) {
      window.location.href = "exam.html?exam=" + encodeURIComponent(openSchool.getAttribute("data-open-school-exam"));
      return;
    }
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.dataset.action;
    var examId = btn.dataset.examId;
    var isExternal = btn.dataset.external === "1";
    var isSchool = btn.dataset.school === "1";
    if (action === "download") downloadExam(examId, isExternal, btn);
    if (action === "start") startExamFlow(examId, isExternal, isSchool, btn);
  });

  function currentExamSourceList() {
    var list = []
      .concat(examsForMeCache ? examsForMeCache.practice_exams || [] : [])
      .concat(examsForMeCache ? examsForMeCache.jamb_exams || [] : [])
      .concat(examsForMeCache ? examsForMeCache.ssce_exams || [] : [])
      .concat(examsForMeCache ? examsForMeCache.school_exams || [] : [])
      .concat(externalExamsCache || []);
    return list;
  }

  function downloadExam(examId, isExternal, btn) {
    var base = isExternal ? "/api/v1/cbt/external-exams/" : "/api/v1/cbt/exams/";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Downloading…";
    }
    api
      .api(base + examId + "/download")
      .then(function (data) {
        setPack(examId, isExternal, data);
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Downloaded ✓";
          btn.classList.add("is-done");
        }
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Download";
        }
        if (isCbtPackageError(err)) {
          openCbtUnlockModal(function () { downloadExam(examId, isExternal, btn); });
          return;
        }
        alert("Download failed: " + errMsg(err));
      });
  }

  function startExamFlow(examId, isExternal, isSchool, btn) {
    if (startExamLock) return;
    startExamLock = true;
    var exam = findExamById(currentExamSourceList(), examId) || {};

    function unlockStart() {
      startExamLock = false;
    }

    function launchWithPack(pack) {
      var title = exam.title || exam.name || (pack && (pack.title || pack.name)) || "Exam";

      if (isExternal) {
        unlockStart();
        openExam({
          examId: examId,
          title: title,
          pack: pack,
          isExternal: true,
        });
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = "Starting…";
      }
      api
        .api("/api/v1/cbt/sessions/" + examId + "/start", {
          method: "POST",
          body: { is_school: !!isSchool },
        })
        .then(function (res) {
          var sessionId =
            (res && (res.session_id || res.id || (res.session && res.session.id))) || null;
          var questions = (res && (res.questions || (res.session && res.session.questions))) || null;
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          unlockStart();
          openExam({
            examId: examId,
            title: title,
            pack: questions ? { questions: questions, duration_minutes: examMinutes(exam) } : pack,
            sessionId: sessionId,
            isSchool: isSchool,
          });
        })
        .catch(function (err) {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          if (typeof isCbtPackageError === "function" && isCbtPackageError(err)) {
            unlockStart();
            openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
            return;
          }
          unlockStart();
          // Offline pack is enough to sit the paper if session start fails for other reasons
          openExam({ examId: examId, title: title, pack: pack, isSchool: isSchool });
        });
    }

    function ensurePackThenLaunch(retried) {
      var pack = getPack(examId, isExternal);
      if (pack) {
        launchWithPack(pack);
        return;
      }
      // Download is optional for the student — Start loads the paper automatically
      var base = isExternal ? "/api/v1/cbt/external-exams/" : "/api/v1/cbt/exams/";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Loading…";
      }
      api
        .api(base + examId + "/download", { timeout: 90000, retries: 2 })
        .then(function (data) {
          setPack(examId, isExternal, data);
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          launchWithPack(data);
        })
        .catch(function (err) {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Start exam";
          }
          // After coupon redeem, first download can race the DB commit — retry once
          var justUnlocked = 0;
          try { justUnlocked = Number(sessionStorage.getItem("sia_cbt_just_unlocked") || 0); } catch (e) {}
          if (!retried && isCbtPackageError(err) && justUnlocked && Date.now() - justUnlocked < 120000) {
            setTimeout(function () { ensurePackThenLaunch(true); }, 700);
            return;
          }
          unlockStart();
          if (isCbtPackageError(err)) {
            var boardHint = "";
            try {
              var d = err && err.data && err.data.detail;
              if (d && d.board) boardHint = " This exam needs " + d.board + " access.";
            } catch (e2) {}
            if (justUnlocked && Date.now() - justUnlocked < 120000) {
              alert(
                "Coupon saved, but this exam board is not in your package." +
                  boardHint +
                  " Open an exam that matches your coupon, or pay for the right package."
              );
            }
            openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
            return;
          }
          alert("Could not open this exam: " + errMsg(err));
        });
    }

    if (isSchool || isExternal) {
      ensurePackThenLaunch(false);
      return;
    }
    // If coupon was just redeemed on this device, skip the unlock popup
    var justUnlockedAt = 0;
    try { justUnlockedAt = Number(sessionStorage.getItem("sia_cbt_just_unlocked") || 0); } catch (e3) {}
    if (justUnlockedAt && Date.now() - justUnlockedAt < 120000) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Start exam";
      }
      ensurePackThenLaunch(false);
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Checking…";
    }
    api
      .api("/api/v1/payments/paystack/cbt-access", { timeout: 25000, retries: 1 })
      .then(function (access) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Start exam";
        }
        if (access && access.has_access) {
          try { sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now())); } catch (e4) {}
          ensurePackThenLaunch(false);
        } else {
          unlockStart();
          openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
        }
      })
      .catch(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Start exam";
        }
        unlockStart();
        openCbtUnlockModal(function () { ensurePackThenLaunch(false); });
      });
  }

  /* ---------- Exam runner ---------- */

  var Exam = { current: null };

  function normalizeQuestions(raw) {
    return (raw || []).map(function (q, i) {
      var options = [];
      if (q.options && typeof q.options === "object" && !Array.isArray(q.options)) {
        ["A", "B", "C", "D", "E"].forEach(function (k) {
          if (q.options[k] != null && q.options[k] !== "") options.push({ key: k, text: q.options[k] });
        });
      } else if (Array.isArray(q.options)) {
        var letters = ["A", "B", "C", "D", "E"];
        q.options.forEach(function (opt, idx) {
          var text = typeof opt === "string" ? opt : opt.text || opt.label || opt.value || "";
          var key =
            typeof opt === "object" && opt && opt.key
              ? String(opt.key).toUpperCase()
              : letters[idx] || String(idx);
          if (text) options.push({ key: key, text: text });
        });
      } else {
        ["a", "b", "c", "d", "e"].forEach(function (l) {
          var field = "option_" + l;
          if (q[field] != null && q[field] !== "") options.push({ key: l.toUpperCase(), text: q[field] });
        });
      }
      var correct = q.correct_answer || q.correct_option || q.answer || q.correct || null;
      if (correct != null) correct = String(correct).trim().charAt(0).toUpperCase();
      return {
        id: String(q.id || q.question_id || q._id || i),
        text: q.question || q.text || q.title || q.question_text || "Question " + (i + 1),
        options: options,
        correct: correct,
      };
    });
  }

  function openExam(opts) {
    var pack = opts.pack || {};
    var rawQuestions = Array.isArray(pack) ? pack : pack.questions || pack.data || pack.items || [];
    var questions = normalizeQuestions(rawQuestions);
    if (!questions.length) {
      alert("No questions were found in this exam pack.");
      return;
    }
    Exam.current = {
      examId: opts.examId,
      title: opts.title || "Exam",
      questions: questions,
      answers: {},
      sessionId: opts.sessionId || null,
      isExternal: !!opts.isExternal,
      isSchool: !!opts.isSchool,
      index: 0,
      remainingSec: examMinutes(pack) * 60,
      timerId: null,
    };
    renderExamNav();
    renderExamQuestion();
    $("examTitle").textContent = Exam.current.title;
    $("examSub").textContent =
      (Exam.current.isExternal ? "External exam" : Exam.current.isSchool ? "Scholaxia exam" : "CBT practice") +
      " · " +
      questions.length +
      " questions";
    var bar = $("examSectionBar");
    if (bar) bar.hidden = true;
    var chooser = $("examSectionChooser");
    if (chooser) chooser.hidden = true;
    var body = $("examBody");
    if (body) body.hidden = false;
    $("exam-screen").classList.add("is-on");
    startExamTimer();
  }

  function startExamTimer() {
    stopExamTimer();
    updateTimerDisplay();
    Exam.current.timerId = setInterval(function () {
      if (!Exam.current) return;
      Exam.current.remainingSec -= 1;
      updateTimerDisplay();
      if (Exam.current.remainingSec <= 0) {
        stopExamTimer();
        submitExam(true);
      }
    }, 1000);
  }

  function stopExamTimer() {
    if (Exam.current && Exam.current.timerId) {
      clearInterval(Exam.current.timerId);
      Exam.current.timerId = null;
    }
  }

  function updateTimerDisplay() {
    var el = $("examTimer");
    if (!el || !Exam.current) return;
    var s = Math.max(0, Exam.current.remainingSec);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    el.textContent = (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
    el.classList.toggle("is-low", s <= 60);
  }

  function renderExamNav() {
    var nav = $("examQuestionNav");
    if (!nav || !Exam.current) return;
    nav.innerHTML = Exam.current.questions
      .map(function (q, i) {
        var cls = "";
        if (i === Exam.current.index) cls = "is-current";
        else if (Exam.current.answers[q.id]) cls = "is-answered";
        return (
          '<button type="button" data-goto-q="' + i + '" class="' + cls + '">' + (i + 1) + "</button>"
        );
      })
      .join("");
  }

  function renderExamQuestion() {
    var st = Exam.current;
    if (!st) return;
    var q = st.questions[st.index];
    $("examQCount").textContent = "Question " + (st.index + 1) + " of " + st.questions.length;
    $("examQuestionText").textContent = q.text;
    var selected = st.answers[q.id];
    $("examOptions").innerHTML = q.options
      .map(function (opt) {
        return (
          '<button type="button" class="exam-option' +
          (selected === opt.key ? " is-selected" : "") +
          '" data-opt-key="' +
          esc(opt.key) +
          '"><span class="opt-key">' +
          esc(opt.key) +
          "</span><span>" +
          esc(opt.text) +
          "</span></button>"
        );
      })
      .join("");
    $("examPrevBtn").disabled = st.index === 0;
    $("examNextBtn").textContent = st.index === st.questions.length - 1 ? "Finish" : "Next →";
    renderExamNav();
  }

  var examOptionsEl = $("examOptions");
  if (examOptionsEl) {
    examOptionsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".exam-option");
      if (!btn || !Exam.current) return;
      var q = Exam.current.questions[Exam.current.index];
      Exam.current.answers[q.id] = btn.dataset.optKey;
      renderExamQuestion();
      if (Exam.current.isPractice) {
        renderPracticeSectionTabs();
        savePracticeAnswers();
      }
    });
  }

  var examNavEl = $("examQuestionNav");
  if (examNavEl) {
    examNavEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-goto-q]");
      if (!btn || !Exam.current) return;
      Exam.current.index = parseInt(btn.dataset.gotoQ, 10) || 0;
      renderExamQuestion();
    });
  }

  if ($("examPrevBtn")) {
    $("examPrevBtn").addEventListener("click", function () {
      if (!Exam.current) return;
      Exam.current.index = Math.max(0, Exam.current.index - 1);
      renderExamQuestion();
    });
  }

  if ($("examNextBtn")) {
    $("examNextBtn").addEventListener("click", function () {
      if (!Exam.current) return;
      if (Exam.current.index >= Exam.current.questions.length - 1) {
        if (Exam.current.isPractice) {
          advanceOrSubmitPracticeSection();
        } else {
          confirmSubmitExam();
        }
      } else {
        Exam.current.index += 1;
        renderExamQuestion();
      }
    });
  }

  if ($("examSubmitBtn")) {
    $("examSubmitBtn").addEventListener("click", confirmSubmitExam);
  }

  if ($("examQuitBtn")) {
    $("examQuitBtn").addEventListener("click", function () {
      if (!Exam.current) return;
      if (Exam.current.isPractice) {
        if (!confirm("Leave this CBT? Your answers will be saved so you can resume later.")) return;
        savePracticeAnswers(function () {
          stopExamTimer();
          Exam.current = null;
          $("exam-screen").classList.remove("is-on");
        });
        return;
      }
      if (confirm("Quit this exam? Your progress will be lost.")) {
        stopExamTimer();
        Exam.current = null;
        $("exam-screen").classList.remove("is-on");
      }
    });
  }

  function confirmSubmitExam() {
    if (!Exam.current) return;
    var answered = Object.keys(Exam.current.answers).length;
    var total = Exam.current.questions.length;
    if (answered < total) {
      if (!confirm("You have answered " + answered + " of " + total + " questions. Submit anyway?")) return;
    }
    submitExam(false);
  }

  function localScore(st) {
    var correctCount = 0;
    var scored = 0;
    st.questions.forEach(function (q) {
      if (!q.correct) return;
      scored += 1;
      if (st.answers[q.id] && st.answers[q.id] === q.correct) correctCount += 1;
    });
    var total = st.questions.length;
    var pct = scored ? Math.round((correctCount / scored) * 100) : null;
    return {
      score: correctCount,
      total: scored || total,
      percentage: pct,
      offline: true,
      unscored: !scored,
    };
  }

  function submitExam(isAuto) {
    var st = Exam.current;
    if (!st) return;
    stopExamTimer();
    $("exam-screen").classList.remove("is-on");

    var answersOut = {};
    Object.keys(st.answers).forEach(function (k) {
      answersOut[k] = st.answers[k];
    });

    if (st.isPractice && st.practiceAttemptId) {
      api
        .api("/api/v1/cbt/practice/attempts/" + st.practiceAttemptId + "/submit", {
          method: "POST",
          body: { answers: answersOut },
        })
        .then(function (res) {
          if (res && res.percent != null && res.percentage == null) res.percentage = res.percent;
          if (res && res.max_score != null && res.total == null) res.total = res.max_score;
          showResult(res, st);
        })
        .catch(function () {
          showResult(localScore(st), st);
        });
      return;
    }

    if (st.isExternal) {
      api
        .api("/api/v1/cbt/external-exams/" + st.examId + "/submit", {
          method: "POST",
          body: { answers: answersOut, is_auto_submit: !!isAuto },
        })
        .then(function (res) {
          showResult(res, st);
        })
        .catch(function () {
          showResult(localScore(st), st);
        });
      return;
    }

    if (st.sessionId) {
      api
        .api("/api/v1/cbt/sessions/submit", {
          method: "POST",
          body: { session_id: st.sessionId, answers: answersOut, is_auto_submit: !!isAuto },
        })
        .then(function (res) {
          showResult(res, st);
        })
        .catch(function () {
          showResult(localScore(st), st);
        });
      return;
    }

    showResult(localScore(st), st);
  }

  function showResult(res, st) {
    res = res || {};
    var score = res.score != null ? res.score : res.correct_count;
    var total = res.total != null ? res.total : res.total_questions || (st && st.questions.length);
    var pct =
      res.percentage != null
        ? res.percentage
        : score != null && total
        ? Math.round((score / total) * 100)
        : null;

    $("resultRing").textContent = pct != null ? pct + "%" : "—";
    $("resultTitle").textContent = res.unscored ? "Exam submitted" : "Exam completed";
    $("resultSub").textContent = st ? st.title : "";
    $("resultStats").innerHTML =
      '<div><strong>' +
      (score != null ? score : "—") +
      "</strong><span>Correct</span></div>" +
      '<div><strong>' +
      (total != null ? total : "—") +
      "</strong><span>Total</span></div>" +
      '<div><strong>' +
      (res.offline ? "Offline" : "Synced") +
      "</strong><span>Status</span></div>";
    $("result-screen").classList.add("is-on");
    Exam.current = null;
  }

  if ($("resultCloseBtn")) {
    $("resultCloseBtn").addEventListener("click", function () {
      $("result-screen").classList.remove("is-on");
      // Refresh whichever exam list is currently visible so downloaded/attempted state updates.
      ["cbt", "school", "school-portal"].forEach(function (p) {
        if (document.getElementById("page-" + p) && document.getElementById("page-" + p).classList.contains("is-on")) {
          loadedPages[p] = false;
          PAGE_LOADERS[p] && PAGE_LOADERS[p]();
        }
      });
    });
  }

  /* =====================================================================
     CBT — exam type packages (JAMB / WAEC / NECO)
     ===================================================================== */

  var cbtHomeCache = null;
  var cbtSelectedBoard = null;
  var DEFAULT_JAMB_SUBJECTS = [
    "Use of English",
    "Mathematics",
    "Physics",
    "Chemistry",
    "Biology",
    "Economics",
    "Government",
    "Literature in English",
    "Geography",
    "Christian Religious Studies",
    "Islamic Religious Studies",
    "Commerce",
    "Accounting",
  ];
  var DEFAULT_SSCE_SUBJECTS = [
    "English Language",
    "Mathematics",
    "Biology",
    "Chemistry",
    "Physics",
    "Economics",
    "Government",
    "Literature in English",
    "Geography",
    "Agricultural Science",
    "Further Mathematics",
    "Commerce",
    "Financial Accounting",
  ];

  function loadCbt() {
    var list = $("cbtExamTypeList");
    var home = $("cbtHomePanel");
    var board = $("cbtBoardPanel");
    if (home) home.hidden = false;
    if (board) board.hidden = true;
    if (!list) return;

    // Show exam packages immediately — do not block the UI on a long wake cycle
    list.innerHTML = ["JAMB", "WAEC", "NECO"]
      .map(function (boardName) {
        return (
          '<button type="button" class="card card-click" data-cbt-board="' +
          boardName +
          '" style="text-align:left;cursor:pointer;border:1px solid #e2e8f0;opacity:0.85">' +
          '<span class="card-tag">' +
          boardName +
          '</span><span class="badge">Loading…</span>' +
          "<h4 style=\"margin:0.5rem 0 0.35rem\">" +
          boardName +
          "</h4><p style=\"margin:0;color:#64748b;font-size:0.9rem\">Exam package</p></button>"
        );
      })
      .join("");

    function applyHome(data) {
      cbtHomeCache = data || {};
      renderCbtExamTypes();
    }

    function fallbackHome() {
      return api
        .api("/api/v1/payments/paystack/cbt-access", { timeout: 25000, retries: 1, preferXhr: true })
        .then(function (access) {
          var boards = (access && access.boards) || [];
          function has(b) {
            return boards.indexOf(b) >= 0;
          }
          return {
            settings: {
              cbt_enabled: true,
              jamb_subjects_required: 4,
              jamb_duration_minutes: 180,
              waec_duration_minutes: 60,
              neco_duration_minutes: 60,
            },
            exam_types: [
              { exam_type: "JAMB", has_access: has("JAMB"), package_id: "jamb" },
              { exam_type: "WAEC", has_access: has("WAEC"), package_id: "waec" },
              { exam_type: "NECO", has_access: has("NECO"), package_id: "neco" },
            ],
            profile: { jamb_subjects: [], ssce_subjects: [], ssce_exam_type: "WAEC" },
            _fallback: true,
          };
        });
    }

    // Fire-and-forget short wake; do not wait for it before loading home
    if (api.wakeServer) {
      try {
        api.wakeServer(12000);
      } catch (e) {}
    }

    api
      .api("/api/v1/cbt/practice/home", { timeout: 35000, retries: 1, preferXhr: true })
      .then(applyHome)
      .catch(function (err) {
        fallbackHome()
          .then(applyHome)
          .catch(function () {
            list.innerHTML = errorHtml(errMsg(err), "cbt");
          });
      });
  }

  function renderCbtExamTypes() {
    var list = $("cbtExamTypeList");
    if (!list) return;
    var types = (cbtHomeCache && cbtHomeCache.exam_types) || [];
    if (!types.length) {
      list.innerHTML = emptyHtml("📝", "CBT is not available yet.");
      return;
    }
    var settings = (cbtHomeCache && cbtHomeCache.settings) || {};
    if (settings.cbt_enabled === false) {
      list.innerHTML = emptyHtml("📝", "CBT practice is currently disabled by admin.");
      return;
    }
    list.innerHTML = types
      .map(function (t) {
        var board = t.exam_type;
        var access = t.has_access
          ? '<span class="badge badge-purple">Unlocked</span>'
          : '<span class="badge">Locked</span>';
        var hint =
          board === "JAMB"
            ? "One combined CBT · your profile subjects · settings from admin"
            : "Subject practice from your registered profile subjects";
        return (
          '<button type="button" class="card card-click" data-cbt-board="' +
          esc(board) +
          '" style="text-align:left;cursor:pointer;border:1px solid #e2e8f0">' +
          '<span class="card-tag">' +
          esc(board) +
          "</span>" +
          access +
          "<h4 style=\"margin:0.5rem 0 0.35rem\">" +
          esc(board) +
          "</h4><p style=\"margin:0;color:#64748b;font-size:0.9rem\">" +
          esc(hint) +
          "</p></button>"
        );
      })
      .join("");
  }

  function openCbtBoard(board) {
    cbtSelectedBoard = board;
    var home = $("cbtHomePanel");
    var panel = $("cbtBoardPanel");
    var body = $("cbtBoardBody");
    var title = $("cbtBoardTitle");
    var hint = $("cbtBoardHint");
    if (home) home.hidden = true;
    if (panel) panel.hidden = false;
    if (title) title.textContent = board + " CBT";
    if (!body) return;

    var types = (cbtHomeCache && cbtHomeCache.exam_types) || [];
    var info = types.find(function (t) {
      return t.exam_type === board;
    }) || { has_access: false };
    var profile = (cbtHomeCache && cbtHomeCache.profile) || {};
    var settings = (cbtHomeCache && cbtHomeCache.settings) || {};

    if (!info.has_access) {
      if (hint) hint.textContent = "Unlock " + board + " once with a coupon or Paystack. That unlocks the whole package.";
      body.innerHTML =
        '<p style="margin:0 0 1rem;color:#64748b">One ' +
        esc(board) +
        " package unlocks this CBT. You do not unlock subjects one by one.</p>" +
        '<button type="button" class="btn btn-primary" id="cbtUnlockBoardBtn">Unlock ' +
        esc(board) +
        "</button>";
      var unlockBtn = $("cbtUnlockBoardBtn");
      if (unlockBtn) {
        unlockBtn.onclick = function () {
          openCbtUnlockModal(function () {
            loadedPages.cbt = false;
            loadCbt();
            setTimeout(function () {
              openCbtBoard(board);
            }, 400);
          });
        };
      }
      return;
    }

    if (board === "JAMB") {
      var need = settings.jamb_subjects_required || 4;
      var jambSubs = (profile.jamb_subjects || []).filter(Boolean);
      if (jambSubs.length !== need) {
        var localJamb = readLocalJson("sia_jamb_subjects", null) || readLocalJson("sia_subjects", []);
        if (Array.isArray(localJamb) && localJamb.length === need) jambSubs = localJamb.slice();
      }
      var dur = settings.jamb_duration_minutes || 180;
      if (hint) {
        hint.textContent =
          "Your profile subjects become one JAMB CBT. Duration and question counts come from Admin CBT Settings.";
      }
      if (jambSubs.length !== need) {
        body.innerHTML =
          '<div class="empty-state"><strong>Set your JAMB subjects in Profile first</strong>' +
          "<p>CBT needs exactly " +
          need +
          " JAMB subjects from your registration/profile. Current: " +
          jambSubs.length +
          ".</p>" +
          '<button type="button" class="btn btn-primary" data-goto="profile">Open Profile</button></div>';
        return;
      }
      body.innerHTML =
        "<h3 style=\"margin:0 0 0.5rem\">Your Subjects</h3>" +
        '<p class="muted" style="margin:0 0 1rem">One JAMB CBT · ' +
        esc(String(dur)) +
        " minutes (from admin settings)</p>" +
        '<div class="card-grid one-col" style="gap:0.45rem">' +
        jambSubs
          .map(function (s) {
            return (
              '<div style="padding:0.7rem 0.9rem;border:1px solid #e2e8f0;border-radius:10px;font-weight:700">' +
              esc(s) +
              "</div>"
            );
          })
          .join("") +
        "</div>" +
        '<div class="btn-row" style="margin-top:1.1rem">' +
        '<button type="button" class="btn btn-primary" id="cbtStartJambBtn">START CBT</button>' +
        "</div>" +
        '<p id="cbtJambPickMsg" class="form-status" style="margin-top:0.75rem"></p>';
      var startJ = $("cbtStartJambBtn");
      if (startJ) {
        startJ.onclick = function () {
          startPracticeAttempt("JAMB", jambSubs.slice(), startJ);
        };
      }
      return;
    }

    // WAEC / NECO — only profile subjects
    var registered = (profile.ssce_subjects || []).filter(Boolean);
    if (!registered.length) {
      var localSsce = readLocalJson("sia_ssce_subjects", null) || readLocalJson("sia_subjects", []);
      if (Array.isArray(localSsce) && localSsce.length) registered = localSsce.slice();
    }
    if (hint) {
      hint.textContent = "Only subjects from your profile. Timer and question count come from Admin CBT Settings.";
    }
    if (!registered.length) {
      body.innerHTML =
        '<div class="empty-state"><strong>No ' +
        esc(board) +
        " subjects on your profile</strong>" +
        "<p>Add your subjects under Profile, then return here.</p>" +
        '<button type="button" class="btn btn-primary" data-goto="profile">Open Profile</button></div>';
      return;
    }
    var packDur =
      board === "WAEC" ? settings.waec_duration_minutes || 60 : settings.neco_duration_minutes || 60;
    body.innerHTML =
      '<p class="muted" style="margin:0 0 0.85rem">Pick one subject to practice · ' +
      esc(String(packDur)) +
      " min (admin settings)</p>" +
      '<div class="card-grid" id="cbtSubjectCards">' +
      registered
        .map(function (s) {
          return (
            '<div class="card"><span class="card-tag">' +
            esc(board) +
            "</span><h4>" +
            esc(s) +
            "</h4>" +
            '<div class="card-foot"><button type="button" class="btn btn-primary btn-mini" data-cbt-start-subject="' +
            esc(s) +
            '">START CBT</button></div></div>'
          );
        })
        .join("") +
      "</div>";
  }

  function startPracticeAttempt(examType, subjects, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Starting…";
    }
    api
      .api("/api/v1/cbt/practice/start", {
        method: "POST",
        body: { exam_type: examType, subjects: subjects },
      })
      .then(function (attempt) {
        openPracticeAttempt(attempt);
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "START CBT";
        }
        if (isCbtPackageError(err)) {
          openCbtUnlockModal(function () {
            startPracticeAttempt(examType, subjects, btn);
          });
          return;
        }
        alert(errMsg(err));
      });
  }

  function sectionQuestions(section) {
    return normalizeQuestions((section && section.questions) || []).map(function (q) {
      return q;
    });
  }

  function openPracticeAttempt(attempt) {
    if (!attempt || !attempt.attempt_id) {
      alert("Could not start CBT attempt.");
      return;
    }
    var sections = attempt.sections || [];
    var idx = Math.min(attempt.section_index || 0, Math.max(0, sections.length - 1));
    var answers = Object.assign({}, attempt.answers || {});
    try {
      var cached = JSON.parse(localStorage.getItem("sia_cbt_attempt_" + attempt.attempt_id) || "null");
      if (cached && cached.answers) Object.assign(answers, cached.answers);
    } catch (e) {}
    var hasAnyAnswer = Object.keys(answers).length > 0;
    var multi = sections.length > 1;

    Exam.current = {
      practiceAttemptId: attempt.attempt_id,
      examId: attempt.attempt_id,
      title: (attempt.exam_type || "CBT") + " CBT",
      examType: attempt.exam_type,
      sections: sections,
      sectionIndex: idx,
      questions: [],
      answers: answers,
      sessionId: null,
      isPractice: true,
      awaitingSectionPick: multi && !hasAnyAnswer,
      isExternal: false,
      isSchool: false,
      index: 0,
      remainingSec:
        typeof attempt.seconds_left === "number"
          ? attempt.seconds_left
          : (attempt.duration_minutes || 60) * 60,
      timerId: null,
    };

    $("examTitle").textContent = Exam.current.title;
    updatePracticeExamSub();
    $("exam-screen").classList.add("is-on");
    startExamTimer();

    if (Exam.current.awaitingSectionPick) {
      showPracticeSectionChooser();
    } else {
      enterPracticeSection(idx, true);
    }
  }

  function setPracticeQuestionView(showQuestions) {
    var chooser = $("examSectionChooser");
    var body = $("examBody");
    if (chooser) chooser.hidden = !!showQuestions;
    if (body) body.hidden = !showQuestions;
  }

  function showPracticeSectionChooser() {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    st.awaitingSectionPick = true;
    st.questions = [];
    setPracticeQuestionView(false);
    renderPracticeSectionTabs();
    var title = $("examChooserTitle");
    var hint = $("examChooserHint");
    var grid = $("examChooserGrid");
    if (title) title.textContent = (st.examType || "CBT") + " — Choose where to start";
    if (hint) {
      hint.textContent =
        "Subjects stay separate. Pick any section. Progress is saved automatically.";
    }
    if (!grid) return;
    grid.innerHTML = (st.sections || [])
      .map(function (sec, i) {
        var answered = 0;
        (sec.questions || []).forEach(function (q) {
          if (st.answers[String(q.id)]) answered += 1;
        });
        var total = (sec.questions || []).length;
        var done = !!sec.completed || (total > 0 && answered === total);
        return (
          '<button type="button" class="exam-section-chooser-btn' +
          (done ? " is-done" : "") +
          '" data-practice-section="' +
          i +
          '"><span>' +
          (done ? "✓ " : "") +
          esc(sec.subject || "Subject " + (i + 1)) +
          '</span><span class="meta">' +
          answered +
          " / " +
          total +
          (done ? " completed" : " answered") +
          "</span></button>"
        );
      })
      .join("");
    if ($("examSub")) {
      $("examSub").textContent =
        (st.examType || "CBT") + " · Choose a subject · Timer from admin settings";
    }
  }

  function enterPracticeSection(nextIndex, skipSave) {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    var sections = st.sections || [];
    nextIndex = parseInt(nextIndex, 10);
    if (isNaN(nextIndex) || nextIndex < 0 || nextIndex >= sections.length) return;

    function apply() {
      st.awaitingSectionPick = false;
      st.sectionIndex = nextIndex;
      var next = sections[nextIndex];
      st.questions = sectionQuestions(next);
      st.index = 0;
      st.title = (st.examType || "CBT") + " · " + ((next && next.subject) || "Practice");
      if ($("examTitle")) $("examTitle").textContent = st.title;
      setPracticeQuestionView(true);
      updatePracticeExamSub();
      renderPracticeSectionTabs();
      renderExamNav();
      renderExamQuestion();
      savePracticeAnswers();
    }

    if (skipSave) apply();
    else savePracticeAnswers(apply);
  }

  function renderPracticeSectionTabs() {
    var bar = $("examSectionBar");
    var tabs = $("examSectionTabs");
    var st = Exam.current;
    if (!bar || !tabs) return;
    if (!st || !st.isPractice || !(st.sections && st.sections.length > 1)) {
      bar.hidden = true;
      tabs.innerHTML = "";
      return;
    }
    bar.hidden = false;
    var html = st.sections
      .map(function (sec, i) {
        var answered = 0;
        (sec.questions || []).forEach(function (q) {
          if (st.answers[String(q.id)]) answered += 1;
        });
        var total = (sec.questions || []).length;
        var cls = "exam-section-tab";
        if (!st.awaitingSectionPick && i === st.sectionIndex) cls += " is-active";
        if (sec.completed || (total && answered === total)) cls += " is-done";
        return (
          '<button type="button" class="' +
          cls +
          '" data-practice-section="' +
          i +
          '">' +
          esc(sec.subject || "Subject " + (i + 1)) +
          (total ? " (" + answered + "/" + total + ")" : "") +
          "</button>"
        );
      })
      .join("");
    html +=
      '<button type="button" class="exam-section-tab" id="examShowChooserBtn" style="margin-left:0.25rem">All subjects</button>';
    tabs.innerHTML = html;
    var allBtn = $("examShowChooserBtn");
    if (allBtn) {
      allBtn.onclick = function () {
        showPracticeSectionChooser();
      };
    }
  }

  function switchPracticeSection(nextIndex) {
    enterPracticeSection(nextIndex, false);
  }

  function updatePracticeExamSub() {
    var st = Exam.current;
    if (!st || !$("examSub")) return;
    if (st.awaitingSectionPick) {
      $("examSub").textContent =
        (st.examType || "CBT") + " · Choose a subject · Timer from admin settings";
      renderPracticeSectionTabs();
      return;
    }
    var sec = (st.sections && st.sections[st.sectionIndex]) || {};
    $("examSub").textContent =
      (st.examType || "CBT") +
      " · Section " +
      (st.sectionIndex + 1) +
      "/" +
      (st.sections || []).length +
      " · " +
      (sec.subject || "") +
      " · " +
      st.questions.length +
      " questions";
    renderPracticeSectionTabs();
  }

  function savePracticeAnswers(done) {
    var st = Exam.current;
    if (!st || !st.practiceAttemptId) {
      if (done) done();
      return;
    }
    // Keep a local copy for poor networks
    try {
      localStorage.setItem(
        "sia_cbt_attempt_" + st.practiceAttemptId,
        JSON.stringify({
          answers: st.answers,
          section_index: st.sectionIndex,
          saved_at: Date.now(),
        })
      );
    } catch (e) {}
    api
      .api("/api/v1/cbt/practice/attempts/" + st.practiceAttemptId + "/answers", {
        method: "POST",
        body: { answers: st.answers, section_index: st.sectionIndex },
        preferXhr: true,
        retries: 1,
        timeout: 20000,
      })
      .then(function () {
        if (done) done();
      })
      .catch(function () {
        if (done) done();
      });
  }

  function advanceOrSubmitPracticeSection() {
    var st = Exam.current;
    if (!st || !st.isPractice) return;
    var sections = st.sections || [];
    sections[st.sectionIndex].completed = true;
    renderPracticeSectionTabs();

    var remaining = sections.filter(function (sec, i) {
      return i !== st.sectionIndex && !sec.completed;
    }).length;

    if (remaining > 0) {
      savePracticeAnswers(function () {
        showPracticeSectionChooser();
      });
      return;
    }
    confirmSubmitExam();
  }

  document.addEventListener("click", function (e) {
    var secTab = e.target.closest("[data-practice-section]");
    if (secTab) {
      switchPracticeSection(secTab.getAttribute("data-practice-section"));
      return;
    }
    var typeBtn = e.target.closest("[data-cbt-board]");
    if (typeBtn) {
      openCbtBoard(typeBtn.getAttribute("data-cbt-board"));
      return;
    }
    var subBtn = e.target.closest("[data-cbt-start-subject]");
    if (subBtn) {
      startPracticeAttempt(cbtSelectedBoard, [subBtn.getAttribute("data-cbt-start-subject")], subBtn);
    }
  });

  if ($("cbtBackToTypes")) {
    $("cbtBackToTypes").addEventListener("click", function () {
      loadCbt();
    });
  }

  var cbtActiveBoard = "practice_exams";

  function renderCbtBoard() {
    /* legacy no-op — exam cards replaced by exam-type flow */
  }

  /* =====================================================================
     SCHOOL (Scholaxia Exam)
     ===================================================================== */

  function loadSchoolExams() {
    var wrap = $("schoolExamsList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading exams…");
    fetchExamsForMe()
      .then(function (data) {
        var list = (data && data.school_exams) || [];
        if (!list.length) {
          wrap.innerHTML = emptyHtml("⏱", "No school exams loaded yet. Check back after your teacher publishes one.");
          return;
        }
        wrap.innerHTML = list.map(function (exam) { return renderExamCard(exam, { isSchool: true, badge: "SCHOOL" }); }).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "school");
      });
  }

  /* =====================================================================
     EXTERNAL SCHOOL EXAM (school-portal)
     ===================================================================== */

  var externalExamsCache = [];

  function loadSchoolPortal() {
    var wrap = $("schoolPortalList");
    var idCard = $("examIdentityCard");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading exams…");
    api
      .api("/api/v1/external-exams/mine")
      .then(function (data) {
        var st = (data && data.student) || {};
        if (idCard) {
          idCard.style.display = "block";
          idCard.innerHTML =
            "<strong>" + esc(st.full_name || api.getUser().name) + "</strong> · " +
            esc(st.school_name || "") + " · " + esc(st.class_name || "") +
            (st.school_student_id ? " · ID " + esc(st.school_student_id) : "");
        }
        var exams = (data && data.exams) || [];
        if (!exams.length) {
          wrap.innerHTML = emptyHtml("🏫", "No exam is published for your class yet.");
          return;
        }
        wrap.innerHTML = exams.map(function (exam) {
          return (
            '<div class="card"><span class="card-tag">EXAM</span><h4>' + esc(exam.title) + "</h4><p>" +
            esc(exam.subject) + " · " + esc(exam.total_questions || 0) + " questions · " +
            esc(exam.duration_minutes) + " min · " + esc(exam.total_marks) + " marks</p>" +
            '<div class="card-foot"><button type="button" class="btn btn-primary btn-mini" data-open-school-exam="' +
            esc(exam.id) + '">View exam</button></div></div>'
          );
        }).join("");
      })
      .catch(function (err) {
        var msg = errMsg(err);
        if (/not linked|school_id|school has not/i.test(msg + JSON.stringify((err && err.data) || {}))) {
          wrap.innerHTML = emptyHtml(
            "🏫",
            "Your school has not linked this account yet. Ask the school office to add your email, then refresh."
          );
          return;
        }
        wrap.innerHTML = errorHtml(msg, "school-portal");
      });
  }

  /* =====================================================================
     ACCESS CODE
     ===================================================================== */

  function renderAccessCodeCard(c) {
    var code = c.code || c.access_code || "";
    var subject = c.subject || c.topic || c.class_title || "Live class access";
    var unread = c.is_read === false || c.read === false;
    return (
      '<div class="card-list-row" data-code-id="' +
      esc(c.id) +
      '">' +
      "<div><strong>" +
      esc(subject) +
      "</strong><div class=\"card-meta-row\"><span>" +
      esc(code) +
      "</span>" +
      (unread ? '<span class="badge badge-purple">New</span>' : "") +
      (c.created_at ? "<span>" + esc(fmtDate(c.created_at)) + "</span>" : "") +
      "</div></div>" +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-primary btn-mini" data-join-code="' +
      esc(code) +
      '">Join class</button>' +
      '<button type="button" class="btn btn-secondary btn-mini" data-copy-code="' +
      esc(code) +
      '">Copy</button>' +
      (unread
        ? '<button type="button" class="btn btn-mini" data-mark-read="' + esc(c.id) + '">Mark read</button>'
        : "") +
      "</div></div>"
    );
  }

  /* Live class invitation ringtone (same sound as the mobile app) */
  var liveRingAudio = null;
  var liveRingTimer = null;
  var liveRingLimitTimer = null;
  var knownUnreadCodes = {};
  var LIVE_RING_MAX_MS = 45000;
  var LIVE_RING_BURST_MS = 4000;

  function stopLiveClassRing() {
    if (liveRingTimer) {
      clearInterval(liveRingTimer);
      liveRingTimer = null;
    }
    if (liveRingLimitTimer) {
      clearTimeout(liveRingLimitTimer);
      liveRingLimitTimer = null;
    }
    try {
      if (liveRingAudio) {
        liveRingAudio.pause();
        liveRingAudio.currentTime = 0;
      }
    } catch (e) {}
    var bar = $("liveInviteRingBar");
    if (bar) bar.hidden = true;
  }

  function playLiveClassRingBurst() {
    try {
      if (!liveRingAudio) {
        liveRingAudio = new Audio("media/sounds/live_class_ringtone.mp3");
        liveRingAudio.preload = "auto";
      }
      liveRingAudio.currentTime = 0;
      var p = liveRingAudio.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {}
  }

  function startLiveClassRing() {
    if (liveRingTimer) return;
    var bar = $("liveInviteRingBar");
    if (bar) bar.hidden = false;
    playLiveClassRingBurst();
    liveRingTimer = setInterval(playLiveClassRingBurst, LIVE_RING_BURST_MS);
    // Hard stop so ringtone is never endless while a class stays live.
    liveRingLimitTimer = setTimeout(function () {
      stopLiveClassRing();
      try {
        localStorage.setItem("sia_stop_live_ring", String(Date.now()));
      } catch (e) {}
    }, LIVE_RING_MAX_MS);
  }

  function pollLiveInvitesForRing() {
    var stopped = Number(localStorage.getItem("sia_stop_live_ring") || "0");
    if (stopped && Date.now() - stopped < 60000) {
      stopLiveClassRing();
      return;
    }
    api
      .api("/api/v1/live-classes/access-codes/mine")
      .then(function (data) {
        var items = firstArray(data, ["codes", "items", "results"]);
        var unread = items.filter(function (c) {
          if (c.is_class_live === false) return false;
          return c.is_read === false || c.read === false;
        });
        var hasNew = false;
        unread.forEach(function (c) {
          var id = String(c.id || c.code || c.access_code || "");
          if (id && !knownUnreadCodes[id]) {
            knownUnreadCodes[id] = true;
            hasNew = true;
          }
        });
        if (unread.length && hasNew) startLiveClassRing();
        else if (!unread.length) stopLiveClassRing();
      })
      .catch(function () {});
  }

  function loadAccessCodes() {
    var wrap = $("accessCodesList");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading access codes…");
    api
      .api("/api/v1/live-classes/access-codes/mine")
      .then(function (data) {
        var items = firstArray(data, ["codes", "items", "results"]);
        if (!items.length) {
          wrap.innerHTML = emptyHtml("🔑", "No access codes yet.");
          return;
        }
        wrap.innerHTML = items.map(renderAccessCodeCard).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "access-code");
      });
  }

  document.addEventListener("click", function (e) {
    var joinCodeBtn = e.target.closest("[data-join-code]");
    if (joinCodeBtn) {
      var joinCode = (joinCodeBtn.dataset.joinCode || "").trim();
      if (!joinCode) return;
      joinCodeBtn.disabled = true;
      joinCodeBtn.textContent = "Joining…";
      stopLiveClassRing();
      api
        .api("/api/v1/live-classes/join-by-code", { method: "POST", body: { code: joinCode } })
        .then(function (res) {
          showLiveJoinResult(res || {});
        })
        .catch(function (err) {
          alert("Could not join with that code: " + errMsg(err));
        })
        .then(function () {
          joinCodeBtn.disabled = false;
          joinCodeBtn.textContent = "Join class";
        });
      return;
    }
    var copyBtn = e.target.closest("[data-copy-code]");
    if (copyBtn) {
      var code = copyBtn.dataset.copyCode;
      if (navigator.clipboard && code) {
        navigator.clipboard.writeText(code).then(function () {
          var prev = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(function () { copyBtn.textContent = prev; }, 1500);
        });
      }
      return;
    }
    var markBtn = e.target.closest("[data-mark-read]");
    if (markBtn) {
      var id = markBtn.dataset.markRead;
      api
        .api("/api/v1/live-classes/access-codes/mark-read", { method: "POST", body: { id: id, code_id: id } })
        .then(function () { loadAccessCodes(); })
        .catch(function () {});
    }
  });

  if ($("clearOldCodesBtn")) {
    $("clearOldCodesBtn").addEventListener("click", function () {
      if (!confirm("Clear old access codes?")) return;
      api
        .api("/api/v1/live-classes/access-codes/clear", { method: "POST", body: { mode: "old" } })
        .then(function () { loadAccessCodes(); })
        .catch(function (err) { alert(errMsg(err)); });
    });
  }
  if ($("clearAllCodesBtn")) {
    $("clearAllCodesBtn").addEventListener("click", function () {
      if (!confirm("Clear ALL access codes? This cannot be undone.")) return;
      api
        .api("/api/v1/live-classes/access-codes/clear", { method: "POST", body: { mode: "all" } })
        .then(function () { loadAccessCodes(); })
        .catch(function (err) { alert(errMsg(err)); });
    });
  }

  /* =====================================================================
     LIVE CLASS
     ===================================================================== */

  function renderLiveCard(c, isLive) {
    var title = c.title || c.topic || c.subject || "Live class";
    var teacher = c.teacher_name || c.host_name || c.teacher || "Scholaxia teacher";
    var subject = c.subject || c.topic || "";
    var time = c.starts_at || c.scheduled_at || c.start_time;
    var vis = (c.visibility || c.type || "").toLowerCase();
    var isFree =
      c.is_free === true ||
      c.requires_payment === false ||
      vis === "private" ||
      vis === "public" ||
      vis === "school_group";
    return (
      '<article class="live-card' + (isLive ? " is-live" : "") + '">' +
      '<div class="live-card-banner">' +
      '<span class="badge" style="background:rgba(255,255,255,.2);color:#fff">' +
      (isLive ? "● LIVE" : "UPCOMING") +
      "</span>" +
      (vis ? '<span style="opacity:.9;font-size:.75rem;font-weight:700">' + esc(vis) + (isFree ? " · Free" : "") + "</span>" : "") +
      "</div>" +
      '<div class="live-card-body">' +
      "<h4>" + esc(title) + "</h4>" +
      "<p>" + esc(teacher) + (subject ? " · " + esc(subject) : "") + "</p>" +
      (time ? '<div class="card-meta-row"><span>' + esc(fmtDate(time)) + "</span></div>" : "") +
      '<div class="card-foot">' +
      (isLive || isFree
        ? '<button type="button" class="btn btn-primary btn-mini" data-join-live="' + esc(c.id) + '">' +
          (isLive ? "Join now" : "Join free") +
          "</button>"
        : '<button type="button" class="btn btn-secondary btn-mini" data-goto="subscription">Get plan</button>') +
      "</div></div></article>"
    );
  }

  function loadLive() {
    loadAccessCodes();
    var liveWrap = $("liveNowGrid");
    var upWrap = $("liveUpcomingGrid");
    if (liveWrap) liveWrap.innerHTML = loadingHtml("Loading live classes…");
    if (upWrap) upWrap.innerHTML = loadingHtml("Loading upcoming classes…");

    api
      .api("/api/v1/live-classes/?status=live", { timeout: 60000, retries: 3 })
      .then(function (data) {
        var items = firstArray(data, ["classes", "items", "results", "live_classes"]);
        if (!liveWrap) return;
        liveWrap.innerHTML = items.length
          ? items.map(function (c) { return renderLiveCard(c, true); }).join("")
          : emptyHtml("📺", "No live classes right now. Your invite codes appear above when a teacher starts a class.");
      })
      .catch(function () {
        if (liveWrap) {
          liveWrap.innerHTML = emptyHtml(
            "📺",
            "No live classes right now. Your invite codes appear above when a teacher starts a class."
          );
        }
      });

    api
      .api("/api/v1/live-classes/?status=upcoming", { timeout: 60000, retries: 3 })
      .then(function (data) {
        var items = firstArray(data, ["classes", "items", "results", "live_classes"]);
        if (!upWrap) return;
        upWrap.innerHTML = items.length
          ? items.map(function (c) { return renderLiveCard(c, false); }).join("")
          : emptyHtml("🗓", "No upcoming classes scheduled yet.");
      })
      .catch(function () {
        if (upWrap) upWrap.innerHTML = emptyHtml("🗓", "No upcoming classes scheduled yet.");
      });
  }

  document.addEventListener("click", function (e) {
    var joinBtn = e.target.closest("[data-join-live]");
    if (!joinBtn) return;
    var id = joinBtn.dataset.joinLive;
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";
    api
      .api("/api/v1/live-classes/" + id + "/join", { method: "POST" })
      .then(function (res) {
        showLiveJoinResult(res || {});
      })
      .catch(function (err) {
        alert("Could not join: " + errMsg(err));
      })
      .then(function () {
        joinBtn.disabled = false;
        joinBtn.textContent = "Join";
      });
  });

  function enterLiveClassroom(res) {
    var classId = res.class_id || res.classId || res.id || "";
    var roomId = res.room_id || res.channel_id || "";
    var token = res.livekit_token || res.token || "";
    var url = res.livekit_url || "";
    function go(sessRes) {
      var r = sessRes || res || {};
      var rid = r.room_id || r.channel_id || roomId;
      var tok = r.livekit_token || r.token || token;
      var lurl = r.livekit_url || url;
      if (!rid || !tok) {
        alert("Joined, but classroom media was not ready. Ask the teacher to restart the class, then try again.");
        return;
      }
      var user = api.getUser();
      var sess = {
        class_id: classId || r.class_id || "",
        classId: classId || r.class_id || "",
        room_id: rid,
        channel_id: rid,
        livekit_token: tok,
        livekit_url: lurl,
        identity: r.identity || "",
        teacher_id: r.teacher_id || "",
        title: r.title || r.topic || r.subject || "Live Class",
        subject: r.subject || "",
        teacher_name: r.teacher_name || r.host_name || "",
        mic_allowed: r.mic_allowed !== false,
        camera_allowed: r.camera_allowed !== false,
        can_publish: r.can_publish !== false,
        role: "student",
        end_time: r.end_time || null,
      };
      writeLocalJson("live_session", sess);
      try {
        localStorage.setItem("sia_stop_live_ring", String(Date.now()));
      } catch (e) {}
      window.location.href = "classroom.html";
    }
    if (roomId && token && url) {
      go(res);
      return;
    }
    // Missing LiveKit URL/token — fetch a fresh one before opening the room.
    if (!classId) {
      go(res);
      return;
    }
    api
      .api("/api/v1/live-classes/" + encodeURIComponent(classId) + "/token")
      .then(function (tokRes) {
        go(Object.assign({}, res || {}, tokRes || {}));
      })
      .catch(function () {
        go(res);
      });
  }

  function showLiveJoinResult(res) {
    writeLocalJson("live_session", res);
    var panel = $("liveJoinResult");
    var title = res.title || res.topic || res.subject || "Live class";
    var code = res.code || res.access_code || "";
    if (panel) {
      panel.style.display = "block";
      panel.innerHTML =
        "<h3>✅ You're in: " +
        esc(title) +
        "</h3>" +
        '<div class="card-meta-row">' +
        (code ? "<span>Code: " + esc(code) + "</span>" : "") +
        (res.host_name || res.teacher_name
          ? "<span>Host: " + esc(res.host_name || res.teacher_name) + "</span>"
          : "") +
        "</div>" +
        '<div class="btn-row">' +
        '<button type="button" class="btn btn-primary" id="openClassroomBtn">Open classroom</button>' +
        '<button type="button" class="btn btn-secondary" id="saveLiveBtn">Save for later</button>' +
        "</div>";
      var openBtn = document.getElementById("openClassroomBtn");
      if (openBtn) {
        openBtn.addEventListener("click", function () {
          enterLiveClassroom(res || {});
        });
      }
      var saveBtn = document.getElementById("saveLiveBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var saved = readLocalJson("sia_saved_lives_web", []);
          if (!Array.isArray(saved)) saved = [];
          saved.unshift({
            id: res.id || res.class_id || res.session_id || Date.now(),
            title: title,
            savedAt: new Date().toISOString(),
          });
          writeLocalJson("sia_saved_lives_web", saved);
          saveBtn.textContent = "Saved ✓";
          saveBtn.disabled = true;
        });
      }
    }
    // Auto-enter the real LiveKit classroom (two-way A/V)
    enterLiveClassroom(res || {});
  }

  var joinCodeForm = $("joinCodeForm");
  if (joinCodeForm) {
    joinCodeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = $("joinCodeInput").value.trim();
      if (!code) return;
      var btn = joinCodeForm.querySelector("button[type=submit]");
      btn.disabled = true;
      api
        .api("/api/v1/live-classes/join-by-code", { method: "POST", body: { code: code } })
        .then(function (res) {
          showLiveJoinResult(res || {});
          $("joinCodeInput").value = "";
        })
        .catch(function (err) {
          alert("Could not join with that code: " + errMsg(err));
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  var liveRequestForm = $("liveRequestForm");
  if (liveRequestForm) {
    liveRequestForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var subject = $("liveReqSubject").value.trim();
      var topic = $("liveReqTopic").value.trim();
      var description = $("liveReqDesc").value.trim();
      if (!subject || !topic) return;
      var btn = liveRequestForm.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Sending…";
      api
        .api("/api/v1/live-classes/requests", {
          method: "POST",
          body: { subject: subject, topic: topic, description: description },
        })
        .then(function () {
          alert("Request sent! We'll notify you when a class is scheduled.");
          liveRequestForm.reset();
        })
        .catch(function (err) {
          alert("Could not send request: " + errMsg(err));
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = "Send request";
        });
    });
  }

  /* =====================================================================
     SUBSCRIPTION
     ===================================================================== */

  function planSessionsLabel(p) {
    var sessions = Number(p.sessions || 0);
    var billing = String(p.billing || "");
    var cat = String(p.category || "");
    var isWeekly =
      billing === "holiday" ||
      billing === "monthly" ||
      /holiday|nursery|primary|secondary|exam/i.test(cat);
    if (sessions === 1) return "1 session";
    if (isWeekly && sessions > 1) return sessions + " sessions weekly";
    return sessions + " sessions";
  }

  var PLAN_SUBJECTS_FALLBACK = {
    holiday_primary: ["Mathematics", "English Language", "Phonics", "Moral values"],
    holiday_jss: ["Mathematics", "English Language", "Phonics", "French", "Computer"],
    holiday_ss_science: ["Mathematics", "English", "Physics", "Chemistry", "Biology"],
    holiday_ss_art: ["Mathematics", "English", "Literature-in-English", "CRS/IRS", "Government"],
    holiday_ss_commercial: ["Mathematics", "English", "Financial Accounting", "Commerce", "Economics"],
  };

  function planSubjectsHtml(p) {
    var features = Array.isArray(p.features) ? p.features : [];
    var subjects = features.filter(function (f) {
      return f && !/session|tutor|notes|save|questions|and answers/i.test(String(f));
    });
    var planId = String(p.id || p.plan_id || "");
    if (!subjects.length && PLAN_SUBJECTS_FALLBACK[planId]) {
      subjects = PLAN_SUBJECTS_FALLBACK[planId].slice();
    }
    if (!subjects.length && p.max_subjects) {
      subjects = [
        p.max_subjects === "All core subjects" || p.max_subjects >= 99
          ? "All core subjects"
          : "Up to " + p.max_subjects + " subjects",
      ];
    }
    if (!subjects.length) return "";
    return (
      '<ul class="plan-subjects">' +
      subjects
        .map(function (s) {
          return "<li>" + esc(s) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function loadSubscription() {
    var wrap = $("subscriptionPlans");
    var banner = $("activePlanBanner");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading plans…");
    api
      .api("/api/v1/payments/paystack/live-class/plans", { timeout: 60000, retries: 3 })
      .catch(function () {
        return api.api("/api/v1/payments/live-class/plans", { timeout: 60000, retries: 2 });
      })
      .then(function (data) {
        data = data || {};
        var plans = firstArray(data, ["plans", "items", "results"]);
        var active = data.active_plan || data.current_plan || null;
        if (banner) {
          if (active) {
            banner.style.display = "flex";
            banner.innerHTML =
              "<div><strong>Active plan: " +
              esc(active.plan_name || active.name || active.title || "Plan") +
              "</strong><div style=\"opacity:.9;font-size:.86rem\">" +
              (active.sessions_left != null ? esc(active.sessions_left) + " sessions left · " : "") +
              (active.expires_at ? "Expires " + esc(fmtDate(active.expires_at)) : "Active subscription") +
              "</div></div>";
          } else {
            banner.style.display = "none";
          }
        }
        if (!plans.length) {
          wrap.innerHTML = emptyHtml("💳", "No subscription plans available right now.");
        } else {
          wrap.innerHTML = plans
            .map(function (p) {
              var id = p.id || p.plan_id;
              var isActive = active && (active.id === id || active.plan_id === id);
              var price = p.price != null ? Number(p.price) : null;
              var mins = p.session_minutes
                ? p.session_minutes >= 60
                  ? p.session_minutes / 60 + " hr each"
                  : p.session_minutes + " min each"
                : "";
              return (
                '<div class="card plan-card' +
                (isActive ? " is-active" : "") +
                '">' +
                '<span class="card-tag">' +
                esc(p.category || p.interval || p.billing || "Live plan") +
                "</span><h4>" +
                esc(p.name || p.title || "Plan") +
                "</h4>" +
                '<p class="plan-sessions"><strong>' +
                esc(planSessionsLabel(p)) +
                "</strong>" +
                (mins ? " · " + esc(mins) : "") +
                "</p>" +
                planSubjectsHtml(p) +
                '<div class="card-foot"><strong>' +
                (price != null ? "₦" + price.toLocaleString("en-NG") : "—") +
                "</strong>" +
                (isActive
                  ? '<span class="badge badge-green">Active</span>'
                  : '<button type="button" class="btn btn-primary btn-mini" data-pay-type="class_package" data-pay-id="' +
                    esc(id) +
                    '">Pay with Paystack</button>') +
                "</div></div>"
              );
            })
            .join("");
        }
        loadCbtPackages();
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "subscription");
        loadCbtPackages();
      });
  }

  function loadCbtPackages(opts) {
    opts = opts || {};
    var wrap = $(opts.gridId || "cbtPackagesGrid");
    var banner = $(opts.bannerId || "cbtAccessBanner");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading CBT packages…");
    Promise.all([
      api.api("/api/v1/payments/paystack/cbt-packages").catch(function () { return { packages: [] }; }),
      api.api("/api/v1/payments/paystack/cbt-access").catch(function () { return null; }),
    ]).then(function (pair) {
      var catalog = pair[0] || {};
      var access = pair[1];
      var packages = firstArray(catalog, ["packages", "items"]);
      if (banner) {
        if (access && access.has_access) {
          banner.style.display = "block";
          banner.textContent =
            "You have active CBT access" +
            (access.expires_at ? " until " + String(access.expires_at).slice(0, 10) : "") +
            ". You can download and start practice exams below.";
        } else {
          banner.style.display = "block";
          banner.className = "info-banner warn-banner";
          banner.textContent =
            "No active CBT package yet. When you tap Start exam you can use a coupon or pay with Paystack.";
        }
      }
      if (!packages.length) {
        wrap.innerHTML = emptyHtml("📝", "No CBT packages listed yet.");
        return;
      }
      wrap.innerHTML = packages
        .map(function (p) {
          var id = p.id || p.package_id;
          var price = Number(p.price || p.amount || 0);
          var hasAccess = !!(access && access.has_access);
          return (
            '<div class="card plan-card' +
            (hasAccess ? " is-active" : "") +
            '">' +
            '<span class="card-tag">CBT Package</span><h4>' +
            esc(p.name || p.title || id) +
            "</h4><p>" +
            esc(p.description || "Annual CBT practice access + Tutor AI support") +
            '</p><div class="card-meta-row">' +
            (p.duration_days ? "<span>" + esc(p.duration_days) + " days</span>" : "<span>1 year</span>") +
            '</div><div class="card-foot"><strong>₦' +
            price.toLocaleString("en-NG") +
            "</strong>" +
            (hasAccess
              ? '<span class="badge badge-green">Unlocked</span>'
              : '<button type="button" class="btn btn-primary btn-mini" data-pay-type="cbt_package" data-pay-id="' +
                esc(id) +
                '">Pay with Paystack</button>') +
            "</div></div>"
          );
        })
        .join("");
    });
  }

  if ($("refreshCbtPackagesBtn")) {
    $("refreshCbtPackagesBtn").addEventListener("click", function () {
      loadCbtPackages({
        gridId: "cbtPagePackagesGrid",
        bannerId: "cbtPageAccessBanner",
      });
    });
  }

  async function handlePayClick(btn) {
    var type = btn.dataset.payType;
    var id = btn.dataset.payId;
    if (!type || !id) return;
    if (type === "skill_enrollment") {
      openSkillEnroll(id);
      return;
    }
    if (typeof window.paystackPurchase !== "function") {
      alert("Payment module not loaded. Refresh the page.");
      return;
    }
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Opening Paystack…";
    try {
      var returnPage =
        type === "cbt_package"
          ? "cbt"
          : type === "class_package"
          ? "subscription"
          : type === "library_book"
          ? "library"
          : type === "marketplace_booking"
          ? "marketplace"
          : "subscription";
      // Redirects away — code after this usually won't run
      await window.paystackPurchase({
        productType: type,
        productId: id,
        returnPage: returnPage,
      });
    } catch (err) {
      alert(errMsg(err));
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  document.addEventListener("click", function (e) {
    var payBtn = e.target.closest("[data-pay-type]");
    if (payBtn) handlePayClick(payBtn);
  });

  /* =====================================================================
     SKILLS
     ===================================================================== */

  var SKILLS_PROGRAMS = [
    { id: "web-design", title: "Web Design", fee: 400000, duration: "6 months", description: "HTML, CSS, JavaScript and modern responsive design fundamentals." },
    { id: "mobile-app", title: "Mobile App Development", fee: 300000, duration: "9 months", description: "Build Android & iOS apps with a beginner-friendly cross-platform stack." },
    { id: "graphics", title: "Graphics Design", fee: 70000, duration: "3 months", description: "Logo, flyer, and social media design using industry tools." },
    { id: "cyber-security", title: "Cyber Security", fee: 250000, duration: "6 months", description: "Security fundamentals, ethical hacking basics, and safe practices." },
    { id: "data-analysis", title: "Data Analysis", fee: 100000, duration: "6 months", description: "Excel, SQL, and visualisation for real-world decision making." },
    { id: "gsm-repairs", title: "Computer / GSM Repairs", fee: 150000, duration: "6 months", description: "Hands-on phone & computer hardware diagnosis and repair training." },
  ];

  function formatNaira(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG");
  }

  function loadSkills() {
    var wrap = $("skillsGrid");
    if (!wrap) return;
    var enrolledIds = [];
    wrap.innerHTML = SKILLS_PROGRAMS.map(function (p) { return renderSkillCard(p, false); }).join("");

    api
      .api("/api/v1/payments/paystack/skills/enrollments")
      .catch(function () {
        return api.api("/api/v1/payments/skills/enrollments").catch(function () {
          return { enrollments: [] };
        });
      })
      .then(function (data) {
        var items = firstArray(data, ["enrollments", "items", "results"]);
        enrolledIds = items.map(function (it) { return it.program_id || it.skill_id || it.slug || it.id; });
        wrap.innerHTML = SKILLS_PROGRAMS
          .map(function (p) { return renderSkillCard(p, enrolledIds.indexOf(p.id) > -1); })
          .join("");
      })
      .catch(function () {
        // Enrollment endpoint optional — keep the static program cards as-is.
      });
  }

  function renderSkillCard(p, enrolled) {
    return (
      '<div class="card">' +
      '<span class="card-tag">' +
      (enrolled ? "✅ Enrolled" : "Skill Program") +
      "</span><h4>" +
      esc(p.title) +
      "</h4>" +
      "<p>" +
      esc(p.description) +
      "</p>" +
      '<div class="card-meta-row"><span>' +
      esc(p.duration) +
      "</span></div>" +
      '<div class="card-foot"><strong>' +
      esc(formatNaira(p.fee)) +
      "</strong>" +
      (enrolled
        ? '<span class="badge badge-green">Active</span>'
        : '<button type="button" class="btn btn-primary btn-mini" data-enroll-skill="' +
          esc(p.id) +
          '">Enroll</button>') +
      "</div></div>"
    );
  }

  function openSkillEnroll(skillId) {
    var skill = SKILLS_PROGRAMS.filter(function (s) { return s.id === skillId; })[0];
    if (!skill || !$("skillEnrollModal")) return;
    $("skillEnrollId").value = skill.id;
    $("skillEnrollTitle").textContent = "Enroll — " + skill.title;
    $("skillEnrollSub").textContent = "Fill your details, then continue to Paystack.";
    $("skillEnrollName").value = user.name || "";
    $("skillEnrollEmail").value = user.email || "";
    $("skillEnrollPhone").value = "";
    $("skillEnrollStart").value = "";
    $("skillEnrollNotes").value = "";
    if ($("skillPayMode")) $("skillPayMode").value = "half";
    updateSkillFeeCopy();
    setStatus($("skillEnrollStatus"), "", true);
    $("skillEnrollModal").classList.add("is-on");
  }

  function updateSkillFeeCopy() {
    var id = $("skillEnrollId") && $("skillEnrollId").value;
    var skill = SKILLS_PROGRAMS.filter(function (s) { return s.id === id; })[0];
    var feeEl = $("skillEnrollFee");
    if (!skill || !feeEl) return;
    var mode = ($("skillPayMode") && $("skillPayMode").value) || "half";
    var half = Math.round(skill.fee / 2);
    feeEl.textContent =
      mode === "once"
        ? "Paying once: " + formatNaira(skill.fee) + " — unlocks enrollment + live classes."
        : "Pay half now (" + formatNaira(half) + "), then balance (" + formatNaira(skill.fee - half) + ") later.";
  }

  document.addEventListener("click", function (e) {
    var enrollBtn = e.target.closest("[data-enroll-skill]");
    if (enrollBtn) openSkillEnroll(enrollBtn.dataset.enrollSkill);
    if (e.target.id === "skillEnrollClose" || e.target === $("skillEnrollModal")) {
      if ($("skillEnrollModal")) $("skillEnrollModal").classList.remove("is-on");
    }
    if (e.target.id === "cbtUnlockClose") {
      closeCbtUnlockModal(true);
      return;
    }
    if (e.target === $("cbtUnlockModal")) {
      closeCbtUnlockModal();
      return;
    }
    // Clicks inside the modal panel must not bubble to overlay close logic elsewhere
    if (e.target.closest && e.target.closest("#cbtUnlockModal .modal")) {
      e.stopPropagation();
    }
    if (e.target.id === "cbtUnlockPickCoupon") {
      $("cbtUnlockChoice").hidden = true;
      $("cbtUnlockCoupon").hidden = false;
      $("cbtUnlockPay").hidden = true;
      if ($("cbtUnlockStatus")) {
        $("cbtUnlockStatus").textContent = "";
        $("cbtUnlockStatus").className = "form-status";
      }
    }
    if (e.target.id === "cbtUnlockPickPay") {
      $("cbtUnlockChoice").hidden = true;
      $("cbtUnlockCoupon").hidden = true;
      $("cbtUnlockPay").hidden = false;
      if ($("cbtUnlockStatus")) {
        $("cbtUnlockStatus").textContent = "";
        $("cbtUnlockStatus").className = "form-status";
      }
      loadCbtUnlockPackages();
    }
    if (e.target.id === "cbtUnlockRedeem") {
      var code = (($("cbtUnlockCode") && $("cbtUnlockCode").value) || "")
        .trim()
        .replace(/\s+/g, "")
        .toUpperCase();
      var statusEl = $("cbtUnlockStatus");
      if (!code) {
        if (statusEl) {
          statusEl.className = "form-status err";
          statusEl.textContent = "Enter your coupon code.";
        }
        return;
      }
      e.target.disabled = true;
      if (statusEl) {
        statusEl.className = "form-status";
        statusEl.textContent = "Checking coupon…";
      }
      api.api("/api/v1/cbt/coupons/redeem", {
        method: "POST",
        body: { code: code },
        timeout: 90000,
        retries: 2,
      })
        .then(function (res) {
          var next = cbtUnlockAfter;
          var boards = (res && res.boards) || [];
          try {
            sessionStorage.setItem("sia_cbt_just_unlocked", String(Date.now()));
            if (res && res.package_id) {
              sessionStorage.setItem("sia_cbt_package_id", String(res.package_id));
            }
            if (boards.length) {
              sessionStorage.setItem("sia_cbt_boards", JSON.stringify(boards));
            }
          } catch (s) {}
          closeCbtUnlockModal(true);
          examsCacheByKind = {};
          examsForMeCache = null;
          if (typeof loadCbtPackages === "function") {
            loadCbtPackages({ gridId: "cbtPackagesGrid", bannerId: "cbtAccessBanner" });
          }
          // Wait briefly so DB commit is visible, then start the exam
          if (typeof next === "function") {
            setTimeout(function () { next(); }, 400);
          } else if (typeof loadCbt === "function") {
            loadCbt();
          }
        })
        .catch(function (err) {
          if (statusEl) {
            statusEl.className = "form-status err";
            statusEl.textContent = errMsg(err) || "Coupon could not be redeemed.";
          }
        })
        .finally(function () { e.target.disabled = false; });
    }
  });
  if ($("skillPayMode")) $("skillPayMode").addEventListener("change", updateSkillFeeCopy);
  if ($("skillEnrollForm")) {
    $("skillEnrollForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = $("skillEnrollStatus");
      var btn = $("skillEnrollSubmit");
      var opts = {
        productType: "skill_enrollment",
        productId: $("skillEnrollId").value,
        full_name: $("skillEnrollName").value.trim(),
        phone: $("skillEnrollPhone").value.trim(),
        email: $("skillEnrollEmail").value.trim(),
        preferred_start: $("skillEnrollStart").value.trim(),
        notes: $("skillEnrollNotes").value.trim(),
        payment_mode: ($("skillPayMode") && $("skillPayMode").value) || "half",
        installment: 1,
        returnPage: "skills",
      };
      if (!opts.full_name || !opts.phone || !opts.email) {
        setStatus(statusEl, "Name, phone, and email are required.", false);
        return;
      }
      btn.disabled = true;
      btn.textContent = "Opening Paystack…";
      setStatus(statusEl, "Redirecting to Paystack…", true);
      window.paystackPurchase(opts).catch(function (err) {
        setStatus(statusEl, errMsg(err), false);
        btn.disabled = false;
        btn.textContent = "Continue to Paystack";
      });
    });
  }

  /* =====================================================================
     ASSIGNMENTS
     ===================================================================== */

  function loadAssignments() {
    var annWrap = $("announcementsList");
    var mineWrap = $("assignmentsMineList");
    var teacherSel = $("assignTeacherSelect");
    if (annWrap) annWrap.innerHTML = loadingHtml("Loading announcements…");
    if (mineWrap) mineWrap.innerHTML = loadingHtml("Loading your assignments…");

    api
      .api("/api/v1/community/announcements")
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "announcements"]);
        if (!annWrap) return;
        annWrap.innerHTML = items.length
          ? items
              .map(function (a) {
                return (
                  '<div class="feed-post"><div class="feed-post-head"><div class="feed-avatar">📢</div><div><strong>' +
                  esc(a.title || "Announcement") +
                  "</strong><span> " +
                  esc(fmtDate(a.created_at)) +
                  "</span></div></div><div class=\"feed-post-body\">" +
                  esc(a.content || a.message || "") +
                  "</div></div>"
                );
              })
              .join("")
          : emptyHtml("📢", "No announcements yet.");
      })
      .catch(function (err) {
        if (annWrap) annWrap.innerHTML = errorHtml(errMsg(err), "assignments");
      });

    api
      .api("/api/v1/community/assignments/mine")
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "assignments"]);
        if (!mineWrap) return;
        mineWrap.innerHTML = items.length
          ? items
              .map(function (a) {
                var status = a.status || (a.grade != null ? "graded" : "pending");
                return (
                  '<div class="card-list-row"><div><strong>' +
                  esc(a.caption || a.title || "Submission") +
                  "</strong><div class=\"card-meta-row\"><span>" +
                  esc(fmtDate(a.created_at)) +
                  "</span>" +
                  (a.grade != null ? "<span>Grade: " + esc(a.grade) + "</span>" : "") +
                  "</div></div><span class=\"badge " +
                  (status === "graded" ? "badge-green" : "badge-grey") +
                  "\">" +
                  esc(status) +
                  "</span></div>"
                );
              })
              .join("")
          : emptyHtml("📋", "You haven't submitted any assignments yet.");
      })
      .catch(function (err) {
        if (mineWrap) mineWrap.innerHTML = errorHtml(errMsg(err), "assignments");
      });

    api
      .api("/api/v1/profiles/teachers")
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "teachers"]);
        if (!teacherSel) return;
        teacherSel.innerHTML =
          '<option value="">Select teacher</option>' +
          items
            .map(function (t) {
              return '<option value="' + esc(t.id) + '">' + esc(t.full_name || t.name || "Teacher") + "</option>";
            })
            .join("");
      })
      .catch(function () {});
  }

  var assignmentForm = $("assignmentForm");
  if (assignmentForm) {
    assignmentForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var statusEl = $("assignmentStatus");
      var teacherId = $("assignTeacherSelect").value;
      var file = $("assignFileInput").files[0];
      var caption = $("assignCaption").value.trim();
      if (!teacherId || !file) {
        setStatus(statusEl, "Please choose a teacher and a file.", false);
        return;
      }
      var fd = new FormData();
      fd.append("file", file);
      fd.append("tagged_teacher_id", teacherId);
      fd.append("caption", caption);
      var btn = assignmentForm.querySelector("button[type=submit]");
      btn.disabled = true;
      setStatus(statusEl, "Uploading…", true);
      api
        .apiUpload("/api/v1/community/assignments", fd)
        .then(function () {
          setStatus(statusEl, "Submitted!", true);
          assignmentForm.reset();
          loadedPages.assignments = false;
          loadAssignments();
        })
        .catch(function (err) {
          setStatus(statusEl, errMsg(err), false);
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* Marketplace lives on marketplace.html (standalone). */

  /* =====================================================================
     TUTOR AI — SIA
     ===================================================================== */

  var siaHistory = [];
  var siaLevelSelect = $("siaLevelSelect");
  if (siaLevelSelect) {
    var savedLevel = localStorage.getItem("sia_education_level");
    if (savedLevel) {
      var optMatch = Array.prototype.some.call(siaLevelSelect.options, function (o) {
        return o.value.toUpperCase() === String(savedLevel).toUpperCase();
      });
      if (optMatch) siaLevelSelect.value = String(savedLevel).toUpperCase();
    }
    siaLevelSelect.addEventListener("change", function () {
      localStorage.setItem("sia_education_level", siaLevelSelect.value);
    });
    if (!localStorage.getItem("sia_education_level")) {
      localStorage.setItem("sia_education_level", siaLevelSelect.value);
    }
  }

  if ($("communityAv")) {
    $("communityAv").textContent = (user.name || "S").charAt(0).toUpperCase();
  }

  function addBubble(text, isMe) {
    var box = $("siaChat");
    if (!box) return;
    var welcome = box.querySelector(".sia-welcome");
    if (welcome) welcome.remove();
    var el = document.createElement("div");
    el.className = "bubble " + (isMe ? "me" : "bot");
    el.textContent = text;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  function askSia(text) {
    if (!text) return;
    var input = $("siaInput");
    if (input) input.value = "";
    addBubble(text, true);
    siaHistory.push({ role: "user", content: text });
    if (siaHistory.length > 12) siaHistory = siaHistory.slice(-12);

    var thinking = document.createElement("div");
    thinking.className = "bubble bot";
    thinking.textContent = "Sia is thinking…";
    $("siaChat").appendChild(thinking);
    $("siaChat").scrollTop = $("siaChat").scrollHeight;

    api
      .api("/api/v1/sia/ask", {
        method: "POST",
        body: {
          question: text,
          language: "english",
          education_level: (siaLevelSelect && siaLevelSelect.value) || "SS3",
          conversation_history: siaHistory,
          tutor_mode: "smart",
        },
      })
      .then(function (res) {
        var answer =
          (res && (res.sia || res.answer || res.response || res.reply || res.message || res.result)) ||
          "I couldn't find an answer for that just now.";
        thinking.remove();
        addBubble(answer, false);
        siaHistory.push({ role: "assistant", content: answer });
      })
      .catch(function (err) {
        thinking.remove();
        addBubble("Sorry, I ran into a problem: " + errMsg(err), false);
      });
  }

  var siaForm = $("siaForm");
  if (siaForm) {
    siaForm.addEventListener("submit", function (e) {
      e.preventDefault();
      askSia(($("siaInput") && $("siaInput").value.trim()) || "");
    });
  }

  document.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-sia-q]");
    if (chip) askSia(chip.dataset.siaQ);
  });

  if ($("siaClearChat")) {
    $("siaClearChat").addEventListener("click", function () {
      siaHistory = [];
      var box = $("siaChat");
      if (!box) return;
      box.innerHTML =
        '<div class="sia-welcome"><div class="sia-orb sm">S</div><div><strong>Hi, I’m Sia</strong><p>Ask me anything about your subjects. I’ll explain at your level with clear steps.</p></div></div>';
    });
  }

  /* =====================================================================
     COMMUNITY — General / Groups / Announcements
     ===================================================================== */

  var communityTab = "general";
  var communityGeneralChannelId = null;

  function setCommunityTab(tab) {
    communityTab = tab || "general";
    document.querySelectorAll(".comm-tab").forEach(function (b) {
      var on = b.getAttribute("data-comm-tab") === communityTab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var g = $("commPanelGeneral");
    var gr = $("commPanelGroups");
    var a = $("commPanelAnnouncements");
    if (g) {
      g.hidden = communityTab !== "general";
      g.classList.toggle("is-on", communityTab === "general");
    }
    if (gr) {
      gr.hidden = communityTab !== "groups";
      gr.classList.toggle("is-on", communityTab === "groups");
    }
    if (a) {
      a.hidden = communityTab !== "announcements";
      a.classList.toggle("is-on", communityTab === "announcements");
    }
    if (communityTab === "general") loadCommunityGeneral();
    else if (communityTab === "groups") loadCommunityGroupsTab();
    else if (communityTab === "announcements") loadCommunityAnnouncementsTab();
  }

  function loadCommunity() {
    setCommunityTab(communityTab || "general");
  }

  function loadCommunityGeneral() {
    var wrap = $("communityFeed");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading #general…");
    Promise.all([
      api.api("/api/v1/community/channels").catch(function () { return []; }),
      api.api("/api/v1/community/feed?limit=50").catch(function (err) { throw err; }),
    ])
      .then(function (pair) {
        var channels = Array.isArray(pair[0]) ? pair[0] : [];
        var general = channels.find(function (c) {
          return c.type === "general";
        });
        if (general) communityGeneralChannelId = general.id;
        var data = pair[1];
        var items = Array.isArray(data) ? data : firstArray(data, ["items", "results", "posts", "feed"]);
        if (!items.length) {
          wrap.innerHTML = emptyHtml("💬", "No posts in #general yet. Be the first to share something!");
          return;
        }
        wrap.innerHTML = items.map(renderCommunityPost).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "community");
      });
  }

  function loadCommunityAnnouncementsTab() {
    var wrap = $("communityAnnouncements");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading announcements…");
    api
      .api("/api/v1/community/announcements?limit=40")
      .then(function (data) {
        var items = Array.isArray(data) ? data : firstArray(data, ["items", "results", "posts", "announcements"]);
        if (!items.length) {
          wrap.innerHTML = emptyHtml("📢", "No announcements yet. Teachers post updates here.");
          return;
        }
        wrap.innerHTML = items.map(renderCommunityPost).join("");
      })
      .catch(function (err) {
        wrap.innerHTML = errorHtml(errMsg(err), "community");
      });
  }

  function loadCommunityGroupsTab() {
    var wrap = $("communityTabGroups");
    if (!wrap) return;
    wrap.innerHTML = loadingHtml("Loading groups…");
    Promise.all([
      api.api("/api/v1/student-groups/mine").catch(function () { return []; }),
      api.api("/api/v1/student-groups/community-listed").catch(function () {
        return api.api("/api/v1/student-groups/discover").catch(function () { return []; });
      }),
    ]).then(function (pair) {
      var mine = firstArray(pair[0], ["items", "groups", "results"]);
      if (Array.isArray(pair[0])) mine = pair[0];
      var discover = firstArray(pair[1], ["items", "groups", "results"]);
      if (Array.isArray(pair[1])) discover = pair[1];
      var cards = []
        .concat(
          mine.map(function (g) {
            return renderGroupCard(g, true);
          })
        )
        .concat(
          discover.map(function (g) {
            return renderGroupCard(g, false);
          })
        );
      wrap.innerHTML = cards.length
        ? cards.join("")
        : emptyHtml("👥", "No groups yet. Open Groups to create or join one.");
    }).catch(function (err) {
      wrap.innerHTML = errorHtml(errMsg(err), "community");
    });
  }

  function renderCommunityPost(p) {
    var name = p.author_name || p.full_name || (p.author && p.author.full_name) || "Student";
    var media = "";
    if (p.media_url && p.media_type === "audio") {
      media = '<audio controls src="' + esc(p.media_url) + '" style="width:100%;margin-top:0.5rem"></audio>';
    } else if (p.media_url && /image/i.test(String(p.media_type || ""))) {
      media = '<img src="' + esc(p.media_url) + '" alt="" style="max-width:100%;border-radius:12px;margin-top:0.5rem" />';
    }
    return (
      '<div class="feed-post"><div class="feed-post-head"><div class="feed-avatar">' +
      esc(name.charAt(0).toUpperCase()) +
      "</div><div><strong>" +
      esc(name) +
      "</strong><span> " +
      esc(fmtDate(p.created_at)) +
      "</span></div></div><div class=\"feed-post-body\">" +
      esc(p.content || p.text || "") +
      media +
      "</div></div>"
    );
  }

  var communityTabs = $("communityTabs");
  if (communityTabs) {
    communityTabs.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-comm-tab]");
      if (!btn) return;
      setCommunityTab(btn.getAttribute("data-comm-tab"));
    });
  }

  var communityPostForm = $("communityPostForm");
  if (communityPostForm) {
    communityPostForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("communityPostInput");
      var content = input.value.trim();
      if (!content) return;
      var btn = communityPostForm.querySelector("button[type=submit]");
      btn.disabled = true;

      function doPost(channelId) {
        var body = { content: content, visibility: "everyone" };
        if (channelId) body.channel_id = channelId;
        return api.api("/api/v1/community/posts", { method: "POST", body: body });
      }

      var ready = communityGeneralChannelId
        ? Promise.resolve(communityGeneralChannelId)
        : api.api("/api/v1/community/channels").then(function (channels) {
            var general = (channels || []).find(function (c) {
              return c.type === "general";
            });
            if (general) communityGeneralChannelId = general.id;
            return communityGeneralChannelId;
          });

      ready
        .then(function (channelId) {
          return doPost(channelId);
        })
        .then(function () {
          input.value = "";
          loadCommunityGeneral();
        })
        .catch(function (err) {
          alert("Could not post: " + errMsg(err));
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* =====================================================================
     GROUPS
     ===================================================================== */

  function renderGroupCard(g, mine) {
    var name = g.name || g.title || "Study group";
    var initial = name.charAt(0).toUpperCase();
    return (
      '<article class="group-card">' +
      '<div class="group-avatar">' + esc(initial) + "</div>" +
      "<h4>" + esc(name) + "</h4>" +
      (g.description ? "<p>" + esc(g.description) + "</p>" : "<p>Study group</p>") +
      '<div class="card-meta-row"><span>' +
      esc(g.member_count || (g.members && g.members.length) || 0) +
      " members</span>" +
      (mine ? '<span class="badge badge-purple">Yours</span>' : "") +
      "</div>" +
      '<div class="card-foot">' +
      (mine
        ? '<span class="badge badge-green">Joined</span>'
        : '<button type="button" class="btn btn-primary btn-mini" data-join-group="' + esc(g.id) + '">Request to join</button>') +
      "</div></article>"
    );
  }

  function loadGroups() {
    var mineWrap = $("myGroupsList");
    var commWrap = $("communityGroupsList");
    if (mineWrap) mineWrap.innerHTML = loadingHtml("Loading your groups…");
    if (commWrap) commWrap.innerHTML = loadingHtml("Loading community groups…");

    api
      .api("/api/v1/student-groups/mine")
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "groups"]);
        if (!mineWrap) return;
        mineWrap.innerHTML = items.length
          ? items.map(function (g) { return renderGroupCard(g, true); }).join("")
          : emptyHtml("👥", "No groups yet. Create one to start studying together.");
      })
      .catch(function (err) {
        if (mineWrap) mineWrap.innerHTML = errorHtml(errMsg(err), "groups");
      });

    api
      .api("/api/v1/student-groups/community-listed")
      .catch(function () {
        return api.api("/api/v1/student-groups/discover");
      })
      .then(function (data) {
        var items = firstArray(data, ["items", "results", "groups"]);
        if (Array.isArray(data)) items = data;
        items = (items || []).filter(function (g) { return !g.is_member; });
        if (!commWrap) return;
        commWrap.innerHTML = items.length
          ? items.map(function (g) { return renderGroupCard(g, false); }).join("")
          : emptyHtml("🌐", "No community groups listed yet.");
      })
      .catch(function (err) {
        if (commWrap) commWrap.innerHTML = errorHtml(errMsg(err), "groups");
      });
  }

  document.addEventListener("click", function (e) {
    var joinBtn = e.target.closest("[data-join-group]");
    if (!joinBtn) return;
    var id = joinBtn.dataset.joinGroup;
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";
    api
      .api("/api/v1/student-groups/" + id + "/join-request", { method: "POST" })
      .catch(function () {
        return api.api("/api/v1/student-groups/" + id + "/join", { method: "POST" });
      })
      .then(function () {
        joinBtn.textContent = "Requested ✓";
      })
      .catch(function (err) {
        joinBtn.disabled = false;
        joinBtn.textContent = "Join";
        alert("Could not join group: " + errMsg(err));
      });
  });

  if ($("showCreateGroupBtn")) {
    $("showCreateGroupBtn").addEventListener("click", function () {
      var form = $("createGroupForm");
      form.style.display = form.style.display === "none" ? "grid" : "none";
    });
  }
  if ($("cancelCreateGroupBtn")) {
    $("cancelCreateGroupBtn").addEventListener("click", function () {
      $("createGroupForm").style.display = "none";
    });
  }

  var createGroupForm = $("createGroupForm");
  if (createGroupForm) {
    createGroupForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("groupNameInput").value.trim();
      var description = $("groupDescInput").value.trim();
      if (!name) return;
      var statusEl = $("groupCreateStatus");
      var btn = createGroupForm.querySelector("button[type=submit]");
      btn.disabled = true;
      setStatus(statusEl, "Creating…", true);
      api
        .api("/api/v1/student-groups/", {
          method: "POST",
          body: { name: name, description: description, is_public: true, is_community_listed: true },
        })
        .then(function () {
          setStatus(statusEl, "Group created!", true);
          createGroupForm.reset();
          loadedPages.groups = false;
          loadGroups();
        })
        .catch(function (err) {
          setStatus(statusEl, errMsg(err), false);
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* =====================================================================
     SAVED
     ===================================================================== */

  function loadSaved() {
    renderSaved();
  }

  function renderSaved() {
    var wrap = $("savedList");
    if (!wrap) return;
    var items = readLocalJson("sia_saved_lives_web", []);
    if (!Array.isArray(items) || !items.length) {
      wrap.innerHTML = emptyHtml("▶", "No saved items yet. Save a live class from the Live Class page.");
      return;
    }
    wrap.innerHTML = items
      .map(function (it, i) {
        return (
          '<div class="card-list-row"><div><strong>' +
          esc(it.title || "Saved item") +
          "</strong><div class=\"card-meta-row\"><span>" +
          esc(fmtDate(it.savedAt)) +
          "</span></div></div><div class=\"btn-row\">" +
          (it.url
            ? '<button type="button" class="btn btn-primary btn-mini" data-play-saved="' + i + '">Play</button>'
            : '<span class="muted">No recording link</span>') +
          '<button type="button" class="btn btn-danger btn-mini" data-delete-saved="' +
          i +
          '">Delete</button></div></div>'
        );
      })
      .join("");
  }

  document.addEventListener("click", function (e) {
    var playBtn = e.target.closest("[data-play-saved]");
    if (playBtn) {
      var items = readLocalJson("sia_saved_lives_web", []);
      var it = items[parseInt(playBtn.dataset.playSaved, 10)];
      if (it && it.url) window.open(it.url, "_blank");
      return;
    }
    var delBtn = e.target.closest("[data-delete-saved]");
    if (delBtn) {
      var idx = parseInt(delBtn.dataset.deleteSaved, 10);
      var arr = readLocalJson("sia_saved_lives_web", []);
      arr.splice(idx, 1);
      writeLocalJson("sia_saved_lives_web", arr);
      renderSaved();
    }
  });

  /* =====================================================================
     CONTACT (static + client-side success)
     ===================================================================== */

  var contactForm = $("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      setStatus($("contactStatus"), "Message sent! We'll get back to you shortly.", true);
      contactForm.reset();
    });
  }

  /* =====================================================================
     PROFILE
     ===================================================================== */

  var subjectsCatalog = [];
  var selectedSubjects = [];

  function loadProfile() {
    api
      .api("/api/v1/students/me", { preferXhr: true, timeout: 35000, retries: 1 })
      .then(function (me) {
        if (!me) return;
        var name = me.full_name || me.name || user.name;
        $("profileText").textContent = name + " · " + (me.email || user.email) + " · Student";
        if (me.exam_type) {
          localStorage.setItem("sia_exam_type", me.exam_type);
          if ($("examTypeSelect")) $("examTypeSelect").value = me.exam_type;
        }
        if (me.education_level && $("eduLevelSelect")) $("eduLevelSelect").value = me.education_level;
        var loaded =
          (me.exam_type === "JAMB" && Array.isArray(me.jamb_subjects) && me.jamb_subjects.length
            ? me.jamb_subjects
            : null) ||
          (Array.isArray(me.ssce_subjects) && me.ssce_subjects.length ? me.ssce_subjects : null) ||
          (Array.isArray(me.selected_subjects) ? me.selected_subjects : null) ||
          (Array.isArray(me.subjects) ? me.subjects : null) ||
          [];
        selectedSubjects = loaded.slice();
        writeLocalJson("sia_subjects", selectedSubjects);
        refreshLocalExamBadges();
        renderSubjectChips();
      })
      .catch(function () {
        refreshLocalExamBadges();
      });

    var examType = localStorage.getItem("sia_exam_type");
    if (examType && $("examTypeSelect")) $("examTypeSelect").value = examType;
    selectedSubjects = readLocalJson("sia_subjects", []);
    if (!Array.isArray(selectedSubjects)) selectedSubjects = [];

    api
      .api("/api/v1/students/subjects", { preferXhr: true, timeout: 35000, retries: 1 })
      .then(function (data) {
        subjectsCatalog = firstArray(data, ["subjects", "items", "results"]);
        if (!subjectsCatalog.length && data && typeof data === "object") {
          Object.keys(data).forEach(function (k) {
            if (Array.isArray(data[k])) subjectsCatalog = subjectsCatalog.concat(data[k]);
          });
        }
        renderSubjectChips();
      })
      .catch(function (err) {
        var wrap = $("profileSubjectChips");
        if (wrap) wrap.innerHTML = errorHtml(errMsg(err), "profile");
      });
  }

  function renderSubjectChips() {
    var wrap = $("profileSubjectChips");
    if (!wrap) return;
    if (!subjectsCatalog.length) {
      wrap.innerHTML = emptyHtml("📚", "Subject list unavailable right now.");
      return;
    }
    wrap.innerHTML = subjectsCatalog
      .map(function (s) {
        var name = typeof s === "string" ? s : s.name || s.title || s.subject || "";
        var isSel = selectedSubjects.indexOf(name) > -1;
        return (
          '<button type="button" class="chip' +
          (isSel ? " is-selected" : "") +
          '" data-subject-chip="' +
          esc(name) +
          '">' +
          esc(name) +
          "</button>"
        );
      })
      .join("");
  }

  var subjectChipsWrap = $("profileSubjectChips");
  if (subjectChipsWrap) {
    subjectChipsWrap.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-subject-chip]");
      if (!chip) return;
      var name = chip.dataset.subjectChip;
      var idx = selectedSubjects.indexOf(name);
      if (idx > -1) selectedSubjects.splice(idx, 1);
      else selectedSubjects.push(name);
      renderSubjectChips();
    });
  }

  if ($("profileSaveBtn")) {
    $("profileSaveBtn").addEventListener("click", function () {
      var statusEl = $("profileSaveStatus");
      var examType = (($("examTypeSelect") && $("examTypeSelect").value) || "").toUpperCase().replace(/-/g, "_");
      var eduLevel = (($("eduLevelSelect") && $("eduLevelSelect").value) || "SS1").toUpperCase();
      if (!selectedSubjects.length) {
        setStatus(statusEl, "Select at least one subject.", false);
        return;
      }
      if (examType === "JAMB" && selectedSubjects.length !== 4) {
        setStatus(statusEl, "JAMB requires exactly 4 subjects (include English Language if you offer it).", false);
        return;
      }
      if ((examType === "WAEC" || examType === "NECO") && selectedSubjects.length !== 9) {
        setStatus(statusEl, examType + " requires exactly 9 subjects.", false);
        return;
      }

      var btn = $("profileSaveBtn");
      btn.disabled = true;
      setStatus(statusEl, "Saving…", true);

      // Always keep a local copy so CBT can use subjects even if the network flakes
      function commitLocal(note) {
        localStorage.setItem("sia_exam_type", examType);
        writeLocalJson("sia_subjects", selectedSubjects.slice());
        if (examType === "JAMB") writeLocalJson("sia_jamb_subjects", selectedSubjects.slice());
        if (examType === "WAEC" || examType === "NECO") writeLocalJson("sia_ssce_subjects", selectedSubjects.slice());
        refreshLocalExamBadges();
        if (cbtHomeCache) {
          cbtHomeCache.profile = cbtHomeCache.profile || {};
          if (examType === "JAMB") cbtHomeCache.profile.jamb_subjects = selectedSubjects.slice();
          else cbtHomeCache.profile.ssce_subjects = selectedSubjects.slice();
        }
        setStatus(statusEl, note || "Saved on this device.", true);
      }

      function postSetup(payload) {
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          var url = (api.API_BASE || "https://scholaxia1.onrender.com") + "/api/v1/students/setup-exam";
          xhr.open("POST", url, true);
          xhr.timeout = 45000;
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("Accept", "application/json");
          var tok = api.getToken ? api.getToken() : localStorage.getItem("sia_token");
          if (tok) xhr.setRequestHeader("Authorization", "Bearer " + tok);
          xhr.onload = function () {
            var data = null;
            try {
              data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
            } catch (e) {
              data = { detail: xhr.responseText || "Invalid response" };
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data);
              return;
            }
            var msg = (data && (data.detail || data.message)) || ("Request failed (" + xhr.status + ")");
            if (typeof msg === "object") msg = msg.message || JSON.stringify(msg);
            var err = new Error(String(msg));
            err.status = xhr.status;
            err.data = data;
            reject(err);
          };
          xhr.onerror = function () {
            var err = new Error("NETWORK");
            err.status = 0;
            reject(err);
          };
          xhr.ontimeout = function () {
            var err = new Error("TIMEOUT");
            err.status = 0;
            reject(err);
          };
          xhr.send(JSON.stringify(payload));
        });
      }

      // Try simple legacy payload first (most compatible), then dual-board payload
      var legacyBody = {
        exam_type: examType,
        subjects: selectedSubjects.slice(),
        education_level: eduLevel,
      };
      var dualBody = {
        education_level: eduLevel,
        exam_type: examType,
        subjects: selectedSubjects.slice(),
        enable_jamb: examType === "JAMB",
        jamb_subjects: examType === "JAMB" ? selectedSubjects.slice() : undefined,
        enable_ssce: examType === "WAEC" || examType === "NECO",
        ssce_exam_type: examType === "WAEC" || examType === "NECO" ? examType : undefined,
        ssce_subjects: examType === "WAEC" || examType === "NECO" ? selectedSubjects.slice() : undefined,
      };

      postSetup(legacyBody)
        .catch(function () {
          return postSetup(dualBody);
        })
        .then(function (res) {
          commitLocal("Saved! Your CBT will use these subjects.");
          if (res && Array.isArray(res.jamb_subjects)) {
            writeLocalJson("sia_jamb_subjects", res.jamb_subjects);
          }
        })
        .catch(function (err) {
          // Network flake: keep subjects locally so CBT / JAMB package still works
          if (!err || !err.status || err.message === "NETWORK" || err.message === "TIMEOUT") {
            commitLocal(
              "Saved on this device (server unreachable). CBT can use these subjects. Try Save again when online."
            );
            return;
          }
          setStatus(statusEl, errMsg(err), false);
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* =====================================================================
     Init
     ===================================================================== */

  if (typeof window.resumePendingPaystack === "function") {
    window.resumePendingPaystack().then(function (res) {
      if (!res) return;
      if (res.paid) {
        alert("Payment confirmed. Your access is updated.");
        var page = (res.pending && res.pending.returnPage) || "subscription";
        loadedPages[page] = false;
        showPage(page);
      }
    });
  }

  // Sidebar collapse (desktop) + mobile drawer
  function setSidebarCollapsed(collapsed) {
    var shell = $("appShell");
    var btn = $("sidebarToggle");
    if (!shell) return;
    shell.classList.toggle("sidebar-collapsed", !!collapsed);
    localStorage.setItem("sia_sidebar_collapsed", collapsed ? "1" : "0");
    if (btn) {
      btn.textContent = collapsed ? "›" : "‹";
      btn.setAttribute("aria-label", collapsed ? "Show menu" : "Hide menu");
      btn.title = collapsed ? "Show menu" : "Hide menu";
    }
  }

  function closeMobileNav() {
    document.body.classList.remove("nav-open");
    var bd = $("sidebarBackdrop");
    if (bd) bd.hidden = true;
  }
  function openMobileNav() {
    document.body.classList.add("nav-open");
    // On mobile, opening menu should not stay in collapsed desktop mode
    setSidebarCollapsed(false);
    var bd = $("sidebarBackdrop");
    if (bd) bd.hidden = false;
  }

  if (localStorage.getItem("sia_sidebar_collapsed") === "1") {
    setSidebarCollapsed(true);
  }

  if ($("sidebarToggle")) {
    $("sidebarToggle").addEventListener("click", function () {
      var shell = $("appShell");
      var collapsed = !(shell && shell.classList.contains("sidebar-collapsed"));
      setSidebarCollapsed(collapsed);
      if (!collapsed && window.matchMedia("(max-width: 900px)").matches) openMobileNav();
      if (collapsed) closeMobileNav();
    });
  }
  if ($("sidebarCloseBtn")) {
    $("sidebarCloseBtn").addEventListener("click", function () {
      if (window.matchMedia("(max-width: 900px)").matches) closeMobileNav();
      else setSidebarCollapsed(true);
    });
  }
  if ($("mobileMenuBtn")) {
    $("mobileMenuBtn").addEventListener("click", function () {
      if (document.body.classList.contains("nav-open")) closeMobileNav();
      else openMobileNav();
    });
  }
  if ($("backBtn")) {
    $("backBtn").addEventListener("click", function () {
      goBack();
    });
  }
  if ($("sidebarBackdrop")) {
    $("sidebarBackdrop").addEventListener("click", closeMobileNav);
  }
  // close handler already on side-link above

  if ($("stopLiveRingBtn")) {
    $("stopLiveRingBtn").addEventListener("click", function () {
      localStorage.setItem("sia_stop_live_ring", String(Date.now()));
      stopLiveClassRing();
    });
  }
  pollLiveInvitesForRing();
  setInterval(pollLiveInvitesForRing, 12000);

  // Wake Render before first dashboard load so Exam / Live / CBT screens do not flash network errors
  if (api.wakeServer) {
    api
      .wakeServer(60000)
      .catch(function () { return null; })
      .finally(function () {
        loadHome();
      });
  } else {
    loadHome();
  }
})();
