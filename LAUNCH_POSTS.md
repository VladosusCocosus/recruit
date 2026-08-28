# Jobbox launch posts

Four platforms, four different posts, because Reddit wants a person, LinkedIn wants a
person who is available for hire, X wants one idea at a time, and Hacker News wants the
architecture with no adjectives on it.

**Two things to fill in before you post**, because I can't write either of them for you:

- `[N]` is how many companies you actually applied to, and it is worth not rounding up.
- The line marked ⚠️ in each post is about whether it works on your own mail. The README
  says the agent bridge has never completed a real model turn on your machine, so if that
  is still true, keep the hedged version I wrote, and if you have since run it against
  your real inbox then replace it with what it actually found, because that one sentence
  carries more weight than everything around it.

**Facts these posts commit to**, all checked against the repo and the live site today:
macOS only on both Apple Silicon and Intel, unsigned build so the quarantine command is
required, both DMG links return 200, the site and its setup guide are up, it is free with
no account and no server, state is a SQLite file in application support with the password
in the Keychain, and it needs the `claude` CLI signed in rather than an API key.

**The repo is private, so none of these posts say "open source" anywhere.** Don't add it.

---

## 1. Reddit

Suggested subs are r/SideProject, r/macapps and r/EmailClients, and if you post it in a
job hunting sub instead, lean harder on the spreadsheet and cut the sandbox paragraph
entirely.

**Title:**

> I kept losing track of my job applications, so I built a Mac email client that tracks them for me

**Body:**

I'm job hunting at the moment, I've applied to around [N] companies, and the part that
broke down for me was never the applying, it was the remembering.

Every update comes back as an email, so the confirmation, the recruiter's reply, the
question about whether Thursday works and the rejection four weeks later all land in the
same place, mixed in with newsletters and receipts, and by about the third week I could
not have told you who had replied, who had gone quiet, or which of them I had already
followed up with. I kept a spreadsheet for a while, but it was permanently a few days out
of date, mostly because updating it is exactly the sort of task you skip on the day you
get a rejection.

So rather than keep the tracker next to my mail, I put it inside my mail.

Jobbox is a small macOS email client that syncs your inbox, scores every message with a
local filter that uses no model and no network and just looks at the words, and then
hands the ones that look like they belong to your job search over to Claude Code running
on your own machine. Claude reads those and proposes changes to your tracker, meaning a
new application, a status that moved, an interview that got scheduled, or a message that
belongs against a company you already have, and you accept or reject each proposal with a
single keystroke.

The proposing is the actual design rather than a safety feature bolted on afterwards,
because the agent simply has no tool that can write to your tracker. Every tool it has
appends a proposal and answers with the same sentence, which is that nothing has changed
in the tracker yet, and the code that really does create an application or move a status
can only be reached from the Accept button. A nice side effect is that rejecting
something costs you nothing at all, since there is no undo required when nothing was done
in the first place.

Underneath all of that it is still a mail client, so every card links back to the real
message exactly as it arrived, which turns out to matter most when a proposal looks
wrong, because you can usually spot the phrase that caused it, something along the lines
of "thanks for applying", sitting right there on the card.

The whole thing runs on your own machine. There is no Jobbox account and no Jobbox
server, the database is a single file in your application support folder that you can
delete if you want the app gone, your mailbox password goes into the macOS Keychain with
only a reference to it written into the database, and the agent is the claude CLI running
under your own login, so there is no API key anywhere and no bill from me or from anyone
else.

The caveat I would rather say myself than have somebody else find is that reading your
mail with a model does mean the model sees the mail it reads, and no privacy page changes
that fact. What I could control is everything around it, so a given run only ever sees
the specific messages on a list that was written before that run started, it gets no
shell and no file access and no browser, and whatever access it had is revoked the moment
it finishes.

Some things this version deliberately does not do, which you should probably read here
rather than discover on a Tuesday:

- Mail is read only, so there is no compose, no reply and no forward, and it never marks
  anything as read in your actual mailbox either, because marking something handled is
  local to your Mac.
- It is effectively single account for now, since the database schema holds several but
  the interface drives one.
- It speaks IMAP and needs an app specific password rather than your account password,
  which means Gmail, iCloud and Fastmail all work, but Outlook and Microsoft 365 cannot
  connect at all, because Microsoft removed password sign in for IMAP and there is no
  OAuth client in here.
