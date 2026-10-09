# claude-mods

Small mods for the Claude Code desktop app.

## context-meter

Long sessions get expensive without telling you. Every request re-sends the whole conversation, so a turn at 400K tokens costs about five times what the same turn costs at 80K, and your plan limits drain faster the longer you go. The built-in counter sits behind a click, so you usually notice only after the limit has taken the hit.

context-meter keeps a small pill above the prompt. The ring fills toward the point where compacting pays off, and the number next to it is your current context size. When it's time, a Compact button shows up right beside it. Nothing to hover, nothing to open.

- **Green, under 250K:** normal working range
- **Amber, 250K to 400K:** compact at the next natural break
- **Red, 400K and up:** compact now

The thresholds are two constants at the top of `context-meter/hooks/register.tsx`.

## Install

In a terminal Claude Code session:

```
/plugin install context-meter --marketplace Warstellar/claude-mods
```

Answer `y` to add the marketplace and pick the user scope. The desktop Code tab picks it up in new sessions.
