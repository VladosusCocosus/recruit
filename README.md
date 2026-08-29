# Jobbox

A macOS email client that is really an agent-driven job-application tracker.

Jobbox syncs your inbox, scores every message with a local prefilter, and hands the
likely job-related ones to Claude Code. Claude reads them and **proposes** tracker
changes — new applications, status moves, interview events, message links. Nothing it
proposes touches the tracker until you accept it in the Review queue.

Electron + React 18 + SQLite (better-sqlite3). The main process owns all state; the
renderer talks to it over a typed IPC bridge and never touches the database.

## Running it in dev

Requires Node >= 20.19 (this tree is on 25.6) and the `claude` CLI on your machine.

```bash
npm install
npm run dev        # electron-vite dev — main + preload + renderer with HMR
```

Other commands:

```bash
npm run build      # -> out/main, out/preload, out/renderer
npm run typecheck  # tsc --noEmit
npm test           # vitest — prefilter + .ics parser only, by design
npm run rebuild    # only if better-sqlite3/keytar need an Electron-ABI rebuild
```

The agent bridge shells out to the `claude` binary. A GUI-launched `.app` does not
inherit your login shell's PATH, so Jobbox looks in `~/.local/bin`, `~/.claude/local`,
`/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin` and `~/.volta/bin` before giving up;
you can also set an explicit path in **Settings → Agent**. **If Claude Code isn't signed in, runs fail
with a dedicated banner** telling you to run `claude` in a terminal to log in — that is a
first-class state, not a generic error.

State lives in `app.getPath('userData')`: `recruit.db` (SQLite, WAL) and `settings.json`.
Set `RECRUIT_DB_PATH` to point the database somewhere else.

## Adding an account

First launch shows a setup checklist: **add account → sync → first scan → review.**

1. **Settings → Accounts → Add an account.** Pick a provider preset or enter IMAP manually: server, port,
   username, password, TLS. Fill in SMTP too — it is stored and connection-tested, but v1
   never sends with it.
2. **Test connection.** This proves the credentials before anything is saved. Passwords go
   to the macOS Keychain; only a keychain reference is written to SQLite.
3. **Sync.** Pulls the INBOX and runs the prefilter over it. Anything scoring >= 0.35
   (tunable in **Settings → Triage**) becomes a *candidate*.
4. **Run.** The `▶ Run · N` button in the toolbar spawns a triage run over the candidates.
   The same button turns into a live status — elapsed time, current tool call, Stop.
5. **Review.** Accept or reject each proposal. Every card shows the prefilter reason that
   flagged the message, so you can see why Claude was looking at it.

Gmail and other 2FA providers need an app-specific password, not your account password.
**Outlook and Microsoft 365 cannot connect at all** — Microsoft removed password sign-in from
IMAP and SMTP, and Jobbox has no OAuth client. The preset is kept, with a warning in the form.

The per-provider guide is the static site in [site/](site/), deployed to
`https://jobbox.fline.sh`; the guide itself is `/setup`. The **Setup guide** button in
Settings → Accounts opens it at the anchor for the configured provider (`#gmail`,
`#icloud`, `#fastmail`, `#outlook`, or `#custom`), and a failed connection test links
straight to `#trouble`.

`RECRUIT_SETUP_URL` overrides the **full guide URL** in dev — e.g.
`RECRUIT_SETUP_URL=http://localhost:8080/setup`, not just the origin. It must be
`http(s)`: `openExternal` refuses every other scheme, so a `file://` path silently does
nothing. The site is deliberately not served by the update service — a mail-setup problem
should stay readable when that host is down.

## How the agent is sandboxed

Worth knowing before you point it at real mail:

- The triage run gets **no built-in tools** (`--tools ""`): no Bash, Read, Write, WebFetch
  or WebSearch. Its only capability is one HTTP MCP server on `127.0.0.1`, guarded by a
  per-run bearer token that is revoked the moment the run ends.
- **Reads are run-scoped.** The run can only read the messages on its own allowlist, which
  is written to the database *before* the child process exists. The run id is bound to the
  token server-side, so the model cannot name a different run.
- **There are no live-mutation tools.** Every `propose_*` tool appends a row to
  `proposals` and returns "nothing has changed in the tracker yet". The code that writes
  tracker tables is only reachable from the Accept button.
- Email text is untrusted input. Tool results say so explicitly, but treat the triage
  prompt's injection resistance as unproven until you have watched a few real runs.
- **Enrichment** (a separate run kind that may use WebSearch) is **off by default** and,
  when on, gets a company name string and no tracker access at all.

## Known gaps

v1 is deliberately narrow.

- **Mail is read-only.** No compose, no reply, no forward. Jobbox never writes IMAP flags
  either — marking something read or dismissed is local state only.
- **SMTP is stored but unused.** Credentials are saved and connection-tested so sending can
  land later; nothing sends today.
- **Effectively single-account.** The schema holds many accounts, but the shell drives one
  and there is a single shared sync-status slot.
- **The .ics chain has no producer.** `src/main/mail/ics.ts` parses calendar invites and is
  well tested, but nothing calls it: sync stores attachment metadata only and drops the
  content, so `timeline_events.ics_uid` / `ics_sequence` are always null. The consequence
  is real — the supersede-on-sequence logic in `applyProposal.ts` is unreachable, so **a
  rescheduled interview creates a duplicate event instead of replacing the old one.**
  Fixing it means either parsing `.ics` at ingest or carrying the calendar body through the
  MCP surface (the unused `attachments.disk_path` column is there for the second option).
- **Attachments never hit disk**, and there is no way to open one.
- **A UIDVALIDITY bump leaves stale rows** rather than resyncing the folder.
- **Navigation is shallow** — you can't deep-link to a specific message or item.
- **The bridge has never completed a real model turn** on this machine (the CLI was not
  signed in), so tool invocation and proposal quality are untested end to end.

## Layout

```
src/shared/types.ts   the contract: entities, prefilter types, MCP payloads, RecruitApi
src/main/             Electron main — SQLite, IMAP sync, Keychain, MCP server, agent runner
src/preload/          contextBridge -> window.recruit (typed, invoke-only)
src/renderer/         React 18. Talks to main through window.recruit and nothing else.
tests/                prefilter + .ics parser unit tests
```

## Updates

Jobbox checks for new versions against a small Go service (`server/`) and, when one
exists, shows a banner offering a download. It does **not** install updates itself.

That is a consequence of signing, not an oversight. Squirrel.Mac — the mechanism
`electron-updater` uses on macOS — refuses to apply an update to a bundle that is not
signed with an Apple Developer certificate, and these builds are unsigned. Rather than
ship an updater that silently never fires, the app tells you a version is available and
opens the DMG. Add a certificate and the silent path is a config change: the feed at
`/updates/darwin/<arch>/latest-mac.yml` is already served, already per-architecture.

The repository is private, so the app cannot read GitHub releases directly without
embedding a token. The Go service holds the token instead and re-publishes release assets
over public URLs. See [server/README.md](server/README.md).

## Releasing

```bash
git tag v0.2.0 && git push --tags
```

That triggers `.github/workflows/release.yml`, which builds each architecture separately
— a combined build emits one `latest-mac.yml` and the last architecture wins, which would
offer Intel users an arm64 archive — and publishes both DMGs, both ZIPs, and both
manifests to a GitHub Release.

To build locally instead:

```bash
npm run dist:mac      # DMG + ZIP into release/
```
