## Install

Download the DMG for your Mac — `arm64` for Apple Silicon, `x64` for Intel — open it and
drag Recruit to Applications.

### First launch: Gatekeeper

These builds are **not signed with an Apple Developer certificate**, so macOS will refuse
to open the app on the first try. Either right-click the app and choose **Open** (then
confirm), or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Recruit.app
```

### Requirements

Recruit drives the `claude` CLI on your own machine — there is no API key and no server.
Install Claude Code and sign in first:

```bash
claude auth login
```
