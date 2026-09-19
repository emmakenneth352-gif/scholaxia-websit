/** Site Sia voice — reads Tutor AI replies aloud + mic speech-to-text.
 *  Same backend voice service as the mobile/desktop apps. */

let siaVoiceOn = localStorage.getItem("sia_web_voice") !== "0";
let siaVoiceAudio = null;
let siaVoiceObjectUrl = null;
let siaMicRecognition = null;
let siaMicBusy = false;

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
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
}

function siaSpeakBrowser(text) {
  if (!window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.02;
    u.lang = "en-US";
    const pick = window.speechSynthesis.getVoices().find(v => {
      const n = (v.name || "").toLowerCase();
      return n.includes("zira") || n.includes("samantha") || n.includes("jenny") || n.includes("female");
    });
    if (pick) u.voice = pick;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    return false;
  }
}

async function siaSpeak(text) {
  if (!siaVoiceOn) return;
  const cleaned = siaVoiceClean(text);
  if (!cleaned) return;
  siaStopVoice();
  try {
    const res = await fetch(`${API}/api/v1/sia/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: cleaned, language: "english" }),
    });
    if (res.ok) {
      const blob = await res.blob();
      if (blob && blob.size > 0) {
        siaVoiceRevokeUrl();
        siaVoiceObjectUrl = URL.createObjectURL(blob);
        siaVoiceAudio = new Audio(siaVoiceObjectUrl);
        siaVoiceAudio.onended = () => siaVoiceRevokeUrl();
        await siaVoiceAudio.play();
        return;
      }
    }
  } catch (e) {
    /* fall through to browser TTS */
  }
  siaSpeakBrowser(cleaned);
}

function siaToggleVoice() {
  siaVoiceOn = !siaVoiceOn;
  localStorage.setItem("sia_web_voice", siaVoiceOn ? "1" : "0");
  if (!siaVoiceOn) siaStopVoice();
  syncVoiceButtons();
}

function syncVoiceButtons() {
  const vb = document.getElementById("voice-btn");
  if (vb) {
    vb.textContent = siaVoiceOn ? "🔊 Voice on" : "🔇 Voice off";
    vb.setAttribute("aria-pressed", siaVoiceOn ? "true" : "false");
    vb.classList.toggle("voice-off", !siaVoiceOn);
  }
}

function siaMicSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function siaMicStart() {
  if (siaMicBusy) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Voice input needs Chrome or Edge. You can still type your question.");
    return;
  }
  const input = document.getElementById("chat-input");
  try {
    siaMicRecognition = new SR();
    siaMicRecognition.lang = "en-US";
    siaMicRecognition.interimResults = false;
    siaMicRecognition.maxAlternatives = 1;
    siaMicRecognition.onstart = () => {
      siaMicBusy = true;
      const mb = document.getElementById("mic-btn");
      if (mb) { mb.classList.add("is-recording"); mb.title = "Listening…"; }
    };
    siaMicRecognition.onresult = (ev) => {
      const said = ((ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript) || "").trim();
      if (said) {
        input.value = said;
        sendMessage();
      }
    };
    siaMicRecognition.onerror = () => { siaMicBusy = false; document.getElementById("mic-btn")?.classList.remove("is-recording"); };
    siaMicRecognition.onend = () => { siaMicBusy = false; document.getElementById("mic-btn")?.classList.remove("is-recording"); };
    siaMicRecognition.start();
  } catch (e) {
    siaMicBusy = false;
    alert("Could not start the microphone. Check permission and try again.");
  }
}

window.addEventListener("load", syncVoiceButtons);
