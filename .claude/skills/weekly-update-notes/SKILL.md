---
name: weekly-update-notes
description: Write the weekly user-facing update note for Jobbox into updates/YYYY/MM/Wnn/update.md, summarising what shipped that week in language an ordinary user understands. Use this whenever the user asks for update notes, release notes, a changelog entry, "what shipped this week", a weekly summary, or wants to tell users about recent changes — and also when they have just finished a feature and want it written up for whoever uses the app. Reach for it even if they do not say the words "update note".
---

# Weekly update notes

Jobbox keeps a note per ISO week describing what changed, written for the person who uses
the app rather than the person who built it. The notes live in `updates/`, one folder per
week, and they accumulate — a reader should be able to walk back through them and follow
the product's story.

The reason these are written per week rather than per release is that a release is a
packaging event and a week is a unit of work. Someone coming back after a fortnight away
wants to know what is different, not which tag it landed under.

## Find the week

Run the bundled script rather than working the dates out by hand:

```bash
python3 .claude/skills/weekly-update-notes/scripts/update_path.py
```

It prints the folder, the Monday–Sunday range, a ready-made `git log` date filter and a
title line. Pass an ISO date (`... update_path.py 2026-09-05`) to write up an earlier week.

The year and month come from the week's Thursday, so a week straddling a month boundary
lands in one folder whichever day you happen to write the note. Getting this wrong splits
one week across two months and is the single easiest mistake to make here.

## Find what shipped

Use the `--since`/`--until` line the script printed:

```bash
git log --since=<monday> --until=<sunday+1> --date=short --format='%h %ad %s'
```

Then read the actual change, not just the subject line. `git show --stat <sha>` and the
commit body tell you what a feature does; the subject line rarely does. Where a commit
touched the README or user-visible copy, that diff is usually the best source of accurate
wording.

If a week has no user-visible changes — refactors, build fixes, dependency bumps — say so
in a sentence and stop. A note padded with internal churn teaches readers to skip the next
one.

## Write for the user

The reader has the app open and wants to know what is different. They do not know your
schema, your file layout, or your commit history.

- **Name things as the interface names them.** "Settings → Resume", "the **Resume?** chip",
  "**Log a call**". If the reader cannot find it on screen from your description, the
  sentence has failed.
- **Lead with what they can now do**, then how it behaves. The mechanism only matters where
  it changes what they should expect.
- **Say what the feature deliberately does not do** when that would otherwise be a
  surprise — an interview marked "went badly" not moving the application's status is worth
  a line, because a reader might reasonably assume it would.
- **Skip anything they cannot see.** Migration numbers, table columns, IPC methods, test
  counts. "Your database updates itself on first launch" is the most a reader needs about a
  migration.
- **Use invented names in any example.** Never a real company, recruiter, or domain from
  the mailbox — this material can end up in public. Made-up names throughout.
- **Second person, plain sentences, sentence case in headings.** Match the tone of
  `.github/RELEASE_NOTES.md` and the README: direct, unhurried, no exclamation marks and no
  marketing verbs. "Jobbox now knows which resume you sent", not "Exciting new resume
  tracking!"

## Shape of the note

```markdown
# Jobbox — week of <D Month YYYY>

<One or two sentences naming the theme of the week, if the changes share one.
Otherwise say plainly that there were two unrelated additions.>

## <What the user can now do>

<Prose. Where to find it, what it does, how it behaves. Short lists only where the
content is genuinely a list — a form's fields, a set of states.>

## <The next one>

...

## Also

<Small things worth a line each. Drop this section when there is nothing in it.>
```

Headings are the feature as the user experiences it, not the commit subject. "Jobbox asks
how your calls went" beats "Post-call debrief modal".

## Writing into an existing week

Check whether `update.md` already exists in the week's folder before writing. If it does,
extend it — add a section for the new work, or fold detail into a section that already
covers it. The file is one document describing a week, not an append-only log, so a reader
arriving later should find a coherent note rather than two drafts stacked on top of each
other.

Create the folder with `mkdir -p` and write `update.md` inside it.
