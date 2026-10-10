# FPL Stats: getting started

Thanks for trying FPL Stats. It's a Fantasy Premier League companion app I've been building as a side project. It runs on AWS, and it's open about its caveats, so read on.

## Getting in

1. Open **https://main.d29izwx9gn2m58.amplifyapp.com** on your phone. The layout is mobile-first; on desktop it sits in a phone-shaped column.
2. Add it to your home screen (Chrome: ⋮ → *Add to Home screen*; Safari: Share → *Add to Home Screen*). It then opens like an app.
3. On first launch it asks for your **FPL team ID**. Log in at [fantasy.premierleague.com](https://fantasy.premierleague.com), open *Points* or *Pick Team*, and copy the number from the URL: `https://fantasy.premierleague.com/entry/1234567/event/7` → your team ID is `1234567`.

There's no password and no account. Your team ID and settings are stored only on your device.

## What the tabs do

- **My Team.** Your squad on a pitch (or as a list), with each player's expected points (xP) for the next gameweek. Switch between *Yours* and *Suggested* to see the best XI and captain by xP. A banner shows the next deadline, or during a gameweek which matches are live; players show ● while their club plays and ✓ once it's done. Tap the banner for the fixture list.
- **Players.** Every player, sortable and filterable by xP, price, form and more. Active filters show as chips you can tap to remove. Players you already own are dimmed.
- **Transfers.** Ranked transfer plans for your squad over the next few gameweeks: who goes out, who comes in, the net xP gain, your bank, and any −4 hit. You can choose how many gameweeks to plan over and the most transfers to consider, and correct your free-transfer count if it's wrong (for example, right after you've made transfers).
- **Friends.** Add friends by team ID or import a whole classic league, compare ranks, and tap a friend to see their current squad.
- **Settings.** Change your team ID or theme (light, dark, or follow your phone).

## Known limitations

- **No FPL login.** I never see your password. The app only uses FPL's public data for your team ID, so anything that needs a login (unconfirmed transfers, chips you haven't played yet) won't show up. That's also why the free-transfer count can be off until FPL publishes your transfers; you can correct it on the Transfers tab.
- **Chip detection is best-effort.** If you've played Free Hit, My Team shows a banner because the squad you see that week isn't your "real" one.
- **xP is a model, not a prophecy.** It uses fixtures, minutes, underlying stats (xG, xA, defensive contributions) and a few custom signals. It disagrees with the official site sometimes, on purpose. It updates overnight, and moves on to the next gameweek as soon as a deadline passes.
- **Live points lag.** During matches, points and minutes refresh from FPL roughly every 30 minutes, not in real time.
- **Rough edges.** It's a side project. Things will break. Tell me when they do.

## Sending feedback

Anything broken, confusing or just wrong: WhatsApp or email Jakob directly. Screenshots help a lot. The more boring the bug sounds ("the back button on this screen goes to the wrong place"), the more useful it usually is.
