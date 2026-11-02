# Apostle AE Bridge: start here

Apostle AE Bridge lets Claude Code drive After Effects. You describe what you want in plain English and Claude builds comps, layers, animation and renders inside your open project. It also adds an **Apostle** panel inside After Effects, which turns a written brief into a finished explainer film.

Setup takes about 10 minutes. You do it once.

---

## What you need

- A Mac running After Effects 2024 or newer, opened at least once.
- A Claude account with Claude Code access: a Pro or Max plan, or an Anthropic Console account.

The installer checks for Node.js and Claude Code and offers to install whichever is missing.

---

## Step 1: unzip and install

1. Double-click the zip. You get a folder called **Apostle AE Bridge**.
2. Open it and double-click **Install.command**.
   - If macOS says it "cannot be opened" or "Apple could not verify" it, click **Done** (not Move to Trash). Then open **System Settings > Privacy & Security**, scroll down, click **Open Anyway** next to Install.command, and confirm. This happens because the installer isn't from the App Store.
3. A Terminal window opens. Press **Return** and follow along. If After Effects is open, it asks you to quit it first. If Node.js is missing, it opens nodejs.org: download the **LTS** macOS installer, run it, then double-click Install.command again.
4. When you see **Installed.**, press Return.

Everything now lives in `~/Applications/Apostle AE Bridge` (your home folder > Applications). You can delete the zip and the unzipped folder.

## Step 2: sign in to Claude Code (first time only)

1. Open **Terminal** (press Cmd+Space, type *Terminal*, press Return).
2. Type `claude` and press Return.
3. Follow the sign-in steps (a browser window opens). Choose your Claude account.
4. Once you see the Claude prompt, type `/exit` and press Return.

## Step 3: open the Apostle panel

1. Open **After Effects**.
2. Go to **Window > Extensions > Apostle**.
3. Look at the top right of the panel. When it says **claude linked**, Claude can reach After Effects.

Keep the panel open while Claude works: dock it anywhere. After Effects remembers it, so next time it opens with the panel already there.

## Step 4: your first session

1. Open **Terminal** and paste this, then press Return:

   ```
   cd ~/Applications/Apostle\ AE\ Bridge && claude
   ```

   Always start Claude from this folder: that's where its instructions and the build scripts live.

2. Try these, one at a time:

   - `Check the After Effects bridge is working.`
   - `Make a 1920x1080 comp called Test, 10 seconds, with a title that says Hello and fades in over 1 second.`
   - `Build the demo film in briefs/demo, then show me a frame from the middle of it.`
   - `Look at the comp I have open and tell me what's in it.`

Claude asks before running commands. Answer **yes** (or "yes, don't ask again" for After Effects tools) to let it work.

**Save your project first.** Claude works in whatever project is open. It won't save or close your project unless you ask it to, but builds add comps and folders to it (under an APOSTLE folder).

---

## The Apostle panel

**Window > Extensions > Apostle** opens a panel with tabs:

- **BRIEF**: paste or load a script, then build a video from it.
- **TIMING**: change how long each beat lasts and re-time the film.
- **BRAND**: fonts and colours, saved as a brand kit (`brands/*.json`). `brands/demo.json` is a starting point; *SAVE AS* to make your own.
- **MOTION**: easing style and camera shake.
- **REVIEW**: run checks and render a review copy.
- **CLAUDE**: a Claude Code terminal right inside After Effects, plus one-shot questions.

The panel and the Terminal session drive the same engine, so use whichever you prefer.

---

## If something goes wrong

Double-click **Check Setup.command** in `~/Applications/Apostle AE Bridge` (with After Effects open). It shows a tick or a cross for each part, with the fix next to every cross. When asking for help, send a screenshot of that window.

| What you see | What to do |
| --- | --- |
| The panel says **claude link off** | Close the Apostle panel and open it again (Window > Extensions > Apostle). If it stays off, run Install.command again. |
| The panel says **previews off** | After Effects > Settings > Scripting & Expressions > tick **Allow Scripts to Write Files and Access Network**. Everything else already works. |
| Claude says After Effects timed out | Is the Apostle panel open? Is a dialog box open in After Effects? Close the dialog. |
| Window > Extensions has no Apostle | Quit After Effects, run Install.command again, reopen After Effects. |
| Claude doesn't have any After Effects tools | Run Install.command again, then restart Claude (`/exit`, then `claude`). |
| The CLAUDE tab's terminal says "relay unreachable" | Run `xcode-select --install` in Terminal, click Install, then reopen the panel. |
| A build is very slow | Builds into big projects on network drives are slow. Work from a new project on a local drive. |

---

## Optional extras

- **Timing to a recorded voice-over:** to line a film up with real VO audio, install whisper: `brew install whisper-cpp ffmpeg`, then download a model as described at the top of `scripts/vo-align.py`.
- **REDESIGN tab (AI concept images):** needs a fal.ai API key. Put `FAL_API_KEY=your-key` in a file called `.env` inside `~/Applications/Apostle AE Bridge`.

## Updating

Unzip the new version and double-click its Install.command. Your briefs, brand kits and builds in the install folder are kept.

## Uninstalling

Double-click **Uninstall.command**. It removes the Apostle panel and the Claude connection, then asks before deleting the install folder.