- If an interview gets rescheduled it currently creates a second event instead of
  replacing the first one, which is the ugliest item on this list and the one I want to
  fix next.
- The build is unsigned, so macOS blocks it the first time you open it, and there is one
  command on the download page that clears that.

It is Mac only, it is free, and there is no signup: https://jobbox.fline.sh

⚠️ *If you have run it against your own inbox, replace this line with what it actually
found, because something like "it went through ninety days of my mail and found fourteen
applications I had half forgotten about" is worth more than every paragraph above it. If
you have not run it yet, then say so instead: it is new and I am still shaking it out on
my own mail, and I would much rather hear from you that it got something wrong than not
hear it.*

Happy to answer anything about how it is put together.

---

## 2. LinkedIn

Longer sentences but keep the blank lines between paragraphs, because LinkedIn turns
anything denser into a wall that nobody expands. It ends where a post about a job search
should end.

I'm looking for a job, and somewhere around the [N]th application I lost the thread.

Not the applications themselves, which are the easy part, but the updates, because every
one of them arrives as an email and they land in between newsletters and receipts, so by
the time you actually need one of them you cannot find it.

I kept a spreadsheet, and it had three tabs and one column that nobody had touched since
June.

What eventually occurred to me was that my inbox already contained every single fact I
was copying into that spreadsheet, which meant I was doing data entry against my own
mail, from memory, late at night, and doing it badly.

So I built the thing I needed, and it is called Jobbox, a small macOS email client that
keeps the tracker for you.

It reads your inbox, works out which of the messages belong to your job search, and then
drafts the changes for you, whether that is a new application, a status that moved, an
interview that got scheduled or a message that should be filed against a company you
already have. You accept or reject each one, and it never edits the tracker on its own,
because everything arrives as a draft that you can throw away with a single key.

Three things about how it is built that I would defend:

It proposes rather than acts, because automation you have to double check is worse than
no automation at all, so the agent has no ability to write to your data and the only path
in is you pressing Accept.

It runs on your machine, with no account and no server and nothing of yours sitting on my
disk, since it drives Claude Code under your own login.

It is honest about being a version one, so the fact that mail is read only, that it
handles one mailbox, and that it speaks IMAP and therefore cannot do Outlook, is all on
the front page rather than buried somewhere.

Building it while job hunting turned out to be the right decision for a reason I did not
plan, which is that I was the user every single day, and there is no substitute for that.

It is free, it is Mac only, and it is here: https://jobbox.fline.sh

⚠️ *One sentence about real world use belongs here, and there is a note at the top of this
file about how to word it either way.*

And the obvious thing, which is that I am available, so if you are hiring for [your role]
then I would like to hear from you, and if you happen to be in the middle of the same
search right now then please take the app, because you are exactly who I made it for.

#jobsearch #buildinpublic #macos

---

## 3. X / Twitter

Eight posts. Attach `video/out/jobbox-tour.mp4` to the first one and the PNGs where
marked. The last post is the one that actually gets replies, so don't drop it.

