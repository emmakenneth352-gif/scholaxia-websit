/** Student Sia voice — reads Tutor AI replies aloud + mic speech-to-text.
 *  Mirrors the kids app voice (kind-voice.js) and the mobile SiaVoiceService. */

var siaVoiceEnabled = true;
var siaVoiceAudio = null;
var siaVoiceObjectUrl = null;
var siaMicActive = false;
var _siaRecognition = null;

function siaVoiceClean(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1400);
}

function siaVoiceRevokeUrl() {
  if (siaVoiceObjectUrl) {
    try { URL.revokeObjectURL(siaVoiceObjectUrl); } catch (e) { /* ignore */ }
    siaVoiceObjectUrl = null;
  }
}

function siaStopVoice() {
  if (siaVoiceAudio) {
    try {
      siaVoiceAudio.pause();
      siaVoiceAudio.currentTime = 0;
    } catch (e) { /* ignore */ }
    siaVoiceAudio = null;
  }
  siaVoiceRevokeUrl();
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
}

function siaSpeakBrowser(text) {
  if (!window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.02;
    u.lang = "en-US";
    var voices = window.speechSynthesis.getVoices();
    var pick = voices.find(function (v) {
      var n = (v.name || "").toLowerCase();
      return n.indexOf("zira") >= 0 || n.indexOf("samantha") >= 0 || n.indexOf("jenny") >= 0 || n.indexOf("female") >= 0;
    });
    if (pick) u.voice = pick;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    return false;
  }
}

async function siaSpeak(text) {
  if (!siaVoiceEnabled) return;
  var cleaned = siaVoiceClean(text);
  if (!cleaned) return;
  siaStopVoice();

  var base = typeof API_BASE !== "undefined" ? API_BASE : "";
  var token = typeof getToken === "function" ? getToken() : "";
  if (base && token) {
    try {
      var res = await fetch(base + "/api/v1/sia/speak", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ text: cleaned, language: "english" }),
      });
      if (res.ok) {
        var blob = await res.blob();
        if (blob && blob.size > 0) {
          siaVoiceRevokeUrl();
          siaVoiceObjectUrl = URL.createObjectURL(blob);
          siaVoiceAudio = new Audio(siaVoiceObjectUrl);
          siaVoiceAudio.onended = function () { siaVoiceRevokeUrl(); };
          await siaVoiceAudio.play();
          return;
        }
      }
    } catch (e) {
      /* fall through to browser TTS */
    }
  }
  siaSpeakBrowser(cleaned);
}

function siaToggleVoice() {
  siaVoiceEnabled = !siaVoiceEnabled;
  try { localStorage.setItem("sia_voice_on", siaVoiceEnabled ? "1" : "0"); } catch (e) { /* ignore */ }
  if (!siaVoiceEnabled) siaStopVoice();
  document.querySelectorAll(".sia-voice-toggle").forEach(function (btn) {
    btn.textContent = siaVoiceEnabled ? "🔊 Voice on" : "🔇 Voice off";
    btn.setAttribute("aria-pressed", siaVoiceEnabled ? "true" : "false");
  });
}

/* ── Mic: speech-to-text into the Sia input ─────────────────────────────── */

function siaMicSupported() {
  var SR = (window.SpeechRecognition || window.webkitSpeechRecognition);
  return !!SR;
}

function siaMicStart() {
  if (siaMicActive) return;
  var SR = (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) {
    alert("Voice input needs Chrome or Edge (or an updated app). Type your question instead — Sia can still read answers aloud.");
    return;
  }
  var input = document.getElementById("sia-input");
  try {
    _siaRecognition = new SR();
    _siaRecognition.lang = "en-US";
    _siaRecognition.interimResults = false;
    _siaRecognition.maxAlternatives = 1;
    _siaRecognition.onstart = function () {
      siaMicActive = true;
      var btn = document.getElementById("sia-mic-btn");
      if (btn) { btn.classList.add("is-recording"); btn.textContent = "🎤 Listening…"; }
    };
    _siaRecognition.onresult = function (ev) {
      var said = (ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript) || "";
      said = said.trim();
      if (said && input) {
        input.value = said;
        if (typeof sendSiaMessage === "function") sendSiaMessage();
      }
    };
    _siaRecognition.onerror = function () {
      siaMicActive = false;
      var btn = document.getElementById("sia-mic-btn");
      if (btn) { btn.classList.remove("is-recording"); btn.textContent = "🎤 Speak"; }
    };
    _siaRecognition.onend = function () {
      siaMicActive = false;
      var btn = document.getElementById("sia-mic-btn");
      if (btn) { btn.classList.remove("is-recording"); btn.textContent = "🎤 Speak"; }
    };
    _siaRecognition.start();
  } catch (e) {
    siaMicActive = false;
    alert("Could not start the microphone. Check permission and try again.");
  }
}

/* Init saved preference */
try {
  if (localStorage.getItem("sia_voice_on") === "0") siaVoiceEnabled = false;
} catch (e) { /* ignore */ }

if (typeof window !== "undefined") {
  window.siaSpeak = siaSpeak;
  window.siaStopVoice = siaStopVoice;
  window.siaToggleVoice = siaToggleVoice;
  window.siaMicStart = siaMicStart;
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = function () { /* preload voices */ };
  }
}
