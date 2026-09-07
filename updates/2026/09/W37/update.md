# Jobbox — week of 7 September 2026

Two changes this week, and they are the same change seen from two angles: Jobbox was
looking in one place for your mail, and now it looks everywhere. One folder became every
folder, and one account became every account.

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

## Also

Your database updates itself on first launch — nothing to do, and your existing mail and
applications are untouched.
