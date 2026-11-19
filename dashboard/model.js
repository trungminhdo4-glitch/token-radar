/* Token Radar value model: one function from the sealed snapshot to the ranked board.
 * The page loads this file to render the board; main.ts runs the very same file (node:vm) to write
 * board.json, so the numbers on screen and in board.json come from one code path.
 * No protocol name is special-cased anywhere: every figure follows from snapshot fields.
 *
 *   implied = TVL x peerMultiple(category) x momentum(change_7d) x runway(days with no token)
 *
 *   peerMultiple  median mcap/TVL of the protocols whose token already trades, per category, shrunk
 *                 toward the all-category median in log space (K pseudo-peers), clamped to [0.02, 3]
 *   momentum      exp(0.9 x clamp(change_7d, -40, 60) / 100); unreported change counts as flat
 *   runway        0.7 + 0.5 x (1 - exp(-days / 365)); a protocol that has run long with no token
 *                 has stored up more user history for an eventual launch; unknown age counts 180 days
 *   parked        a no-token record that looks like a product of a parent (category Bridge, Liquid
 *                 Staking, CEX..., a version suffix, a wrapped/staked name) is set aside, not ranked:
 *                 its users are likely served by the parent's token, the house watchlist rule applied
 *                 to every row, above and below the floor
 */
