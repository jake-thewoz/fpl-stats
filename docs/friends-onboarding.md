# FPL Stats — friends beta

Hey, thanks for trying the beta. This is a Fantasy Premier League companion app I've been building. It's a one-person side project, runs on AWS, and is wide open about its caveats — read on.

## Getting in

1. Open the URL Jakob sent you. **Use your phone's browser** for the best experience — the layout is mobile-first. It also works on desktop, where it'll be centered in a phone-shaped column.
2. The browser will prompt for a username and password. Enter the credentials Jakob sent. (Single shared password for the whole beta — please don't pass it around.)
3. On first launch, the app asks for your **FPL team ID**. You can find this by logging into [fantasy.premierleague.com](https://fantasy.premierleague.com), going to "Points" or "Pick Team," and copying the number from the URL — e.g. `https://fantasy.premierleague.com/entry/1234567/event/35` → your team ID is `1234567`.

## What the tabs do

- **My Team** — your current squad with each player's expected points (xP) for the next gameweek and the rolling horizon (next 3 GWs). Bench is shown below the starting XI.
- **Players** — the global player pool, sortable by xP, price, form, ICT, and so on. Useful for "who should I bring in" research.
- **Transfers** — suggested transfer plans, FT-aware, including hits when the upside justifies the cost. The card shows the players going out / coming in, the xP delta, your bank balance, and any -4 hit applied.
- **Friends** — add friends by team ID and see your league-of-friends standings against them. Lightweight; this isn't a full leagues view (intentionally — see "Known limitations").
- **Settings** — change your team ID, toggle dark/light/system theme.

## Known limitations

- **No FPL login.** I never see your password. I only call the public FPL API using your team ID, so anything that requires authentication (your draft transfers, chip activations not yet confirmed) won't show up.
- **Free Hit / Wildcard / chip detection is best-effort.** When you've activated a chip mid-gameweek, the app may take a tick to reflect it. There's a banner that flags Free Hit specifically because the squad you see isn't your "real" squad that week.
- **xP is a model, not a prophecy.** My expected-points model uses fixtures, form, minutes, and a few custom signals — it disagrees with the official site sometimes, on purpose.
- **No real-time during matches.** Data refreshes on a schedule from the public FPL API; live scores during a fixture will lag.
- **Beta means rough edges.** Things will break. Tell me when they do.

## How to send feedback

Anything broken, confusing, or just wrong — WhatsApp/email Jakob directly. Screenshots help a lot. The more boring-sounding the bug ("the back button on this screen does the wrong thing") the more useful it tends to be.