**1/**
I'm job hunting and I've applied to [N] companies, and the hard part was never the
applying, it was that every update comes back as an email and your tracker goes stale by
about week two.

So I built a mail client that keeps the tracker itself.

🧵 *[attach jobbox-tour.mp4]*

**2/**
My spreadsheet had three tabs and one column nobody had touched since June, while my
inbox already contained every fact I was typing into it.

I was doing data entry against my own mail.

**3/**
Jobbox syncs your inbox and scores every message with a local filter first, using no
model and no network, just the words.

Only the things that look job related ever get read by an agent, and everything else
never leaves your machine at all.

*[attach Mail-dark.png]*

**4/**
Then Claude Code, running on your Mac under your own login, reads those messages and
writes down what changed, whether that is a new application, a status that moved, an
interview scheduled or a message filed against the right company.

Each one names the email it came from.

*[attach Review-dark.png]*

**5/**
The important part is that it cannot write to your tracker, because there is no tool that
does.

Every tool it has appends a proposal and replies "nothing has changed in the tracker
yet", and Accept is the only thing in the whole app that writes.

**6/**
Which is also why rejecting is free, since there is nothing to undo when nothing was
done, so the proposal just gets marked rejected and the queue moves on.

Automation you have to double check is worse than none, so I made it something you skim
instead.

*[attach Board-dark.png]*

**7/**
No account, no server, no telemetry, and the database is one file on your Mac you can
delete whenever you want, with the password in the Keychain and no API key, so nobody
bills you.

Reading mail with a model means the model sees the mail. Everything else I locked down.

**8/**
Free, Mac only, no signup: https://jobbox.fline.sh

Version one is narrow on purpose, so mail is read only, it handles one mailbox, it speaks
IMAP and it cannot do Outlook.

⚠️ *[your real usage line here]*

If you are job hunting, tell me what it gets wrong on your inbox.

---

## 4. Show HN

Hacker News reads the title first and the limitations second, so the architecture goes
above the fold and there are no adjectives and no exclamation marks anywhere in it.

**Title:**

> Show HN: Jobbox, a macOS mail client that tracks your job applications

**Body:**

I've been job hunting, and the thing that actually broke was not the applying but the
remembering, because every update arrives as an email, whether that is the confirmation,
the recruiter's reply, the scheduling back and forth or the rejection a month later. I
kept a spreadsheet and it was permanently out of date, largely because updating it is the
task you skip on the day you get rejected.

Jobbox puts the tracker inside the mail client. It syncs your INBOX over IMAP, scores
every message with a local prefilter that is string matching with no model and no network
involved, and hands anything above a threshold to Claude Code running as a subprocess on
your own machine, where the agent reads those messages and proposes tracker changes that
you then accept or reject one at a time.

The part I would genuinely like feedback on is the sandbox, since pointing a model at
your personal mail is where all of the risk actually lives:

- There are no live mutation tools, because every tool exposed to a run is a `propose_*`
  that appends a row to a proposals table and returns the string "nothing has changed in
  the tracker yet". The code that writes application, status and event rows is not
  reachable from the tool surface at all and is only called from the Accept handler,
  which makes the review queue safe by construction rather than by an interception layer
  that I would have to get right every time.
- There are no built in tools either, because the triage run is spawned with `--tools ""`
  and therefore has no Bash, Read, Write, WebFetch or WebSearch, so its only capability
  is a single HTTP MCP server bound to 127.0.0.1 and guarded by a per run bearer token
  that is revoked as soon as the run ends.
- Reads are scoped to the run, since a run can only read the messages on its own
  allowlist, that allowlist is written to the database before the child process exists,
  and the run id is bound to the token server side so the model cannot ask for a
  different run's messages.
- There are two isolated run kinds, where triage gets the tracker tools and no web access
  while enrichment gets web access and no tracker access and receives a company name
  string as its entire input, and because no run has both, a prompt injection sitting in
  an email has nowhere to send anything.

I would rather somebody here tell me where that reasoning is wrong than find it out
later. Email is attacker controlled text and I treat injection resistance as unproven
rather than solved, so the claim I am actually confident about is the structural one,
which is that even a completely successful injection is talking to a tool surface whose
only verb is propose.

All of it runs locally, with no account, no server and no telemetry, storing state in a
SQLite file in application support and keeping the IMAP password in the macOS Keychain
with only a reference to it in the database. It drives the `claude` CLI under your own
login rather than going through the API, so there is no API key anywhere and no inference
bill attached to using it.

The stack is Electron with React 18 and better-sqlite3, where the main process owns all
of the state and the renderer talks to it over a typed IPC bridge and never touches the
database.

Version one is deliberately narrow:

- Mail is read only, so there is no compose and no reply, and it never writes IMAP flags,
  which means marking something handled is local state on your machine.
- It is effectively single account, because the schema holds several but the interface
  drives one.
- It is IMAP only, so Outlook and Microsoft 365 cannot connect, given that Microsoft
  removed password authentication for IMAP and there is no OAuth client here.
- The .ics parse chain has no producer yet, so a rescheduled interview creates a
  duplicate event instead of superseding the original one.
- Attachments are never written to disk.
- The build is unsigned, so macOS quarantines it on first launch and you need to run
  `xattr -dr com.apple.quarantine /Applications/Jobbox.app`, which also means there is no
  silent auto update, and the app instead tells you a version exists and opens the DMG.

⚠️ *Replace this with the honest status. If the agent still has not completed a real model
turn on your machine then say exactly that, because "the sandbox is finished and I am
still validating proposal quality against real mail" will earn far more respect here than
a vague suggestion that it all works. If it has run, give the numbers.*

Mac only, free, no signup: https://jobbox.fline.sh
