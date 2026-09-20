/** AI Teacher — chat + classroom with a live board.
 *  Speak (or type / snap a photo) → the AI teacher teaches aloud while key
 *  points, steps, formulas and code land on the board.
 *  Mic input: in Electron, Web Speech has no engine, so we record with
 *  MediaRecorder and transcribe on the server (POST /api/v1/sia/transcribe,
 *  Whisper via Groq/OpenAI). In a normal browser we use Web Speech directly.
 */

var vcState = {
  subject: "General",
  busy: false,
  listening: false,
  recognition: null,
  recorder: null,
  micStream: null,
  chunks: [],
  micPressedAt: 0,
  tapPending: false,
  suppressClick: false,
  micStarting: false,
  history: [],
  imagePreview: null,   // data URL of an attached photo
  imageFile: null,
  mode: "chat",          // "chat" (normal) | "class" (board classroom)
  chatLog: [],           // rendered chat bubbles [{role, content, image}]
};

var VC_LEVELS = ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3", "JAMB", "WAEC", "NECO"];

function vcSetMode(mode) {
  vcState.mode = mode === "class" ? "class" : "chat";
  try { localStorage.setItem("sia_vc_mode", vcState.mode); } catch (e) { /* ignore */ }
  var chatPanel = document.getElementById("vc-chat-panel");
  var classPanel = document.getElementById("vc-class-panel");
  var classActions = document.getElementById("vc-class-actions");
  var hint = document.getElementById("vc-mode-hint");
  var bChat = document.getElementById("vc-mode-chat");
  var bClass = document.getElementById("vc-mode-class");
  if (bChat) bChat.classList.toggle("is-on", vcState.mode === "chat");
  if (bClass) bClass.classList.toggle("is-on", vcState.mode === "class");
  var isChat = vcState.mode === "chat";
  if (chatPanel) chatPanel.classList.toggle("hidden", !isChat);
  if (classPanel) classPanel.classList.toggle("hidden", isChat);
  if (classActions) classActions.classList.toggle("hidden", isChat);
  if (hint) {
    hint.textContent = isChat
      ? "Normal chat — full answers with code, no board."
      : "Classroom — the teacher speaks while key points fill the board.";
  }
  var inp = document.getElementById("vc-input");
  if (inp) inp.placeholder = isChat ? "Message the AI teacher…" : "Ask the AI teacher anything…";
  if (isChat) vcRenderChat();
}

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
  return (localStorage.getItem("sia_education_level") || "");
}

function setVcLevel(level) {
  try { localStorage.setItem("sia_education_level", level); } catch (e) { /* ignore */ }
  var sel = document.getElementById("vc-level-select");
  if (sel) sel.value = level;
  var lbl = document.getElementById("vc-level-label");
  if (lbl) lbl.textContent = "Level: " + level;
}

async function vcSyncLevelFromProfile() {
  if (vcLevel()) return;
  try {
    var p = await api("/api/v1/students/me");
    if (p && p.education_level) { setVcLevel(p.education_level); return; }
  } catch (e) { /* ignore */ }
  if (!vcLevel()) setVcLevel("SS1");
}

/* Hold the mic to talk; release to send. A quick tap toggles instead. */
function vcInitMicButton() {
  var mic = document.getElementById("vc-mic-btn");
  if (!mic || mic.dataset.vcBound) return;
  mic.dataset.vcBound = "1";
  mic.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  mic.addEventListener("pointerdown", function (e) {
    if (e.button && e.button !== 0) return;
    vcState.micPressedAt = Date.now();
    if (!vcState.listening) vcToggleMic();
  });
  mic.addEventListener("pointerup", function () {
    if (!vcState.listening) return;
    if (Date.now() - (vcState.micPressedAt || 0) > 700) {
      vcState.suppressClick = true; // held long enough — release sends it
      vcMicStop();
    } else {
      vcState.tapPending = true;    // quick tap — the click toggles off
    }
  });
  mic.addEventListener("pointercancel", function () {
    if (vcState.listening) {
      vcState.suppressClick = true;
      vcMicStop();
    }
  });
  mic.addEventListener("click", function () {
    if (vcState.suppressClick) { vcState.suppressClick = false; return; }
    if (vcState.tapPending) { vcState.tapPending = false; vcToggleMic(); return; }
    if (!vcState.listening) vcToggleMic(); // keyboard activation
  });
  mic.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      vcState.suppressClick = true;
      vcToggleMic();
    }
  });
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
      if (vcState.mode !== "chat") vcBoardNote("Subject: " + sel.value, "point");
    });
  }
  var lvlSel = document.getElementById("vc-level-select");
  if (lvlSel && !lvlSel.options.length) {
    lvlSel.innerHTML = VC_LEVELS.map(function (l) {
      return '<option value="' + vcEsc(l) + '">' + vcEsc(l) + "</option>";
    }).join("");
    lvlSel.addEventListener("change", function () { setVcLevel(lvlSel.value); });
  }
  if (vcLevel()) setVcLevel(vcLevel());
  vcSyncLevelFromProfile();
  var saved = localStorage.getItem("sia_vc_board");
  if (saved) {
    try { vcRenderBoard(JSON.parse(saved)); } catch (e) { /* ignore */ }
  } else {
    vcRenderWelcome();
  }
  var savedMode = "chat";
  try { savedMode = localStorage.getItem("sia_vc_mode") || "chat"; } catch (e) { /* ignore */ }
  vcSetMode(savedMode);
  vcInitMicButton();
  vcSyncButtons();
}