(function (root) {
  'use strict';

  var M = {
    version: 'radar-peer-2',
    shrink_k: 3,
    multiple_min: 0.02,
    multiple_max: 3,
    momentum_weight: 0.9,
    momentum_floor: -40,
    momentum_cap: 60,
    runway_floor: 0.7,
    runway_span: 0.5,
    runway_tau_days: 365,
    unknown_age_days: 180,
    community_share: 0.1,
    ticket_usd: 1000
  };

  // Categories the house watchlist rule treats as products of a parent token, and the name tests it uses.
  var PARENT_CATS = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAP_RE = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

  // Estimated cost of one on-chain transaction in USD by chain family (an estimate, stated in the page).
  var GAS = { Ethereum: 3, Bitcoin: 2, Solana: 0.01, Arbitrum: 0.05, Base: 0.03, Optimism: 0.05, BSC: 0.08,
    Polygon: 0.02, Avalanche: 0.1, Sui: 0.01, Aptos: 0.01, Hyperliquid: 0.02, 'Hyperliquid L1': 0.02,
    Tron: 1, TON: 0.05, Sonic: 0.02, Plasma: 0.01, Plume: 0.02, Katana: 0.02, Unichain: 0.03 };
  var GAS_DEFAULT = 0.25;

  function recordsNoToken(p) { return !p.gecko_id && !p.symbol && !p.mcap_usd; }
  function trades(p) { return p.mcap_usd > 0 && p.tvl_usd > 0; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function daysBetween(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  }

  /** Peer multiples: each category's mcap/TVL among trading protocols, shrunk toward the global median. */
  function peerTable(protocols) {
    var all = [], byCat = {};
    protocols.forEach(function (p) {
      if (!trades(p)) return;
      var l = Math.log(p.mcap_usd / p.tvl_usd);
      all.push(l);
      var c = p.category || 'Uncategorised';
      (byCat[c] = byCat[c] || []).push(l);
    });
    var g = median(all), table = {};
    Object.keys(byCat).forEach(function (c) {
      var ls = byCat[c], n = ls.length;
      var blended = (median(ls) * n + g * M.shrink_k) / (n + M.shrink_k);
      table[c] = { n: n, raw: Math.exp(median(ls)), multiple: clamp(Math.exp(blended), M.multiple_min, M.multiple_max) };
    });
    return { global: clamp(Math.exp(g), M.multiple_min, M.multiple_max), count: all.length, table: table };
  }

  function pathOf(p) {
    if (PARENT_CATS.indexOf(p.category) >= 0) return 'category ' + p.category;
    if (VERSION_RE.test(p.name)) return 'version suffix';
    if (WRAP_RE.test(p.name)) return 'wrapped/staked name';
    if (EXCHANGE_RE.test(p.name)) return 'exchange name';
    return null;
  }

  function cheapestChain(chains) {
    var best = null;
    (chains.length ? chains : ['Unknown']).forEach(function (c) {
      var g = GAS[c] === undefined ? GAS_DEFAULT : GAS[c];
      if (best === null || g < best.gas) best = { chain: c, gas: g };
    });
    return best;
  }

  /** Score one pre-token protocol. Returns the factors so the page can show the build-up. */
  function score(p, peers, asOf) {
    var peer = peers.table[p.category || 'Uncategorised'];
    var multiple = peer ? peer.multiple : peers.global;
    var growth = p.change_7d === null ? 0 : clamp(p.change_7d, M.momentum_floor, M.momentum_cap);
    var momentum = Math.exp(M.momentum_weight * growth / 100);
    var age = p.listed_at ? Math.max(0, daysBetween(p.listed_at, asOf)) : null;
    var runway = M.runway_floor + M.runway_span * (1 - Math.exp(-(age === null ? M.unknown_age_days : age) / M.runway_tau_days));
    var implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * runway));
    var pool = implied * M.community_share;
    return {
      multiple: multiple, peer_n: peer ? peer.n : 0, momentum: momentum, growth: growth, age_days: age,
      runway: runway, implied: implied,
      per_ticket: Math.round(pool * M.ticket_usd / p.tvl_usd)
    };
  }

  function money(x) {
    var a = Math.abs(x);
    if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'k';
    return '$' + (a < 10 ? x.toFixed(2) : Math.round(x));
  }

  /** The playbook family a category farms like. */
  function family(cat) {
    var c = cat || '';
    if (/Curator|Capital Allocator|Yield|Basis|Stablecoin Wrapper|CeDeFi|Leveraged|Options Vault|Indexes|Farm|Liquidity Manager|Governance/.test(c)) return 'vault';
    if (/Lending|CDP|Collateral|Uncollateralized/.test(c)) return 'lend';
    if (/Dexs|Derivatives|Prediction|OTC|Interest Rate/.test(c)) return 'trade';
    if (/RWA|Insurance/.test(c)) return 'rwa';
    if (/Chain|Payments|Privacy|Card/.test(c)) return 'chain';
    if (/Staking|Restak|BTC/.test(c)) return 'stake';
    return 'vault';
  }

  /** A farm plan: concrete steps, each with an estimated cost (USD), hands-on minutes and calendar days.
   *  Every number is read off the row (chains, TVL, 7-day change, the model's ticket payout). */
  function farmPlan(p, s) {
    var ch = cheapestChain(p.chains), gas = ch.gas, chain = ch.chain;
    var name = p.name, fam = family(p.category), t = M.ticket_usd;
    var ppm = (t / p.tvl_usd * 1e6).toFixed(2), steps = [];
    function step(text, usd, note, minutes, days) {
      steps.push({ text: text, usd: usd, minutes: minutes, days: days,
        cost: (usd === 0 ? '$0' : '~' + money(usd)) + (note ? ' + ' + note : ''),
        time: (minutes >= 60 ? (minutes / 60).toFixed(1) + ' h' : minutes + ' min') + ' hands-on' + (days > 0 ? ', over ' + days + ' days' : '') });
    }
    var bridge = chain === 'Ethereum' ? 0 : 3;
    step('Open ' + name + ' from its DefiLlama page (a link you trust) and confirm it still records no token; read its docs for a points, XP or season programme and its audits before moving money.', 0, '', 20, 0);
    step('Fund a fresh wallet on ' + chain + ', the cheapest of its ' + p.chains.length + ' chain' + (p.chains.length === 1 ? '' : 's') + ' (est. ' + money(gas) + ' a transaction), with a $' + t + ' ticket' + (bridge ? ', bridged from Ethereum or withdrawn from an exchange straight to ' + chain : '') + '.', bridge + gas, '', 20, 0);
    if (fam === 'vault') {
      step('Deposit the ticket into ' + name + "'s largest stablecoin or ETH vault (approve + deposit, 2 transactions). Your $" + t + ' is ' + ppm + ' ppm of its ' + money(p.tvl_usd) + ' TVL.', gas * 2, '', 5, 0);
      step('Hold and check weekly: vault share price, any points page, and the 7-day TVL trend (now ' + fmtPct(p.change_7d) + '). Time in the vault usually weighs as much as size.', 0, 'opportunity cost of the ticket', 65, 90);
    } else if (fam === 'lend') {
      step('Supply the ticket as collateral on ' + name + ' (approve + supply), then borrow 25-30% in a stablecoin to register as a borrower; stay under half the liquidation limit.', gas * 3 + 4, 'borrow interest', 10, 0);
      step('Repay and re-borrow once a month to stay an active account; recheck the health factor after any 10% move in the collateral.', gas * 6, '', 30, 90);
    } else if (fam === 'trade') {
      step('Trade on ' + name + ': split the ticket into 5 round trips across the month (about $5k volume), using limit orders where offered to keep fees low.', 10 + gas * 10, '', 40, 30);
      step('Keep a small open position or LP half the ticket in its deepest pair through month end; volume and active days are the usual points inputs on venues like this.', gas * 2, 'impermanent-loss risk', 20, 60);
    } else if (fam === 'rwa') {
      step('Complete ' + name + "'s onboarding/KYC if it asks (ID and proof of address); real-world-asset issuers often gate deposits by country.", 0, '', 30, 3);
      step('Subscribe the minimum the product allows (often $100-1000) and hold it: the asset yield pays you while you wait.', gas * 2, '', 10, 90);
    } else if (fam === 'chain') {
      step('Bridge to ' + name + ' and make 10 real transactions across its own apps (swap, lend, pay, mint), spread over separate weeks rather than one day.', gas * 10 + 2, '', 60, 28);
      step('Keep a balance on the network and delegate or run a light node where offered: long-lived balances usually count more than bursts.', 0, 'parked capital', 30, 90);
    } else {
      step('Stake the native asset through ' + name + ' (approve + stake) and note the unbonding period before committing.', gas * 2, 'unbonding delay', 10, 0);
      step('Hold the receipt token and use it once in a listed DeFi integration; integrations are often counted separately.', gas * 3, '', 20, 75);
    }
    step('Know the exit before you start: withdrawing to an exchange costs about ' + money(gas * 2) + ' on ' + chain + '. At this board\'s model a $' + t + ' ticket held to a launch maps to ~' + money(s.per_ticket) + ' of a 10% community pool.', gas * 2, '', 5, 0);
    step('Stop rule: exit if TVL falls 30% below ' + money(p.tvl_usd) + ', if deposits are paused, or if an incident report appears; re-score with each new snapshot.', 0, '', 15, 90);
    var usd = 0, minutes = 0, days = 0;
    steps.forEach(function (x) { usd += x.usd; minutes += x.minutes; days = Math.max(days, x.days); });
    return { steps: steps, usd: usd, minutes: minutes, days: days, chain: chain };
  }

  function fmtPct(x) { return x === null || x === undefined ? 'unreported' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }

  /** The whole radar: board rows (pre-token, ranked), comparables (trading) and the peer table. */
  function build(snap) {
    var peers = peerTable(snap.protocols);
    var watch = {};
    snap.watchlist.forEach(function (w) { watch[w] = true; });
    var rows = [], live = [], parked = [];
    snap.protocols.forEach(function (p) {
      var why = watch[p.slug] ? null : pathOf(p);
      if (recordsNoToken(p) && why) {
        parked.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, why: why });
      } else if (recordsNoToken(p)) {
        var s = score(p, peers, snap.as_of);
        var plan = farmPlan(p, s);
        rows.push({
          slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
          change_7d: p.change_7d, listed_at: p.listed_at, watchlist: !!watch[p.slug],
          segment: watch[p.slug] ? 'watchlist' : p.tvl_usd >= snap.floor_usd ? 'above-floor' : 'early',
          implied_value_usd: s.implied, factors: s, plan: plan
        });
      } else if (trades(p)) {
        live.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
          mcap_usd: p.mcap_usd, change_7d: p.change_7d, symbol: p.symbol, multiple: p.mcap_usd / p.tvl_usd });
      }
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    parked.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    live.sort(function (a, b) { return b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1); });
    return { as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, model: M, peers: peers,
      rows: rows, live: live, parked: parked, watchlist_size: snap.watchlist.length, protocol_count: snap.protocols.length };
  }

  root.RadarModel = { M: M, build: build, money: money, fmtPct: fmtPct, family: family, farmPlan: farmPlan };
})(typeof window !== 'undefined' ? window : globalThis);
