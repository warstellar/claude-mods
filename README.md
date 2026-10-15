# claude-mods

Small mods for the Claude Code desktop app.

## context-meter

Long threads get worse twice over. Every request re-sends the whole conversation, so a turn at 400K tokens costs about five times one at 80K. And well before a 1M window is full, the model starts losing track of what was settled early on. The built-in Context panel counts against the full window, so it looks calm right when the thread is getting heavy.

context-meter keeps a small pill above the prompt. The ring fills toward the point where compacting pays off, and the number next to it is your current context size. When it's time, a Compact button shows up right beside it.

- **Green, under 250K:** normal working range
- **Amber, 250K to 400K:** compact at the next natural break
- **Red, 400K and up:** compact now

On a model with a smaller window the marks scale down to 60% and 80% of it, so the pill still warns before the app compacts on its own. The numbers are constants at the top of `context-meter/hooks/register.tsx`.

## usage-meter

The question behind plan limits is simple: will I run out before it resets? usage-meter answers it with a color, so you don't have to read anything while things are fine.

The pill is the five-hour window: the ring fills with what you've spent. Its color follows what the 5h strip in the card shows: green while you're behind the tick, amber once you've spent more than the share of time gone, red from 85%. The week never shows on the pill: it's in the card on hover.

Hover the pill for one strip a window:

```
5h    ━━━━━━━│────────   ↻ 3h 10m
Week  ━━│─────────────   ↻ 6d
```

The fill is what you've spent, the tick is how much of the window's time has gone, and `↻` is the time until it resets. Fill past the tick means you're spending faster than time passes. That is also what colors each strip: amber past the tick, red from 85%. The 5h strip and the ring always share a color.

The first half hour of the five-hour window and the first 12 hours of the week never warn: there a single reply already puts the fill past the tick.

The two mods sit side by side in the same row. Install either or both.

## Install

In a terminal Claude Code session:

```
/plugin install context-meter --marketplace Warstellar/claude-mods
/plugin install usage-meter --marketplace Warstellar/claude-mods
```

Answer `y` to add the marketplace and pick the user scope. The desktop Code tab picks them up in new sessions.
