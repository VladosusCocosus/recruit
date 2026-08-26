## Install

Download the DMG for your Mac — **arm64** for Apple Silicon (M1 and later), **x64** for
Intel — open it and drag Recruit to Applications.

### First launch

These builds are **not signed with an Apple Developer certificate**, so macOS blocks them
on first launch. Clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Recruit.app
```

Then open the app normally.

On macOS 14 and earlier you could instead right-click the app and choose **Open**. Apple
removed that shortcut for unsigned apps in macOS 15, so on current systems the command
above is the reliable route. The alternative is **System Settings → Privacy & Security**,
where an "Open Anyway" button appears after a blocked launch attempt.

### Requirements

Recruit drives the `claude` CLI on your own machine — there is no API key and no server
holding your mail. Install Claude Code and sign in first:

```bash
claude auth login
```