/* ── Normal chat view (mode = chat) ─────────────────────────────────────── */
function vcBubble(role, content, image) {
  vcState.chatLog.push({ role: role, content: content, image: image || null });
  vcRenderChat();
}

function vcRenderChat() {
  var el = document.getElementById("vc-chat");
  if (!el) return;
  var name = (localStorage.getItem("sia_name") || "Student").split(" ")[0];
  if (!vcState.chatLog.length) {
    el.innerHTML =
      '<div class="vc-chat-welcome">👋 Hi ' + vcEsc(name) +
      '! Ask anything — type it, tap <strong>🎤 Hold to ask</strong> and speak, or send a photo. ' +
      "Tap 🔊 on a reply to hear it.</div>";
    return;
  }
  el.innerHTML = vcState.chatLog.map(function (m, i) {
    var img = m.image ? '<img class="vc-msg-image" src="' + m.image + '" alt="" />' : "";
    var speak = m.role === "assistant"
      ? '<button type="button" class="vc-speak-btn" onclick="vcSpeakMsg(' + i + ')" title="Read aloud">🔊</button>'
      : "";
    return (
      '<div class="vc-msg ' + (m.role === "user" ? "vc-msg-user" : "vc-msg-sia") + '">' +
      '<div class="vc-msg-avatar">' + (m.role === "user" ? vcEsc((name || "S")[0] || "S") : "S") + "</div>" +
      '<div class="vc-msg-bubble">' + img + vcFormat(m.content) + speak + "</div>" +
      "</div>"
    );
  }).join("");
  el.scrollTop = el.scrollHeight;
}

function vcSpeakMsg(i) {
  var m = vcState.chatLog[i];
  if (m && typeof siaSpeak === "function") {
    siaVoiceEnabled = true;
    siaSpeak(m.content);
  }
}

function vcFormat(text) {
  var s = vcEsc(text);
  // fenced code blocks
  s = s.replace(/```(\w+)?\n?([\s\S]*?)```/g, function (_, lang, code) {
    return '<pre class="vc-code-block">' + code + "</pre>";
  });
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/^###?\s*(.+)$/gm, "<strong>$1</strong>");
  s = s.replace(/\n/g, "<br />");
  return s;
}

function vcRenderWelcome() {
  var name = (localStorage.getItem("sia_name") || "Student").split(" ")[0];
  vcRenderBoard([
    { type: "heading", content: "Welcome, " + name + "!" },
    { type: "point", content: "Tap the mic 🎤 (Hold to ask), speak, then tap again to send." },
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
    var span = mic.querySelector("span");
    if (span) span.textContent = vcState.listening ? "Listening…" : "🎤 Hold to ask";
  }
  var ask = document.getElementById("vc-ask-btn");
  if (ask) ask.disabled = vcState.busy;
  var send = document.querySelector(".vc-send");
  if (send) send.disabled = vcState.busy;
}

/* ── Mic: tap to start, tap again to send ────────────────────────────────── */
function vcIsElectron() {
  return /Electron/i.test(navigator.userAgent || "");
}

function vcRecorderExt(mime) {
  mime = mime || "";
  if (mime.indexOf("mp4") >= 0 || mime.indexOf("aac") >= 0) return ".m4a";
  if (mime.indexOf("ogg") >= 0) return ".ogg";
  return ".webm";
}

/** Server speech-to-text (used inside Electron, where Web Speech has no engine). */
async function vcTranscribeBlob(blob, ext) {
  var base = typeof API_BASE !== "undefined" ? API_BASE : "";
  var token = typeof getToken === "function" ? getToken() : "";
  if (!token) throw new Error("Please sign in to use the mic.");
  var fd = new FormData();
  fd.append("audio", blob, "clip" + (ext || ".webm"));
  fd.append("language", "en");
  var res = await fetch(base + "/api/v1/sia/transcribe", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd,
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.detail || "Could not transcribe the recording. Try again.");
  return String(data.text || "").trim();
}

async function vcMicStartRecorder() {
  if (vcState.micStarting || vcState.listening) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    alert("Voice input is not available here. Type your question instead — the AI teacher still speaks the answer.");
    return;
  }
  vcState.micStarting = true;
  var stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    vcState.micStarting = false;
    alert("Could not access the microphone. Allow mic access for Scholaxia (Windows Settings → Privacy → Microphone), or type your question.");
    return;
  }
  var mime = "";
  var types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (var i = 0; i < types.length; i++) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
  }
  var rec;
  try {
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (e) {
    vcState.micStarting = false;
    stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e2) { /* ignore */ } });
    alert("Could not start the microphone. Type your question instead.");
    return;
  }
  vcState.chunks = [];
  rec.ondataavailable = function (e) {
    if (e.data && e.data.size) vcState.chunks.push(e.data);
  };
  rec.onstop = async function () {
    stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e2) { /* ignore */ } });
    var ext = vcRecorderExt(rec.mimeType || mime);
    var blob = new Blob(vcState.chunks, { type: (rec && rec.mimeType) || mime || "audio/webm" });
    vcState.chunks = [];
    vcState.recorder = null;
    vcState.micStream = null;
    if (blob.size < 1200) { vcStatus("Didn't catch that — tap the mic and speak a little longer."); return; }
    vcStatus("Understanding your voice…");
    try {
      var said = await vcTranscribeBlob(blob, ext);
      if (!said) { vcStatus("Didn't hear anything. Tap the mic and try again."); return; }
      var inp = document.getElementById("vc-input");
      if (inp) inp.value = said;
      vcStatus("");
      vcAsk();
    } catch (e) {
      vcStatus("");
      alert(e.message || "Voice input failed. Type your question instead.");
    }
  };
  vcState.recorder = rec;
  vcState.micStream = stream;
  rec.start(250);
  vcState.listening = true;
  vcState.micStarting = false;
  vcStatus("Listening… release 🎤 to send");
  vcSyncButtons();
}

