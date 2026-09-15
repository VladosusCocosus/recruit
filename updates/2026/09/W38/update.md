# Jobbox — week of 14 September 2026

One correction so far this week, to the instructions for connecting an AI assistant.

## Quit your assistant before connecting it

Connecting Claude Desktop in **Settings → Assistants** appeared to work and then did
nothing: you pressed **Add**, the row showed the client as connected, and Claude Desktop
started up with no sign of Jobbox.

Claude Desktop keeps its own copy of its configuration while it runs and writes that copy
back out when it exits, so the entry Jobbox added underneath it was discarded a few minutes
later. Restarting the client afterwards — which is what Jobbox told you to do — could not
help, because the entry was already gone by then.

The fix for now is the order you do it in. **Quit the client first** (⌘Q, not just closing
the window), press **Add**, then start it again. The Assistants pane says so now.

Nothing about the server itself changed: it reads, it cannot write, and it stays off until
you turn it on.
