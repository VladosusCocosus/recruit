# Jobbox — week of 7 September 2026

The week opened with Jobbox looking everywhere for your mail rather than in your inbox
alone. It closes with Jobbox able to answer questions from somewhere else: you can connect
your own AI assistant and ask it about your job search. In between is a run of repairs to
what the app remembers about the resumes you send, and to how it recovers when a mailbox
does something unusual.

## Jobbox reads every folder, not just your inbox

Until now Jobbox only ever opened your inbox. If a filter on your mail provider's side had
moved a recruiter's message to Spam, or you had archived a thread, or you keep applications
under a label like "Job hunt", Jobbox never saw any of it. That was the most common reason
for a mailbox that connected fine and then looked emptier than it should.

It now reads every folder on the account — inbox, spam, archive, sent, drafts, trash and
any folder or label of your own. Everything it finds goes through the same scoring it has
always used, so a rejection sitting in Spam or an interview invitation you archived last
month can now become a candidate and be picked up by a scan.

**Inbox still shows your inbox only.** That is deliberate: a list that mixed in your sent
mail and your trash would stop being useful the moment it stopped being your inbox. Mail
found anywhere else surfaces in **Candidates**, and any message that came from another
folder carries a small chip naming where it was found — **Spam**, **All Mail**, **Job
hunt** — so you are never guessing why an unfamiliar message is in the list.

Two things worth expecting. The first sync after you update will take noticeably longer
than usual, because Jobbox is reading back through every folder for the first time; it
covers the same 90 days as before, which you can widen or narrow in **Settings → General**.
And your own sent mail is now part of what a scan can read, which means an application you
sent to careers@northwind.example can turn up as a candidate in its own right. That is
often useful — it is evidence of when you applied — but it is new, so it is worth knowing
before you see it.

Gmail is handled without duplicating anything: a message carrying three labels still
appears once, not three times. Nothing about this changes what Jobbox does to your mailbox,
which is still nothing at all. It reads. It never moves a message between folders, never
marks anything read on the server, and never deletes. Spam you have in spam stays in spam.

## Every account syncs, not just the first

If you have more than one account in **Settings → Accounts**, only the first of them
actually synced when you pressed **Sync now**. The others were left to catch up on their own
background schedule, and an account whose connection had failed to start — a password
changed, a keychain not yet unlocked — would sit there not syncing until you restarted
Jobbox.

**Sync now** goes through every account in turn, and the toolbar says "2 accounts" rather
than naming the first one and quietly meaning all of them. Hover it to see which addresses
those are. When one account fails and another succeeds, the failure is now reported with
the address it belongs to instead of being wiped out by the account that synced after it.

## Ask your own AI assistant about your job search

**Settings → Assistants** connects Jobbox to an assistant you already use — Claude Desktop,
Claude Code or Cursor — so you can ask it the questions the app does not have a screen for.
Which applications have gone quiet for three weeks. What the recruiter at Northwind actually
asked you to send. Which of this month's rejections came after an interview rather than
before one.

Turn on **Allow AI assistants to read Jobbox**, then press **Add** next to the client you
use and restart it; most clients read their configuration only when they start. For
anything not in the list there is a **Copy** button with the configuration to paste in.
Jobbox keeps a backup of any file it edits, and leaves a file it cannot make sense of
alone.

Two things are worth being clear about, because they are the whole shape of the feature.

**It can only read.** The assistant sees your applications, their stages and timelines, and
the text of the email Jobbox has synced. There is no way for it to change a stage, edit an
application, send anything, or delete a message — not a rule it is asked to follow, but a
door that is not there. Jobbox's own agent keeps working the way it always has: it proposes,
and you accept.

**What it reads goes to that assistant's provider.** This is the part to decide with your
eyes open. Asking a question about an email means the text of that email is sent to whoever
runs the assistant you connected, under their terms, exactly as if you had pasted it in
yourself. That is why the switch starts off. Turning it off again cuts access immediately,
including for a client you have already set up — you do not need to restart anything.

It works whether or not Jobbox is open, so you can ask from your editor without hunting for
the window.

## Jobbox knows which resume an application was sent with

Applications filed through **Apply** attach a tailored copy of the resume they were sent
with, and the rest of the app could not see that copy. The **Documents** section on an
application showed nothing where the PDF should be, the board went on asking **Resume?**
about an application that had one, and the original's usage count never moved.

The resume an application points at now resolves wherever it came from — tailored,
original, or one you have since archived. The label you see is the document's name today;
the PDF stored with the application stays the record of what was actually sent.

Two related repairs. If your resume library came through an earlier update with no default
marked — which happened to libraries built from uploaded files — Jobbox picks the newest
editable one as the default again. And filing an application is now all-or-nothing: if
something fails partway, you no longer end up with a stray tailored resume and no
application pointing at it, and pressing **Apply** again does not leave another one behind.

## Mail that used to go missing

Several separate ways a message could vanish, all fixed this week.

Two genuinely different emails that happened to carry the same internal identifier — routine
from bulk senders and some application-tracking systems — were stored as one, the later
quietly overwriting the earlier. They are now kept apart unless their dates agree too.

If you run your own mail server, or use anything other than Gmail that marks a folder as
holding everything, Jobbox was reading four folders and skipping the rest — which brought
back, for exactly those accounts, the problem the folder walk was written to solve. The
shortcut now applies only to Gmail, where it is true.

An account could also strand itself. A folder named something like "Passwords" or "Auth
notices" could make a perfectly ordinary error read as a rejected login, after which Jobbox
stopped reconnecting and told you to fix a password that was never wrong. Starting the app
before the network was up could leave an account with nothing sweeping its folders for the
rest of the session. And a first pass over a very large archive that was interrupted — you
quit, or the machine slept — started again from the beginning each time; it now resumes
where it stopped.

## Also

- Before an update that cannot be undone, Jobbox copies your database first, and stops
  rather than proceeding if it cannot. An older Jobbox opened against a database a newer
  one has written now says so plainly instead of starting up and quietly resyncing from a
  stale position.
- Screens that start an agent run — the apply flow, the answer cards, the description
  block, and **Run** on a single message — no longer get stuck showing a run that never
  finishes when the run is refused before it begins.
