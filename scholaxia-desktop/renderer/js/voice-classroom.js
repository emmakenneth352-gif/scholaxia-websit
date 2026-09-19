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
  mode: "chat",          // "chat" (normal) | "class" (board classroom)
  chatLog: [],           // rendered chat bubbles [{role, content, image}]
};

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
      : "Classroom — Sia speaks while key points fill the board.";
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
  var savedMode = "chat";
  try { savedMode = localStorage.getItem("sia_vc_mode") || "chat"; } catch (e) { /* ignore */ }
  vcSetMode(savedMode);
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
  if (!vcState.chatLog.length) {
    var name = (localStorage.getItem("sia_name") || "Student").split(" ")[0];
    el.innerHTML =
      '<div class="vc-chat-welcome">👋 Hi ' + vcEsc(name) +
      '! Chat normally — ask anything, send a photo, or use the mic. ' +
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
      '<div class="vc-msg-avatar">' + (m.role === "user" ? vcEsc(name[0] || "S") : "S") + "</div>" +
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
  vcStatus(vcState.mode === "chat" ? "Sia is typing…" : "Sia is thinking…");
  vcSyncButtons();
  if (inp) inp.value = "";
  var imagePreview = vcState.imagePreview;
  var board = [{ type: "heading", content: q || "📷 Photo question" }];

  if (vcState.mode === "chat") {
    vcBubble("user", q || "📷 Photo", imagePreview);
    vcClearImage();
  }

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
