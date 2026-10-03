<p align="center">
  <a href="README.md">中文</a> &nbsp;|&nbsp; <b>English</b>
</p>

<div align="center">

<img src="./banner.png" alt="IME Companion" width="100%">

# IME Companion

**AI, beside the cursor**

Summon AI in any app, then drop the result straight back where you were typing.

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?style=flat-square\&logo=windows)

![Framework](https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square\&logo=tauri)

![Rust](https://img.shields.io/badge/Rust-2021%20edition-DEA584?style=flat-square\&logo=rust)

![WebView](https://img.shields.io/badge/WebView2-Chromium-5865F2?style=flat-square)

![Size](https://img.shields.io/badge/installer-%3C%2015%20MB-4CAF50?style=flat-square)

</div>

---

## ✨ What it is

You know the loop: you want one sentence polished while writing an email, a doc, or a reply, so you —

> Select → copy → switch to the browser → open an AI site → paste → wait → copy → switch back → paste

**IME Companion turns those 9 steps into 2.**

It sits in the Windows system tray. Press a global shortcut and a small panel appears near the cursor. Type or paste, pick a command, and the result is **inserted back into the app you were using**.

Your place in the text stays put. You do not change windows, and the formatting stays intact.

---

## 📸 Preview

### Main panel, floating above any app

![Main panel](./panel.png)

The panel is a borderless window that follows the place you are typing. The input, the command picker, and the result all fit on one screen.

### Motion: summon → type → run

![Panel workflow](./demo-panel.gif)

### Motion: tray menu → open settings

![Tray](./demo-tray.gif)

Right-click the tray icon for three entries: **Open AI panel / Open settings / Quit**.  
The tray tooltip reads `IME Companion · AI 增强 — 状态：就绪 · 双击打开面板 · 右键菜单`.

![Tray menu](./tray-menu.png)

### Motion: settings workspace

![Settings workspace](./demo-settings.gif)

The settings window is a full workspace with seven sections: **Home / Models / Commands / Queue / Appearance / Privacy / Statistics**.

![Settings window](./settings.png)

---

## 🎯 What it does

|    | Capability | What it means |
| -- | --- | --- |
| ⌨️ | **Global summon** | In any app, in any text field, the shortcut opens the AI panel. No window switching. |
| 📥 | **Insert back** | When a result is ready, it is pasted (automatically, or with the insert shortcut) into **the window you were focused on**. The cursor stays where it was. |
| 🧩 | **Built-in commands** | Ready to use: translate to Chinese, translate to English, polish, summarize, expand, correct. |
| ✍️ | **Custom commands** | Write your own prompts and save them. One of them can be the default. |
| 🤖 | **Many models** | OpenAI-compatible endpoints: LM Studio, OpenRouter, OpenAI, DeepSeek, Groq, Together, SiliconFlow, Moonshot, NVIDIA NIM, or any custom URL. |
| 🏆 | **Model race** | Probe several candidate models at once and keep the one that is available, or the fastest, as the current model. |
| 🌐 | **Classic translate APIs** | Besides a large model, send translation straight through Baidu, Youdao, or DeepL. |
| 📋 | **Clipboard / selection** | Use the clipboard or the current selection as the input. |
| 🧷 | **Panel stacking** | `default`, `upper`, or `always_top`, so the panel does not cover what you are reading. |
| 🚀 | **Start with Windows** | Launch at login and stay in the tray until you call it. |
| 🔤 | **Chinese and English UI** | Built-in `zh` and `en` interface languages. |
| 🔒 | **Local first** | Settings and keys stay on this machine. Nothing is relayed through a server of ours. |

---

## 🚀 Quick start

### 1. Install

1. Download the latest `ime-ai-companion.exe` from **Releases** (under 15 MB, a single portable file).
2. Double-click it. No main window appears — **it lives in the system tray**.
3. Windows 11, and updated Windows 10, already include the WebView2 runtime. If it fails to start, install the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

> Windows may hide the tray icon under the overflow chevron. Click `^` on the taskbar to find it.

### 2. Point it at a model

1. Right-click the tray icon → **Open settings** → **Models**.
2. Pick a provider. OpenRouter as an example:
   - `Provider`: `OpenRouter`
   - `Base URL`: `https://openrouter.ai/api/v1`
   - `Model`: for example `deepseek/deepseek-chat`
   - Fill in the API key
3. Click **Test connection**, then save once it succeeds.

Want it fully local? Choose `LM Studio` and set `Base URL` to `http://localhost:1234/v1`.

### 3. Use it

- Click the place you want to type (WeChat, Word, mail, an IDE, a form, …)
- Press the panel shortcut to open the **AI panel**
- Type or paste → pick a command → run
- When the result is ready, press the **insert shortcut** to put it back in the original field

---

## ⌨️ Shortcuts

The app registers **two global shortcuts**. Both can be changed under **Settings → Home**:

| Shortcut | Effect |
| --- | --- |
| **Panel shortcut** | Show or hide the AI panel from anywhere |
| **Insert shortcut** | Paste the latest result into the external window that had focus |

**Double-click the tray icon** also opens the panel.

> If the insert shortcut says it cannot tell which window should receive the paste, focus is still inside this app.  
> Click the target text field first, then press insert again.

---

## 🔌 Providers

All of them speak the **OpenAI-compatible** protocol. Set `Base URL`, `Model`, and `Key`:

| Provider | Notes |
| --- | --- |
| `LM Studio` | Local models. Default `http://localhost:1234/v1` |
| `OpenRouter` | One key, hundreds of models. Optional site URL and app name for attribution |
| `OpenAI` | Official API |
| `DeepSeek` | DeepSeek |
| `Groq` | Fast inference |
| `Together` | Together AI |
| `SiliconFlow` | SiliconFlow |
| `Moonshot` | Moonshot Kimi |
| `NVIDIA NIM` | NVIDIA inference microservices |
| `Custom` | Any OpenAI-compatible endpoint (your gateway, a proxy, vLLM, and so on) |

### Classic translation endpoints (optional)

When you do not want a large model to translate, configure these separately in Settings:

- **Baidu Translate**: APP ID + secret
- **Youdao Translate**: appKey + app secret
- **DeepL**: `api.deepl.com` or `api-free.deepl.com`

---

## ⚙️ Settings file

Settings live on this machine, in `settings.json` under the Tauri app data directory. The main fields:

```jsonc
{
  "global_shortcut": "…",          // global shortcut that opens the panel
  "inject_global_shortcut": "…",   // global shortcut that inserts the result
  "auto_inject_enabled": true,     // insert automatically when generation finishes
  "panel_zorder_mode": "always_top", // default | upper | always_top
  "autostart_enabled": true,       // start with Windows
  "openrouter_site_url": "",       // OpenRouter attribution: site
  "openrouter_app_name": "",       // OpenRouter attribution: app name
  "competition": {                 // model race
    "enabled": false,
    "default_command_id": "…",
    "auto_start_on_enqueue": true,
    "max_queue_size": 8,
    "persist_queue": true,
    "unified_command": true
  },
  "queue": { "…": "…" },           // task queue
  "translation": { "…": "…" }      // Baidu / Youdao / DeepL
}
```

Each model entry also has `identifier`, `provider`, `base_url`, `model`, and `timeout_secs`.

---

## 🧩 Where it helps

- **Email and replies**: write it plainly, polish it into a business tone, put it back
- **Across languages**: Chinese ↔ English without opening a website; the translation lands in the chat box
- **Long text**: paste a passage and get a summary or an expansion
- **Correction**: fix typos and awkward phrasing, and return only the corrected text
- **Code comments and docs**: open the panel inside an IDE and insert the text into the editor
- **Forms**: any text field in a web page works

---

## 🛠 Stack

| Layer | Choice |
| --- | --- |
| Shell | **Tauri 2** (Rust), window class `Tauri Window` |
| Rendering | **WebView2** (Chromium), bundle id `com.ime.aicompanion` |
| Frontend | Single-page app. Route `#/panel` is the panel; the rest is the settings workspace |
| Plugins | `global-shortcut`, `autostart`, `opener`, `menu` |
| Capabilities | System tray, global hotkeys, clipboard, simulated paste, streaming output, task queue |

Panel route: `http://tauri.localhost/index.html#/panel`  
Settings window title: `AI 增强`. Panel window title: `AI 增强面板`.

### Security policy

The WebView uses a strict CSP:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: asset:;
connect-src ipc: http://ipc.localhost http://127.0.0.1:* https://* http://localhost:*
```

Only `tauri://` and local IPC can talk to the app, which keeps remote scripts out.

---

## 🔒 Data and privacy

- Settings and API keys stay in the **local** app data directory. They are not uploaded.
- Requests go from your computer straight to the provider you chose. This app does not relay them.
- The **Privacy** section lets you manage that local data yourself.

---

## ❓ FAQ

**Q: I cannot find the tray icon.**  
A: Windows hides it in the overflow area. Click `^` at the right of the taskbar. You can also pin it under **Taskbar → Other system tray icons**.

**Q: Insert says it cannot tell which window should receive the paste.**  
A: Focus is still in this app. Click the target text field, then press insert again.

**Q: The model list will not load.**  
A: `Base URL` needs to be an OpenAI-compatible `/v1` endpoint, and the response needs a `data[].id` list.

**Q: Can I use it offline?**  
A: Yes. Choose `LM Studio`, or any local OpenAI-compatible server (an Ollama compatibility layer, vLLM, and so on), and point `Base URL` at this machine.

**Q: Can the interface be English?**  
A: **Settings → Appearance** switches the UI language. The app stores it as `ui_locale`.

---

## 🗺 Roadmap

- [ ] macOS / Linux
- [ ] More built-in command templates
- [ ] Result history and one-click reuse
- [ ] Custom themes
- [ ] Capture the selection without copying it by hand

---

## 📄 License

MIT License. See [LICENSE](./LICENSE).

---

<div align="center">

If this saves you the copy-paste round trip, a star helps.

</div>
