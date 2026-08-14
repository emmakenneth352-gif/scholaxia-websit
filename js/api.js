/* Scholaxia website API — calls production backend */
(function (global) {
  var API_BASE = "https://scholaxia1.onrender.com";
  global.API_BASE = API_BASE;

  function fetchTimeout(ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, ms || 25000);
    ctrl.signal.addEventListener("abort", function () { clearTimeout(timer); });
    return ctrl.signal;
  }

  async function wakeServer(ms) {
    try {
      await fetch(API_BASE + "/health", {
        mode: "no-cors",
        cache: "no-store",
        signal: fetchTimeout(ms || 8000),
      });
    } catch (e) { /* ignore */ }
  }

  function friendlyFetchError(err) {
    var name = (err && err.name) || "";
    var msg = (err && err.message) || "";
    if (name === "AbortError" || /aborted|abort/i.test(msg)) {
      return "Server took too long. Wait 20 seconds and try again (it may be waking up).";
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return "Cannot reach the Scholaxia API. Wait a minute if the server is restarting, then try again.";
    }
    return msg || "Request failed";
  }

  function getToken() {
    var teacherTok = localStorage.getItem("sia_teacher_token") || localStorage.getItem("sia_admin_token") || "";
    var studentTok = localStorage.getItem("sia_token") || "";
    var role = "";
    try {
      role = localStorage.getItem("sia_role") || "";
    } catch (e) {}
    try {
      var path = String(window.location.pathname || "");
      var onClassroom = /classroom(\.html)?$/i.test(path) || /\/classroom/i.test(path);
      var sess = null;
      try {
        sess = JSON.parse(localStorage.getItem("live_session") || "null");
      } catch (e2) {
        sess = null;
      }
      var sessRole = (sess && sess.role) || "";
      // Host classroom must never send a leftover student JWT — presence/students will 403.
      if (onClassroom && (sessRole === "teacher" || sessRole === "admin")) {
        return teacherTok || studentTok;
      }
      if (onClassroom && sessRole === "student") {
        return studentTok || teacherTok;
      }
      if (role === "teacher" || role === "admin") {
        return teacherTok || studentTok;
      }
      if (role === "vendor") {
        // Vendors store JWT in sia_token — never prefer a leftover teacher token.
        return studentTok || teacherTok;
      }
      if (role === "student" || role === "kind") {
        return studentTok || teacherTok;
      }
    } catch (e) {}
    return teacherTok || studentTok;
  }

  function getUser() {
    return {
      name: localStorage.getItem("sia_name") || "User",
      email: localStorage.getItem("sia_email") || "",
      role: localStorage.getItem("sia_role") || "student",
      ageGroup: localStorage.getItem("sia_age_group") || "",
    };
  }

  function saveSession(data, email, nameOverride) {
    var role = (data && data.role) || "student";
    var token = data && data.access_token;
    if (!token) return;

    if (role === "teacher" || role === "admin") {
      localStorage.setItem("sia_teacher_token", token);
    } else {
      localStorage.setItem("sia_token", token);
    }
    localStorage.setItem("sia_role", role);
    if (email) localStorage.setItem("sia_email", email);
    var name =
      nameOverride ||
      (data.user && data.user.full_name) ||
      localStorage.getItem("sia_name") ||
      email ||
      "User";
    localStorage.setItem("sia_name", name);
  }

  function clearSession() {
    [
      "sia_token",
      "sia_teacher_token",
      "sia_role",
      "sia_name",
      "sia_email",
      "sia_exam_type",
      "sia_subjects",
      "sia_age_group",
    ].forEach(function (k) {
      localStorage.removeItem(k);
    });
  }

  async function parseResponse(res) {
    var text = await res.text();
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { detail: text || "Invalid response" };
    }
    if (!res.ok) {
      var msg =
        (data && (data.detail || data.message)) ||
        "Request failed (" + res.status + ")";
      if (typeof msg === "object") msg = JSON.stringify(msg);
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function api(path, options) {
    options = options || {};
    var headers = Object.assign(
      { "Content-Type": "application/json", Accept: "application/json" },
      options.headers || {}
    );
    var token = getToken();
    if (token && !options.noAuth && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }
    var tries = options.retries == null ? 1 : options.retries;
    var lastErr = null;
    for (var i = 0; i <= tries; i++) {
      try {
        var res = await fetch(API_BASE + path, {
          method: options.method || "GET",
          mode: "cors",
          headers: headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          credentials: "omit",
          cache: "no-store",
          signal: fetchTimeout(options.timeout || 20000),
        });
        return await parseResponse(res);
      } catch (err) {
        lastErr = err;
        var msg = (err && err.message) || "";
        var retryable = /failed to fetch|networkerror|load failed|aborted/i.test(msg) || err.name === "AbortError";
        if (!retryable || i === tries) break;
        await new Promise(function (resolve) { setTimeout(resolve, 600); });
      }
    }
    if (lastErr && options.noAuth && (options.method || "GET").toUpperCase() === "POST") {
      try {
        return await xhrJson(path, headers, options);
      } catch (xhrErr) {
        throw lastErr;
      }
    }
    throw lastErr;
  }

  function xhrJson(path, headers, options) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(options.method || "POST", API_BASE + path, true);
      xhr.timeout = options.timeout || 20000;
      Object.keys(headers || {}).forEach(function (k) {
        try { xhr.setRequestHeader(k, headers[k]); } catch (e) {}
      });
      xhr.onload = function () {
        var data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {
          data = { detail: xhr.responseText || "Invalid response" };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        var msg = (data && (data.detail || data.message)) || ("Request failed (" + xhr.status + ")");
        if (typeof msg === "object") msg = JSON.stringify(msg);
        var err = new Error(msg);
        err.status = xhr.status;
        reject(err);
      };
      xhr.onerror = function () { reject(new Error("Failed to fetch")); };
      xhr.ontimeout = function () { reject(new Error("The user aborted a request.")); };
      xhr.send(options.body ? JSON.stringify(options.body) : null);
    });
  }

  async function apiUpload(path, formData, options) {
    options = options || {};
    var headers = { Accept: "application/json" };
    var token = getToken();
    if (token && !options.noAuth && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }
    var res = await fetch(API_BASE + path, {
      method: options.method || "POST",
      headers: headers,
      body: formData,
      credentials: "omit",
      signal: options.signal || fetchTimeout(90000),
    });
    return parseResponse(res);
  }

  function dashboardForRole(role) {
    if (role === "teacher" || role === "admin") return "teacher.html";
    if (role === "kind") return "kind.html";
    if (role === "vendor") return "vendor.html";
    return "student.html";
  }

  function requireAuth(expectedRoles) {
    var role = localStorage.getItem("sia_role") || "";
    var token = getToken();
    if (!token) {
      window.location.href = "auth.html";
      return false;
    }
    if (expectedRoles && expectedRoles.indexOf(role) < 0) {
      window.location.href = dashboardForRole(role);
      return false;
    }
    return true;
  }

  global.ScholaxiaAPI = {
    API_BASE: API_BASE,
    api: api,
    apiUpload: apiUpload,
    wakeServer: wakeServer,
    friendlyFetchError: friendlyFetchError,
    fetchTimeout: fetchTimeout,
    getToken: getToken,
    getUser: getUser,
    saveSession: saveSession,
    clearSession: clearSession,
    dashboardForRole: dashboardForRole,
    requireAuth: requireAuth,
  };
})(window);
