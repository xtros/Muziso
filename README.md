# 🎵 Muziso

<p align="center">
  <img src="https://i.postimg.cc/yYvXBWK5/Muziso.png" alt="Muziso Showcase" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/xtros/Muziso/releases"><img src="https://img.shields.io/github/v/release/xtros/Muziso?color=ccff00&label=Release&style=for-the-badge" alt="Latest Release" /></a>
  <a href="https://github.com/xtros/Muziso/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-ccff00?style=for-the-badge" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-181825?style=for-the-badge&logo=github" alt="Platforms" />
  <img src="https://img.shields.io/badge/Tauri-v2-FFC107?style=for-the-badge&logo=tauri&logoColor=black" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18" />
</p>

<p align="center">
  <b>Muziso</b> is a premium, dark-themed, glassmorphic desktop music player built for modern listeners. Powered by a high-performance <b>React (TypeScript)</b> + <b>Rust (Tauri v2)</b> engine, Muziso seamlessly combines local library playback, high-fidelity web audio resolution, and offline caching.
</p>

---

## 🌟 Key Features

- 🎧 **Hybrid Audio Engine**: Play local music collections (`.mp3`, `.m4a`, `.wav`, `.opus`, `.flac`) alongside dynamic online streams.
- ⚡ **IP-Bound Stream Resolution**: Dynamically extracts high-quality audio streams using a local, platform-decoupled `yt-dlp` sidecar engine.
- 📥 **Offline Download & Library Management**: Save tracks locally for immediate offline playback with custom metadata and artwork indexing.
- 🔀 **Smart Queue & Shuffle Pipeline**: Shuffled play queue with intelligent un-shuffle state tracking and deterministic historical navigation.
- 📣 **Developer Announcement Feed**: In-app announcements feed with read/unread tracking and remote notification sync.
- 🎨 **Glassmorphic Cyber-Minimal UI**: High-fidelity dark mode with signature neon branding (`#ccff00`), smooth Framer Motion transitions, custom modal overlays, and responsive routing resets.
- 🎚️ **Decoupled Controls**: Native event isolation preventing gesture overlap between drag sliders, volume controllers, and swipe overlays.

---

## ⚡ Download & Installation

Visit the **[Muziso Releases Page](https://github.com/xtros/Muziso/releases)** to grab the latest standalone installer for your system:

| Platform | Package Format | Download Link |
| :--- | :--- | :--- |
| **Windows** | `.exe` / `.msi` / `.zip` | [Latest Windows Release](https://github.com/xtros/Muziso/releases/latest) |
| **macOS** | `.dmg` / `.app` | [Latest macOS Release](https://github.com/xtros/Muziso/releases/latest) |
| **Linux** | `.deb` / `.AppImage` | [Latest Linux Release](https://github.com/xtros/Muziso/releases/latest) |

> [!NOTE]
> **Windows SmartScreen Notice**: Because Muziso is an open-source binary without a paid commercial certificate, Windows Defender SmartScreen may display an *"Unknown Publisher"* prompt on first launch. Click **"More info"** &rarr; **"Run anyway"** to continue.

---

## 🛠️ Tech Stack & Architecture

- **Frontend Core**: React 18, TypeScript, Framer Motion, Lucide Icons, Vanilla CSS Design System
- **Desktop Architecture**: Tauri v2 (Rust)
- **Audio Pipeline**: GStreamer (Native Rust FFI bindings)
- **Local Persistence**: SQLite (`rusqlite`) for library indexing, play counts, and queue state
- **Stream Engine**: `yt-dlp` packaged as a platform-decoupled sidecar binary

---

## 🚀 Development Setup

### 1. Prerequisites

Make sure you have installed the required build dependencies:

- **Node.js**: v18.0 or higher
- **Rust Toolchain**: Install via [rustup.rs](https://rustup.rs)
- **GStreamer Engine**:
  - **Windows**: Install MSVC 64-bit GStreamer runtime and development packages from the [GStreamer Official Site](https://gstreamer.freedesktop.org/).
  - **macOS**: Install via Homebrew:
    ```bash
    brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly pkg-config
    ```
  - **Linux (Ubuntu/Debian)**: Install via APT:
    ```bash
    sudo apt update && sudo apt install -y build-essential pkg-config libasound2-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libgstreamer-plugins-good1.0-dev libgstreamer-plugins-bad1.0-dev gstreamer1.0-plugins-ugly libwebkit2gtk-4.1-dev
    ```

### 2. Local Environment Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/xtros/Muziso.git
   cd Muziso
   ```

2. **Install Frontend Dependencies**:
   ```bash
   npm install
   ```

3. **Run Development Server**:
   ```bash
   npm run tauri dev
   ```

4. **Build Production Binaries**:
   ```bash
   npm run tauri build
   ```

---

## 📂 Architecture Overview

### 🔌 Portable GStreamer FFI
Muziso initializes GStreamer directly upon app initialization. On Windows, the engine dynamically injects paths to portable GStreamer binaries into environment variables at runtime (`PKG_CONFIG_PATH` and `GSTREAMER_1_0_ROOT_X86_64`). On macOS and Linux, it binds to system GStreamer packages.

### 🛡️ Secure Asset Protocol
Tauri's `assetProtocol` is configured to scope local disk structures (`$HOME` and `$APPDATA`), allowing the client webview to securely load and stream locally stored media files, thumbnails, and avatars without origin policy issues.

---

## 🎯 Bug Hunter Reward Program

Found a functional bug, stream error, or UI glitch in **Muziso**? Help improve the platform and get rewarded!

### How to Submit:
1. Check existing issues on **[GitHub Issues](https://github.com/xtros/Muziso/issues)**.
2. Open a new issue with:
   - Reproduction steps.
   - Operating system and Muziso version (e.g., Windows 11, Muziso v0.1.0).
   - Relevant log outputs or screenshots.
3. Confirmed bug reports earn rewards and contributor recognition!

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](https://github.com/xtros/Muziso/blob/main/LICENSE) for more details.
