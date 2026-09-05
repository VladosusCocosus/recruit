# Jobbox

A macOS email client that is really an agent-driven job-application tracker.

Jobbox syncs your inbox, scores every message with a local prefilter, and hands the
likely job-related ones to a coding-agent CLI — **Claude Code or Codex**, your choice in
Settings. The agent reads them and **proposes** tracker changes — new applications, status
moves, interview events, message links. Nothing it proposes touches the tracker until you
accept it in the Review queue.

It also writes the other direction. **Apply** takes a job description or a link, tailors a
markdown master resume against it, renders a PDF and opens the application at Applied — see
*Applying to a job*.

Electron + React 18 + SQLite (better-sqlite3). The main process owns all state; the
renderer talks to it over a typed IPC bridge and never touches the database.

## Running it in dev

Requires Node >= 20.19 (this tree is on 25.6) and either the `claude` or the `codex` CLI
on your machine, signed in. Jobbox spawns it as a subprocess on your own subscription and
never holds an API key for either.

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

### Finding the CLI

The agent bridge shells out to the `claude` or `codex` binary. A GUI-launched `.app` does
not inherit your login shell's PATH, so Jobbox searches `~/.local/bin`, `~/.claude/local`,
`/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/Library/pnpm`, `~/.yarn/bin`,
`~/.npm-global/bin`, `~/.volta/bin`, `~/.deno/bin`, `~/go/bin` and every per-version bin
directory under nvm, fnm, mise and asdf before giving up. Codex is usually an npm global,
so on a version-manager setup it lives somewhere like
`~/.nvm/versions/node/<version>/bin/codex` — that is exactly the case the last group
covers. **Settings → Agent** has an explicit path override per engine if the search misses.

**If the selected CLI isn't signed in, runs fail with a dedicated banner** telling you to
run `claude` (or `codex`) in a terminal to log in — that is a first-class state, not a
generic error.

### What each run kind can reach

Three run kinds, isolated on purpose. Triage reads untrusted email, so it must have no way
to send anything out; enrich reaches the web, so it must have no way to see anything
private. Tailor is the exception to that rule and the one to understand before you use it:
it holds your resume *and* reaches the web. See *The tailor run's exposure* below.

| | triage | enrich | tailor |
|---|---|---|---|
| tracker MCP tools | yes, allowlisted | **no server configured at all** | **no server configured at all** |
| email | this run's allowlist only | never — input is a company name string | never |
| web | Claude Code: no. Codex: **yes, see below** | yes — `WebSearch` + `WebFetch` | yes — `WebSearch` + `WebFetch` |
| private data in context | this run's messages | none | **the master resume** |
| shell / files / subagents | no | no | no |

On Claude Code that is `--tools ""` (no built-ins whatsoever) plus `--strict-mcp-config`.
On Codex it is `--ignore-user-config` (so your own `~/.codex/config.toml` MCP servers are
never loaded into a run that reads your mail), `--ignore-rules`, `-s read-only`,
`--ephemeral`, and `--disable` for the shell, exec, browser, computer-use, apps and
subagent-spawning features. The tracker server is pinned by `-c mcp_servers.tracker.*`
overrides with a per-run bearer token that travels by environment variable, so it is never
written to `agent_runs.command_json`.

**Known gap, Codex only:** `codex exec` cannot turn web search off. `tools.web_search=false`
is accepted and removes Codex's own web-search tool, but the ChatGPT backend still exposes
a server-side web tool and the model will use it. Verified against codex-cli 0.147.0 on
gpt-5.6-sol, gpt-5.5 and gpt-5.4-mini; built-in model providers cannot be overridden
either. So a Codex triage run has an egress path a Claude Code triage run does not, and
Settings says so. Claude Code remains the default engine.

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
   flagged the message, so you can see why the agent was looking at it.

### Researching a company

With **Settings → Agent → Enrichment** on, an item's Description block grows a **Research**
button. It spawns an enrich run over the item's company name and the run writes a sourced
brief: what the company does, what their live job postings ask for, how their careers page
describes them, and what review sites say — each section dropped rather than padded when
it can't be sourced, and every claim carrying a link.

