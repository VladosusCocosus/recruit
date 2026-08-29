## Install

Download the DMG for your Mac — **arm64** for Apple Silicon (M1 and later), **x64** for
Intel — open it and drag Jobbox to Applications.

### First launch

These builds are **not signed with an Apple Developer certificate**, so macOS blocks them
on first launch. Clearing the quarantine flag is required — run this after dragging Jobbox
to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/Jobbox.app
```

Then open the app normally. There is no other route: Apple removed the right-click → Open
shortcut for unsigned apps in macOS 15, so the command above is the one required step.

### Requirements

Jobbox drives a coding-agent CLI on your own machine — there is no API key, and no server
holding your mail. Install whichever one you already have, then pick it in Settings:

- **Claude Code** — sign in by running `claude` once in a terminal
- **Codex** — sign in by running `codex` once in a terminal

Jobbox spawns it as a subprocess on your own subscription and never holds credentials for
either one.