function vcMicStop() {
  if (vcState.recognition) {
    try { vcState.recognition.stop(); } catch (e) { /* ignore */ }
    return;
  }
  if (vcState.recorder) {
    try { vcState.recorder.stop(); } catch (e) { /* ignore */ }
    vcState.listening = false;
    vcSyncButtons();
  }
}

function vcToggleMic() {
  if (vcState.listening) { vcMicStop(); return; }
  // Electron's Chromium has the Web Speech API but no speech engine — record
  // and transcribe on the server instead. Browsers use Web Speech directly.
  if (vcIsElectron()) { vcMicStartRecorder(); return; }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { vcMicStartRecorder(); return; }
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
  r.onerror = function (ev) {
    var code = ev && ev.error;
    vcState.listening = false;
    vcStatus("");
    vcSyncButtons();
    if (code === "not-allowed" || code === "service-not-allowed") {
      vcMicStartRecorder();
    } else if (code !== "aborted" && code !== "no-speech") {
      vcMicStartRecorder();
    }
  };
  r.onend = function () {
    vcState.listening = false;
    vcStatus("");
    vcSyncButtons();
  };
  vcState.recognition = r;
  try { r.start(); } catch (e) { vcState.listening = false; vcMicStartRecorder(); }
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
  if (!vcLevel()) {
    vcStatus("Pick your class level first (top of the screen).");
    return;
  }

  vcState.busy = true;
  vcStatus(vcState.mode === "chat" ? "The AI teacher is typing…" : "The AI teacher is thinking…");
  vcSyncButtons();
  if (inp) inp.value = "";
  var imagePreview = vcState.imagePreview;
  var board = [{ type: "heading", content: q || "📷 Photo question" }];

  if (vcState.mode === "chat") {
    vcBubble("user", q || "📷 Photo", imagePreview);
    vcClearImage();
  }

  // The teacher speaks — same voice service as the rest of the app.
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
      if (vcState.mode !== "chat") vcClearImage();
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
    if (vcState.mode === "chat") {
      // Normal chat: full answer inline. Speak only if Voice is ON.
      vcBubble("assistant", answer);
      if (typeof siaVoiceEnabled !== "undefined" && siaVoiceEnabled) speakAnswer(answer);
    } else {
      vcRenderBoard(board);
      speakAnswer(answer);
    }
    vcStatus("");
  } catch (e) {
    var msg = e.message || "Something went wrong. Try again.";
    vcStatus(msg);
    // The status line is only visible in Classroom mode — surface errors in chat too.
    if (vcState.mode === "chat") vcBubble("assistant", "⚠️ " + msg);
  } finally {
    vcState.busy = false;
    vcSyncButtons();
  }
}

if (typeof window !== "undefined") {
  window.loadVoiceClassroom = loadVoiceClassroom;
  window.vcSetMode = vcSetMode;
  window.vcToggleMic = vcToggleMic;
  window.vcAsk = vcAsk;
  window.vcPickImage = vcPickImage;
  window.vcImageSelected = vcImageSelected;
  window.vcClearImage = vcClearImage;
  window.vcSpeakMsg = vcSpeakMsg;
  document.addEventListener("DOMContentLoaded", vcInitMicButton);
  if (document.readyState !== "loading") vcInitMicButton();
}