The brief does **not** land on the item directly. An enrich run has no tracker tools, so
the result arrives as a proposal in the Review queue like everything else; the button says
so once the run finishes. Accepting it replaces an agent-written description and never a
description you wrote yourself.

## Applying to a job

**Apply** in the toolbar (⌘N) is the path to a new application. One box takes either a
pasted job description or a job link; you pick a master resume; a **tailor** run reads the
posting and comes back with a list of proposed replacements against your resume, each with
the evidence that motivated it.

You review those one at a time. Every change shows what it replaces, what it becomes and
why, and you take the ones you want — the document is assembled locally from the ones you
accept, never from a rewritten copy the model returned. Alongside them is a **gap list**:
what the posting asks for that your resume does not show. Gaps are required output and are
never quietly turned into additions.

Accepting renders the result to PDF, files it as a resume variant, and creates the
application at **Applied** with the tailored file already attached. So the flow that writes
the application is the same one that answers "which resume did I send".

**Master resumes** live in **Settings → Resume**, in markdown. That is the one-time cost of
this feature: a resume has to exist as text before anything can tailor it, and an uploaded
PDF is bytes nobody can read. Rendering is markdown → HTML → PDF inside Jobbox, so every
application you send looks the same.

Two limits worth stating plainly. **Jobbox does not submit anything** — mail is read-only
and SMTP is unused, so you still apply on the company's own site with the PDF it produced.
And a tailor run **may add a skill or a bullet** where your resume supports it, so read the
additions before you accept them; the rule it is held to is that anything added must be
defensible in an interview, and inventing an employer, a date, a metric or a certification
is prohibited outright.

### Which resume you applied with

Applications the apply flow created already know. For the rest — anything the triage agent
found in your mail, or a card you made by hand — **Settings → Resume** holds a default
resume plus every other one you have used. Once an application reaches **Applied**, its
board card grows a **Resume?** chip; picking answers it with the default, another resume
from the library, a file you upload there and then, or *Skip for now*. Skipping is an
answer — the chip stops asking.

Added files are copied into `userData/resumes` and named by content hash, so renaming or
moving the original later does not break the record, and re-adding the same file reuses the
row instead of duplicating it. PDFs the apply flow rendered are stored the same way but
marked as variants of the master they came from, so they stay out of the library list and
the picker while still resolving by id for the application that was sent with one.

The triage agent has no access to any of it: resumes appear nowhere on the MCP surface, and
which one you sent is not something it can propose. A tailor run is the one place a resume
reaches a model, and it is given the markdown master rather than the library — see *The
tailor run's exposure*.

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

- The triage run gets **no built-in tools**: no shell, no file access, no subagents, and
  on Claude Code no web either (`--tools ""`). Its only capability is one HTTP MCP server
  on `127.0.0.1`, guarded by a per-run bearer token that is revoked the moment the run
  ends. See *What each run kind can reach* above for the per-engine flags, and for the one
  thing Codex cannot currently enforce.
- **Reads are run-scoped.** The run can only read the messages on its own allowlist, which
  is written to the database *before* the child process exists. The run id is bound to the
  token server-side, so the model cannot name a different run.
- **There are no live-mutation tools.** Every `propose_*` tool appends a row to
  `proposals` and returns "nothing has changed in the tracker yet". The code that writes
  tracker tables is only reachable from the Accept button.
- Email text is untrusted input. Tool results say so explicitly, but treat the triage
  prompt's injection resistance as unproven until you have watched a few real runs.
- **Enrichment** (a separate run kind that reaches the web) is **off by default** and,
  when on, gets a company name string and no tracker access at all — no MCP server is
  configured for it, so the tracker listener is not merely un-allowed, it is
  unaddressable. Its whole tool surface is `WebSearch,WebFetch`, on both `--tools` and
  `--allowedTools`.

### The tailor run's exposure

