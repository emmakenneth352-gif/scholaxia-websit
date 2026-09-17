const { app, BrowserWindow, shell, screen } = require("electron");
const path = require("path");
const { startDesktopServer, stopDesktopServer } = require("./desktop-server");
let mainWindow;
let appBaseUrl = "";

// Admin console keeps its own design (local renderer admin.html).
const LOCAL_START_URL = "admin.html";

function isLocalServerUrl(u) {
  return /^https?:\/\/127\.0\.0\.1:17890/i.test(u) || /^https?:\/\/localhost:17890/i.test(u);
}

function getWindowSize() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const width = Math.min(1280, Math.max(900, Math.floor(sw * 0.92)));
  const height = Math.min(860, Math.max(640, Math.floor(sh * 0.9)));
  const minWidth = Math.min(768, width);
  const minHeight = Math.min(600, height);
  return { width, height, minWidth, minHeight };
}

function createWindow() {
  const size = getWindowSize();
  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    title: "Scholaxia Admin Console",
    icon: path.join(__dirname, "assets", "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    backgroundColor: "#0a1410",
    resizable: true,
    fullscreenable: true,
  });

  const startUrl = appBaseUrl ? `${appBaseUrl}/admin.html` : LOCAL_START_URL;
  if (appBaseUrl) mainWindow.loadURL(startUrl);
  else mainWindow.loadFile(LOCAL_START_URL);
  if (size.width >= screen.getPrimaryDisplay().workAreaSize.width * 0.95) {
    mainWindow.maximize();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalServerUrl(url)) {
      mainWindow.loadURL(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (e, url) => {
    const ok = /^https?:\/\/127\.0\.0\.1:17890/i.test(url) ||
      /^https?:\/\/localhost:17890/i.test(url) ||
      /^file:/i.test(url) || url.indexOf("about:") === 0;
    if (!ok) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(async () => {
  try {
    appBaseUrl = await startDesktopServer();
  } catch (err) {
    console.error("Desktop server failed, falling back to file://", err);
    appBaseUrl = "";
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopDesktopServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
