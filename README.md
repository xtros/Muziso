# 🎵 Muziso

<p align="center">
  <img src="https://i.postimg.cc/yYvXBWK5/Muziso.png" alt="Muziso Showcase" width="100%" />
</p>

Muziso is a premium, dark-themed, glassmorphic desktop music player designed for modern listeners. Powered by a hybrid engine of **React (TypeScript)** and **Rust (Tauri)**, Muziso integrates local library playback with dynamic web streaming (YouTube, SoundCloud) and local caching capabilities.

---

## 🌟 Key Features

*   **Hybrid Media Playback**: Play local audio formats (`.mp3`, `.m4a`, `.wav`, `.opus`) alongside online streams seamlessly.
*   **IP-Bound Streaming**: Dynamically extracts high-quality audio streams using a local, platform-independent `yt-dlp` sidecar engine.
*   **Offline Downloads / Likes**: Download and save liked tracks locally for immediate offline playback.
*   **Stable Shuffling & Queue Engine**: Shuffled play queues with smart un-shuffling state tracking and back-navigation (repopulating historical shuffled paths).
*   **Developer Announcements**: An integrated updates dropdown linked to remote notification feeds with read/unread tracking.
*   **Custom Glassmorphic UI**: High-fidelity dark mode with neon-yellow branding (`#ccff00`), Framer Motion transitions, custom modal overlays, and full scroll-to-top routing resets.
*   **Native Isolation**: Volume control dragging is decoupled from parent swipe-to-close sheets.

---

## 🛠️ Technology Stack

*   **Frontend**: React (TypeScript), Framer Motion, Lucide Icons, Vanilla CSS
*   **Desktop Wrapper**: Tauri (v2)
*   **Audio Pipeline**: GStreamer (wrapped in Rust FFI bindings)
*   **Database**: SQLite (`rusqlite`) for local tracking, playlist schemas, and library logs
*   **Stream Resolution**: `yt-dlp` (packaged as a Tauri resource sidecar)

---

## 🚀 Setup & Installation

### Prerequisites

1.  **Node.js**: Install Node.js (v18+ recommended).
2.  **Rust Toolchain**: Install rustup from [rustup.rs](https://rustup.rs).
3.  **GStreamer**: Ensure GStreamer is installed on your system.
    *   **Windows**: Download and install the MSVC 64-bit GStreamer runtime and development packages from the [GStreamer Website](https://gstreamer.freedesktop.org/).
    *   **macOS**: Install via Homebrew:
        ```bash
        brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
        ```
    *   **Linux (Ubuntu/Debian)**: Install via APT:
        ```bash
        sudo apt install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libgstreamer-plugins-good1.0-dev libgstreamer-plugins-bad1.0-dev gstreamer1.0-plugins-ugly
        ```

### Development Mode

1.  Clone the repository and install npm packages:
    ```bash
    npm install
    ```
2.  Launch the development server:
    ```bash
    npm run tauri dev
    ```

### Production Build

To compile release bundles and target operating system installer files:

```bash
npm run tauri build
```

*The build pipeline will output native installer setups (`.exe`/`.msi` on Windows, `.dmg` on macOS, and `.deb` on Linux) inside `src-tauri/target/release/bundle/`.*

> [!NOTE]
> **Cross-Compilation Note**: Tauri compiles native binaries, meaning you must build the project on the target operating system (e.g., compile on Windows for `.exe`/`.msi`, macOS for `.dmg`/`.app`, and Linux for `.deb`). You can also configure a GitHub Actions workflow to build and release binaries for all three platforms automatically upon pushes.

> [!NOTE]
> **Windows SmartScreen Prompt**: As an independent open-source desktop app without a commercial code-signing certificate, Windows Defender SmartScreen may display an "Unknown Publisher" prompt when launching the `.exe` installer for the first time. To proceed: Click **"More info"** $\rightarrow$ **"Run anyway"**.

---

## 📂 Architecture Details

### GStreamer FFI Initialization
The application initializes GStreamer directly on startup. On Windows, it automatically injects paths to the bundled/portable GStreamer binaries (`gstreamer/bin` / `plugins`) directly into the registry and environment paths. On macOS and Linux, GStreamer loads from system packages.

### Platform-Independent `yt-dlp` Sidecar
To support streaming audio on Windows, macOS, and Linux, the resolver detects the host platform type and automatically appends the correct binary extensions (`yt-dlp.exe` vs `yt-dlp`), executing in the background with `CREATE_NO_WINDOW` flags on Windows to hide shell popups.

### Security Configurations
Tauri's `assetProtocol` is configured to register scopes for local disk structures (`$HOME` and `$APPDATA`), allowing the client webview to load and play locally cached image avatars and downloaded music files directly.

---

## 🎯 Bug Hunter Reward Program

Found a bug or an edge-case crash in **Muziso**? Help us make the app better and get rewarded! 

We offer **rewards for valid, reproducible bug reports**.

### 🛠️ How to Participate:
1. **Discover a Bug**: Find any functional issue, audio engine crash, UI glitch, or stream resolution bug.
2. **Report the Bug**: Create a detailed report on our [GitHub Issues](https://github.com/xtros/Muziso/issues) including:
   - Clear steps to reproduce the bug.
   - Operating System & Muziso version (e.g. Windows 11, Muziso v0.2.0).
   - Relevant screenshots, video recordings, or error logs.
3. **Get Verified & Rewarded**: Once our team verifies and confirms your bug report, we'll reward you for your contribution!

> [!TIP]
> **High-Priority Bounties**: Critical rewards are given for audio engine crashes, stream resolution failures, or security vulnerabilities.

