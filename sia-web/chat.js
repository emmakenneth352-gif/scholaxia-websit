const API = "https://scholaxia1.onrender.com";

let token = localStorage.getItem("sia_token") || "";
let userName = localStorage.getItem("sia_name") || "";
let chats = JSON.parse(localStorage.getItem("sia_chats") || "[]");
let currentChatId = null;
let selectedImage = null;

window.onload = () => {
  if (!token) { window.location.href = "auth.html"; return; }
  const name = firstName(userName);
  document.getElementById("user-name-display").textContent = name;
  document.getElementById("user-avatar").textContent = name[0].toUpperCase();
  renderHistory();
};

function firstName(name) {
  if (!name) return "Student";
  if (name.includes("@")) return name.split("@")[0].split(".")[0];
  return name.split(" ")[0];
}

function logout() {
  localStorage.clear();
  window.location.href = "auth.html";
}

// ── Chat management ────────────────────────────────────
function newChat() {
  currentChatId = Date.now().toString();
  chats.unshift({ id: currentChatId, title: "New chat", messages: [] });
  saveChats(); renderHistory(); clearMessages();
}

function loadChat(id) {
  currentChatId = id;
  const chat = chats.find(c => c.id === id);
  if (!chat) return;
  clearMessages();
  chat.messages.forEach(m => appendMessage(m.role, m.content, m.imageUrl, false));
  if (chat.messages.length > 0) showMessages();
  renderHistory();
}

function clearMessages() {
  document.getElementById("messages").innerHTML = "";
  document.getElementById("messages").classList.remove("has-messages");
  document.getElementById("empty-state").style.display = "flex";
}

function showMessages() {
  document.getElementById("messages").classList.add("has-messages");
  document.getElementById("empty-state").style.display = "none";
}

function renderHistory() {
  const el = document.getElementById("chat-history");
  el.innerHTML = chats.slice(0, 20).map(c => `
    <div class="history-item ${c.id === currentChatId ? "active" : ""}" onclick="loadChat('${c.id}')">
      ${escHtml(c.title)}
    </div>
  `).join("");
}

function saveChats() {
  localStorage.setItem("sia_chats", JSON.stringify(chats.slice(0, 30)));
}

// ── Image upload ───────────────────────────────────────
function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  selectedImage = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("preview-img").src = e.target.result;
    document.getElementById("image-preview").style.display = "block";
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  selectedImage = null;
  document.getElementById("image-preview").style.display = "none";
  document.getElementById("image-input").value = "";
}

// ── Send message ───────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  const hasImage = !!selectedImage;
  if (!text && !hasImage) return;

  const subject = "General";
  const mode = "ask";
  const language = "english";

  input.value = "";
  input.style.height = "auto";

  if (!currentChatId) {
    currentChatId = Date.now().toString();
    const title = text ? text.slice(0, 40) : "Image question";
    chats.unshift({ id: currentChatId, title, messages: [] });
    saveChats(); renderHistory();
  }

  showMessages();
  const imageUrl = hasImage ? URL.createObjectURL(selectedImage) : null;
  appendMessage("user", text || "📷 Image sent", imageUrl);
  saveToChat("user", text || "📷 Image sent", imageUrl);

  const chat = chats.find(c => c.id === currentChatId);
  if (chat && chat.title === "New chat") {
    chat.title = (text || "Image question").slice(0, 40);
    saveChats(); renderHistory();
  }

  const typingId = showTyping();
  document.getElementById("send-btn").disabled = true;

  try {
    let answer;

    if (hasImage) {
      const formData = new FormData();
      formData.append("image", selectedImage);
      formData.append("question", text || "Analyze this image and help me understand it");
      formData.append("subject", subject);
      formData.append("language", language);
      const res = await fetch(`${API}/api/v1/sia/analyze-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.status === 401) { window.location.href = "auth.html"; return; }
      const data = await res.json();
      answer = data.sia || "Sorry, I couldn't analyze that image.";
      clearImage();
    } else {
      const body = buildRequestBody(mode, text, subject, language);
      if (chat) {
        const history = chat.messages.slice(-6);
        if (history.length > 0) {
          body.conversation_history = history.map(m => ({
            role: m.role === "sia" ? "assistant" : "user",
            content: m.content
          }));
        }
      }
      const res = await fetch(`${API}/api/v1/sia/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.status === 401) { window.location.href = "auth.html"; return; }
      const data = await res.json();
      answer = data.sia || data.result || data.answer || "Sorry, I couldn't get a response.";
    }

    removeTyping(typingId);
    await typeMessage("sia", answer);
    saveToChat("sia", answer);
    if (typeof siaSpeak === "function") siaSpeak(answer);

  } catch (e) {
    removeTyping(typingId);
    if (e.name === "AbortError" || e.message?.includes("timeout")) {
      appendMessage("sia", "Sia is thinking... the server is warming up. Please send your message again in a moment.");
    } else {
      appendMessage("sia", "Something went wrong. Please try again.");
    }
  } finally {
    document.getElementById("send-btn").disabled = false;
  }
}

