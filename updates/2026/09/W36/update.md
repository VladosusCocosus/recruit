# Jobbox — week of 31 August 2026

Three additions this week. Two are about the part of a job hunt that happens away from your
inbox: what you actually sent, and what was actually said. The third is about timing —
Jobbox can now tell you about a call before it starts, rather than waiting for you to come
looking.

## Jobbox now knows which resume you sent

**Settings → Resume** holds a default resume and a library of every other one you have
used. Once an application reaches **Applied**, its board card grows a **Resume?** chip.
Answer it with the default, another resume from the library, a file you pick on the spot,
or **Skip for now** — the same picker sits in the application's inspector if you would
rather answer it there.

The record points at the file you actually sent, not at "whatever the default is". Change
your default next month and every past application still shows the resume that went out
with it. Files are copied into Jobbox's own storage, so renaming or moving the original
on disk does not break the record.

Applications still sitting at **Saved** stay quiet — you have not applied yet, so there is
nothing to record. Ones you have already closed are still asked, since you applied before
they closed. And **Skip for now** is a real answer rather than a way of dismissing the
question: the chip stops asking about that application. Reopen the picker and choose **Ask
about this one again** if you change your mind.

Removing a resume from the library takes it out of the picker without touching the
applications that were sent with it. None of this reaches the agent either — resumes are
not part of what it reads when it goes through your mail, and it has no way to propose one
for you. Recording what went out stays yours.

## Jobbox asks how your calls went

An application's timeline gains a third action beside Add note and Add event: **Log a
call**. It asks the kind of conversation (recruiter screen, technical, hiring manager,
onsite), who you are speaking to — pre-filled with the contact already on the
application — when it starts and ends, the meeting link, and anything you want in front of
you beforehand.

Fifteen minutes after the call is over, the next time you come back to Jobbox it asks
**How did it go?** You answer with:

- **How it went** — went well, mixed, or went badly
- **Notes** — whatever you want to remember, in Markdown
- **Follow-ups** — anything you promised on the call, each with a date
- **A nudge** — a reminder to chase the recruiter, pre-filled with their name and dated
  three working days out

Everything you enter lands on the application's timeline: the notes as a note, each
follow-up and the nudge as dated tasks. They show up in **Up next** alongside your
interviews, so the thing you owe someone sits in the same list as the thing they owe you.

Not now is a real answer. **Remind me later** brings it back in a couple of hours, and
**Skip** drops it for good. Any call still waiting on an answer is pinned at the top of Up
next, so a prompt you dismissed is never lost.

Two things Jobbox deliberately does not do here. Saying a call went badly does not move
the application's status — that call is yours to make. And logging a call that already
happened works fine: put in the times, and it will ask about it straight away.

## Jobbox speaks up when something needs you

Until now Jobbox only had a voice while you were looking at it. It can now send an ordinary
macOS notification for three things:

- **Before an interview** — fifteen minutes ahead, or whatever you set it to, anywhere from
  a minute to a day
- **After a call** — the same **How did it go?** prompt as above, arriving when the call is
  over instead of waiting for you to open the app
- **When a scan finds something** — once the agent has been through your mail and left
  proposals in **Review**

Clicking a notification opens what it is about: the application for an interview or a
debrief, the review queue for proposals.

The Jobbox icon in your dock now carries a number too — proposals waiting in **Review**,
plus calls still owing a debrief. It counts the same things the sidebar already counts;
the difference is that you can see it without switching to the app.

You are asked about all this once. The setup checklist has a fifth step, **Turn on
notifications**, offering **Turn on** and **No thanks**. The reason it is a question rather
than a switch you have to go and find is that macOS gives an app no way to ask politely in
advance — the system's own permission box appears the moment an app first sends something.
So Jobbox sends nothing at all until you have answered, and saying no here means macOS
never asks you either. If you change your mind later, **Settings → Notifications** has a
switch for each kind and the lead time for interviews.

A few things it deliberately will not do. It only speaks while it is running — there is no
background service, so if you have quit Jobbox, a reminder for a two o'clock call will not
arrive. Nor will it turn up stale: reminders whose moment passed while the app was closed
are dropped rather than delivered in a pile when you next open it. All-day entries in your
calendar are never announced, because "in fifteen minutes" means nothing for something that
takes the whole day. And the proposals notification stays quiet when Jobbox is already the
window in front of you — the **Review** badge is right there saying the same thing.

## Also

Your database updates itself the first time you open this build. Nothing to do.
