/** Sia Voice Classroom — the AI teacher with a live board.
 *  Speak (or type / snap a photo) → Sia teaches aloud while key points,
 *  steps, formulas and code land on the board. Mirrors the Flutter app's
 *  SiaVoiceClassroomScreen. */

var vcState = {
  subject: "General",
  busy: false,
  listening: false,
  recognition: null,
  history: [],
  imagePreview: null,   // data URL of an attached photo
  imageFile: null,
};

var VC_SUBJECTS = [
  "General", "Mathematics", "English Language", "Physics", "Chemistry",
  "Biology", "Economics", "Government", "Literature", "Geography",
  "Computer Studies", "Agricultural Science",
];

function vcEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function vcLevel() {
  return (localStorage.getItem("sia_level") || localStorage.getItem("sia_education_level") || "SS1");
}

function loadVoiceClassroom() {
  if (typeof isCbtExamActive === "function" && isCbtExamActive()) {
    var err = document.getElementById("vc-error");
    if (err) err.textContent = "Finish your exam before using the AI teacher.";
    return;
  }
  var sel = document.getElementById("vc-subject");
  if (sel && !sel.options.length) {
    sel.innerHTML = VC_SUBJECTS.map(function (s) {
      return '<option value="' + vcEsc(s) + '">' + vcEsc(s) + "</option>";
    }).join("");
    sel.value = vcState.subject;
    sel.addEventListener("change", function () {
      vcState.subject = sel.value;
      vcBoardNote("Subject: " + sel.value, "point");
    });
  }
  var lvl = document.getElementById("vc-level-label");
  if (lvl) lvl.textContent = "Level: " + vcLevel();
  var saved = localStorage.getItem("sia_vc_board");
  if (saved) {
    try { vcRenderBoard(JSON.parse(saved)); } catch (e) { /* ignore */ }
  } else {
    vcRenderWelcome();
  }
  vcSyncButtons();
}

function vcRenderWelcome() {
  var name = (localStorage.getItem("sia_name") || "Student").split(" ")[0];
  vcRenderBoard([
    { type: "heading", content: "Welcome, " + name + "!" },
    { type: "point", content: "Hold the mic 🎤 and ask your question — or type it below." },
    { type: "point", content: "Send a photo 📷 of your homework and I'll read it." },
    { type: "point", content: "I speak the answer out loud — key points appear on this board." },
  ]);
}

function vcIconForType(t) {
  if (t === "heading") return "📌";
  if (t === "step") return "➜";
  if (t === "formula" || t === "equation") return "🧮";
  if (t === "example") return "✏️";
  if (t === "diagram_hint") return "📐";
  if (t === "code") return "💻";
  return "•";
}

function vcRenderBoard(items) {
  var el = document.getElementById("vc-board");
  if (!el) return;
  items = (items || []).slice(0, 18);
  el.innerHTML = items.length
    ? items.map(function (it) {
        var isCode = it.type === "code";
        return (
          '<div class="vc-board-item vc-' + vcEsc(it.type) + '">' +
          '<span class="vc-item-icon">' + vcIconForType(it.type) + "</span>" +
          (isCode ? "<pre>" + vcEsc(it.content) + "</pre>" : "<span>" + vcEsc(it.content) + "</span>") +
          "</div>"
        );
      }).join("")
    : '<div class="vc-board-empty">Ask anything to fill the board.</div>';
  try { localStorage.setItem("sia_vc_board", JSON.stringify(items)); } catch (e) { /* ignore */ }
  el.scrollTop = el.scrollHeight;
}

function vcBoardNote(title, type) {
  vcRenderBoard([{ type: type || "heading", content: title }]);
}

function vcMergeBoard(existing, incoming) {
  var seen = {};
  (existing || []).forEach(function (i) { seen[i.content.slice(0, 50)] = 1; });
  var merged = (existing || []).slice(0, 12);
  (incoming || []).forEach(function (i) {
    if (!seen[i.content.slice(0, 50)]) { merged.push(i); seen[i.content.slice(0, 50)] = 1; }
  });
  return merged.slice(-18);
}

function vcStatus(msg) {
  var el = document.getElementById("vc-status");
  if (el) el.textContent = msg || "";
}

function vcSyncButtons() {
  var mic = document.getElementById("vc-mic-btn");
  if (mic) {
    mic.classList.toggle("is-recording", vcState.listening);
    mic.querySelector("span").textContent = vcState.listening ? "Listening…" : "Hold to ask";
  }
  var ask = document.getElementById("vc-ask-btn");
  if (ask) ask.disabled = vcState.busy;
}