function buildRequestBody(mode, text, subject, language) {
  // Do NOT send education_level — let Sia ask the student for their class
  const base = { subject, language };
  switch (mode) {
    case "ask": return { ...base, question: text };
    case "explain": return { ...base, topic: text };
    case "solve": return { ...base, question: text };
    case "evaluate": return { ...base, question: text, student_answer: text };
    case "generate-questions": return { ...base, topic: text, number: 5, curriculum: "WAEC" };
    case "feedback": return { ...base };
    default: return { ...base, question: text };
  }
}

function sendSuggestion(question, subject) {
  document.getElementById("chat-input").value = question;
  sendMessage();
}

function saveToChat(role, content, imageUrl = null) {
  const chat = chats.find(c => c.id === currentChatId);
  if (chat) { chat.messages.push({ role, content, imageUrl }); saveChats(); }
}

// ── DOM helpers ────────────────────────────────────────
function appendMessage(role, content, imageUrl = null, scroll = true) {
  const el = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = `message ${role}`;
  const imgHtml = imageUrl ? `<img src="${imageUrl}" class="msg-image" alt="Sent image" />` : "";
  div.innerHTML = `
    <div class="msg-avatar">${role === "sia" ? "S" : firstName(userName)[0].toUpperCase()}</div>
    <div class="msg-content">${imgHtml}${formatContent(content)}</div>
  `;
  el.appendChild(div);
  if (scroll) el.scrollTop = el.scrollHeight;
}

// ── Typewriter effect ──────────────────────────────────
async function typeMessage(role, content, imageUrl = null) {
  const el = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = `message ${role}`;

  const imgHtml = imageUrl ? `<img src="${imageUrl}" class="msg-image" alt="Sent image" />` : "";
  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";
  if (imgHtml) contentDiv.innerHTML = imgHtml;

  div.innerHTML = `<div class="msg-avatar">S</div>`;
  div.appendChild(contentDiv);
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;

  // Type character by character at ~18ms per char (fast but visible)
  let displayed = "";
  const speed = 12; // ms per character — lower = faster
  for (let i = 0; i < content.length; i++) {
    displayed += content[i];
    contentDiv.innerHTML = imgHtml + formatContent(displayed) + '<span class="cursor">▋</span>';
    el.scrollTop = el.scrollHeight;
    await new Promise(r => setTimeout(r, speed));
  }
  // Remove cursor, render final clean content
  contentDiv.innerHTML = imgHtml + formatContent(content);
  el.scrollTop = el.scrollHeight;
}

function showTyping() {
  const el = document.getElementById("messages");
  const id = "typing-" + Date.now();
  const div = document.createElement("div");
  div.className = "message sia"; div.id = id;
  div.innerHTML = `<div class="msg-avatar">S</div><div class="msg-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatContent(text) {
  return text.split("\n\n").map(para => {
    const lines = para.split("\n").map(line => {
      line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      line = line.replace(/\*(.*?)\*/g, "<em>$1</em>");
      return line;
    });
    return `<p>${lines.join("<br/>")}</p>`;
  }).join("");
}

function escHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

// ── Mobile sidebar toggle ──────────────────────────────
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebar-overlay").classList.toggle("open");
}