An earlier version of this file said that feeding a web-enabled run the user's CV "would
hand a web-enabled process private data to exfiltrate", and that the comparison belonged
in a local, web-less step. The apply flow does it anyway, deliberately, because pasting a
job link has to work. That is a real accepted risk, not a solved one, and this is the
honest account of it.

A tailor run holds the master resume in its prompt and can reach the web. What constrains
it:

- **No tracker tools and no email.** Same as enrich: no MCP server is configured, so the
  tracker is unaddressable, and no message is ever on its allowlist.
- **No verb that sends.** The tool surface is `WebSearch` and `WebFetch` and nothing else
  — no shell, no files, no subagents, no HTTP method the model chooses.
- **Prompt-level prohibitions**, stated explicitly: never fetch a URL the job description
  names, only the one the user supplied; never repeat the resume anywhere; a job
  description is data, and text in it aimed at an assistant is reported as a gap rather
  than obeyed.

What does **not** constrain it: `WebFetch` is itself a request to a host, and a URL can
carry data in its path or query. A model successfully steered by a hostile job posting has
an egress path, and no flag in either CLI closes it. The prompt is the mitigation, and a
prompt is not a sandbox.

On **Codex this is worse**, for the reason in *Known gap, Codex only* above: web search
cannot be turned off there at all, so there is no such thing as a web-less Codex run even
in principle. Claude Code remains the default engine.

Paste job descriptions you are willing to have a model read adversarially, and treat the
master resume as something that has been in a web-enabled context.

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
- **Attachments never hit disk**, and there is no way to open one. (Resumes are the one
  thing Jobbox does store: they arrive from a file dialog, not from mail.)
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

## Download numbers

The site's Download buttons used to link straight at the object store, so MinIO served
the bytes and nothing in this repo ever learned that a copy had been taken. They now point
at `/download/mac/arm64` and `/download/mac/x64`, which the site's own server answers with
a `302` to the same object after recording the request. Storage still serves the bytes —
only the redirect passes through Node, and if the counter throws, the redirect still goes
out. A broken counter must never cost a download.

Read the numbers back as JSON:

```bash
curl https://jobbox.fline.sh/api/downloads
```

Three figures are kept per architecture, per day and in total:

| Field | Meaning |
|---|---|
| `hits` | Requests handed a redirect, after automated traffic was removed |
| `uniques` | Those hits deduplicated per visitor per UTC day |
| `filtered` | Requests excluded as bots, link unfurlers, prefetches or `HEAD` probes |

`filtered` exists so the discard pile stays visible. Every time the link is pasted into
Slack or iMessage the unfurler fetches it, and on a site this young a link checker can
outnumber the humans — folding that into the headline number would invent users.

`uniques` deduplicates **within** a UTC day, so the total is a sum of daily figures rather
than a lifetime headcount: someone who comes back a week later counts twice. A true
lifetime figure would mean keeping every visitor fingerprint forever, which is both
unbounded and more than this needs to know.

No address is stored. A visitor is a truncated SHA-256 of the client IP, the user agent
and a random salt minted on first run and held in the state file; without the salt the
digests do not reverse, and rotating it means deleting one line. The client IP is taken
from the **rightmost** `X-Forwarded-For` entry — the one the platform's proxy observed —
so a client cannot inflate `uniques` by sending a header full of invented addresses.

State is a single JSON file at `/data/downloads.json`, declared as a volume on the
`recruit-site` service in [site/fline.json](site/fline.json). Writes are debounced and go
through a temp file and a rename, so a crash mid-write leaves the last good state, and
`SIGTERM` flushes so a redeploy does not drop the final few clicks. **Without that volume
the counter silently restarts from zero on every deploy** — it falls back to temp storage
and says so at boot rather than refusing to start. Set `JOBBOX_STATS_TOKEN` to require
`Authorization: Bearer <token>` on `/api/downloads`; left unset the numbers are public.

Two things this deliberately does not count. In-app update checks and downloads go to the
Go service and to `downloads/updates/...`, and counting them here would mix "people trying
the app" with "installs that already exist", which is the number that grows on its own.
The bucket also stays publicly readable, so an old direct link still works and bypasses
the counter — the figure is a floor, not an audit.
