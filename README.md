# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/trungminhdo4-glitch/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/trungminhdo4-glitch/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every protocol whose DefiLlama record shows no token by the launch value that record implies, and gives each one a farm plan with costed, timed steps.

- **Value model** (`dashboard/model.js`, run by both the page and `main.ts`):
  `implied = TVL × peer multiple × momentum × runway`.
  The peer multiple is the median mcap/TVL of the protocols in the same category whose token already trades, shrunk toward the all-category median. Momentum comes from the 7-day TVL change. Runway counts the days DefiLlama has tracked the protocol with no token.
- **Separation**: protocols with trading tokens are kept off the board and serve as the comparables. No-token records that look like a product of a parent (bridges, liquid staking, CEX, wrapped/staked names) are listed apart as *parked*.
- **Board**: all 40 watchlist protocols plus every other standalone no-token protocol, 198 rows in total. You can sort and filter by segment, category, chain and 7-day trend, open a detail drawer with the value build-up, sensitivity, peers and the farm plan, and see a radar map.
- No network and no dependencies. Two runs write the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
# then open out/dashboard/index.html
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