/* ── Mic: push-to-talk (tap once, tap again to send) ─────────────────────── */
function vcMicSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function vcToggleMic() {
  if (vcState.listening) {
    try { vcState.recognition && vcState.recognition.stop(); } catch (e) { /* ignore */ }
    return;
  }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Voice input needs Chrome or Edge. Type your question below — the AI teacher still speaks the answer.");
    return;
  }
  var r = new SR();
  r.lang = "en-US";
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onstart = function () {
    vcState.listening = true;
    vcStatus("Listening… speak now");
    vcSyncButtons();
  };
  r.onresult = function (ev) {
    var said = ((ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript) || "").trim();
    if (said) {
      var inp = document.getElementById("vc-input");
      if (inp) inp.value = said;
      vcAsk();
    }
  };
  r.onerror = function () {
    vcState.listening = false;
    vcStatus("");
    vcSyncButtons();
  };
  r.onend = function () {
    vcState.listening = false;
    vcStatus("");
    vcSyncButtons();
  };
  vcState.recognition = r;
  try { r.start(); } catch (e) { vcState.listening = false; }
}

/* ── Photo attach ────────────────────────────────────────────────────────── */
function vcPickImage() {
  document.getElementById("vc-image-input").click();
}

function vcImageSelected(inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  inputEl.value = "";
  if (!file) return;
  vcState.imageFile = file;
  var reader = new FileReader();
  reader.onload = function (e) {
    vcState.imagePreview = e.target.result;
    var pv = document.getElementById("vc-image-preview");
    if (pv) { pv.src = vcState.imagePreview; pv.style.display = "block"; }
  };
  reader.readAsDataURL(file);
}

function vcClearImage() {
  vcState.imageFile = null;
  vcState.imagePreview = null;
  var pv = document.getElementById("vc-image-preview");
  if (pv) { pv.src = ""; pv.style.display = "none"; }
}

/* ── Ask the AI teacher ──────────────────────────────────────────────────── */
async function vcAsk() {
  if (vcState.busy) return;
  var inp = document.getElementById("vc-input");
  var q = (inp && inp.value.trim()) || "";
  var hasImage = !!vcState.imageFile;
  if (!q && !hasImage) return;
  if (typeof isCbtExamActive === "function" && isCbtExamActive()) {
    vcStatus("Finish your exam first.");
    return;
  }

  vcState.busy = true;
  vcStatus("Sia is thinking…");
  vcSyncButtons();
  if (inp) inp.value = "";
  var board = [{ type: "heading", content: q || "📷 Photo question" }];

  // Sia speaks — same voice service as the rest of the app.
  function speakAnswer(text) {
    if (typeof siaSpeak === "function") {
      siaVoiceEnabled = true;
      siaSpeak(text);
    }
  }

  try {
    var base = typeof API_BASE !== "undefined" ? API_BASE : "";
    var token = typeof getToken === "function" ? getToken() : "";
    var answer = "";

    if (hasImage) {
      var fd = new FormData();
      fd.append("image", vcState.imageFile);
      fd.append("question", q || "Teach me what is in this image");
      fd.append("subject", vcState.subject);
      fd.append("language", "english");
      var res = await fetch(base + "/api/v1/sia/analyze-image", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.detail || "Could not read the image.");
      answer = data.sia || data.answer || "";
      vcClearImage();
    } else {
      var hist = vcState.history.slice(-8).map(function (m) {
        return { role: m.role, content: m.content };
      });
      var res2 = await fetch(base + "/api/v1/sia/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          question: q,
          subject: vcState.subject,
          language: "english",
          education_level: vcLevel(),
          tutor_mode: "smart",
          conversation_history: hist,
        }),
      });
      var data2 = await res2.json().catch(function () { return {}; });
      if (!res2.ok) throw new Error(data2.detail || "The AI teacher could not answer.");
      answer = data2.sia || data2.answer || "";
      if (data2.board && data2.board.length) {
        board = vcMergeBoard(board, data2.board);
      } else {
        try {
          var r = await fetch(base + "/api/v1/sia/extract-board", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ text: answer }),
          });
          if (r.ok) {
            var bd = await r.json();
            board = vcMergeBoard(board, bd.board || []);
          }
        } catch (e2) { /* board extraction optional */ }
      }
    }

    vcState.history.push({ role: "user", content: q || "📷 photo" });
    vcState.history.push({ role: "assistant", content: answer });
    vcRenderBoard(board);
    vcStatus("");
    speakAnswer(answer);
  } catch (e) {
    vcStatus(e.message || "Something went wrong. Try again.");
  } finally {
    vcState.busy = false;
    vcSyncButtons();
  }
}

window.loadVoiceClassroom = loadVoiceClassroom;
window.vcToggleMic = vcToggleMic;
window.vcAsk = vcAsk;
window.vcPickImage = vcPickImage;
window.vcImageSelected = vcImageSelected;
window.vcClearImage = vcClearImage;
