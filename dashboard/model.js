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
    unknown_age_days: 180
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
    return {
      multiple: multiple, peer_n: peer ? peer.n : 0, momentum: momentum, growth: growth, age_days: age,
      runway: runway, implied: implied
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
    if (/Curator|Capital Allocator/.test(c)) return 'curate';
    if (/Yield|Basis|Stablecoin Wrapper|CeDeFi|Leveraged|Options Vault|Indexes|Farm|Liquidity Manager|Governance/.test(c)) return 'vault';
    if (/Lending|CDP|Collateral|Uncollateralized/.test(c)) return 'lend';
    if (/Dexs|Derivatives|Prediction|OTC|Interest Rate/.test(c)) return 'trade';
    if (/RWA|Insurance/.test(c)) return 'rwa';
    if (/Chain|Payments|Privacy|Card/.test(c)) return 'chain';
    if (/Staking|Restak|BTC/.test(c)) return 'stake';
    return 'vault';
  }

  /** A conditional participation plan. The snapshot supports chain and category selection only. */
  function farmPlan(p) {
    var ch = cheapestChain(p.chains), gas = ch.gas, chain = ch.chain;
    var name = p.name, fam = family(p.category), steps = [];
    function step(title, text, transactions, minutes, days) {
      var usd = gas * transactions;
      steps.push({ title: title, text: text, usd: usd, minutes: minutes, days: days,
        cost: transactions === 0 ? '$0 network fees' : p.chains.length ? '~' + money(usd) + ' network fees' : 'Network fees unknown',
        time: (minutes >= 60 ? (minutes / 60).toFixed(1) + ' h' : minutes + ' min') + ' hands-on' + (days > 0 ? ', over ' + days + ' days' : '') });
    }
    step('Verify eligibility', 'Find the official ' + name + ' docs through its DefiLlama listing. Look for a live campaign, eligible markets, supported chains and a deadline. Stop here if there is no published way to qualify.', 0, 20, 0);
    step('Check the route', p.chains.length
      ? 'Verify the campaign supports ' + chain + ', the snapshot chain with the lowest modeled fee. Check the minimum amount, funding route and withdrawal terms before depositing.'
      : 'Confirm a supported chain, minimum amount and withdrawal terms before depositing. The snapshot supplies no chain for this protocol.', 0, 10, 0);
    if (fam === 'curate') {
      step('Find a curated vault', 'Confirm the campaign names a specific vault or lending market. Check which platform hosts it and whether the curator is listed in its official market directory.', 0, 15, 0);
      step('Verify a minimum deposit', 'If the hosted vault qualifies, check its current cap, underlying markets and withdrawal liquidity. Test the minimum deposit and match the receipt to the campaign tracker.', 2, 15, 7);
    } else if (fam === 'vault') {
      step('Test an eligible vault', 'If deposits count, use the smallest accepted amount in a listed vault. Approve only that amount and confirm that the deposit appears in the campaign tracker.', 2, 10, 0);
      step('Check redemption', 'Record any lockup, exit fee or queue. Check the vault share price and the tracker before the next weekly review.', 0, 10, 7);
    } else if (fam === 'lend') {
      step('Check the supply market', 'Confirm whether supplying alone qualifies and which assets count. If it does, test an eligible market with its minimum supply and verify campaign credit.', 2, 10, 0);
      step('Check withdrawal liquidity', 'Review the asset’s utilization and available liquidity before leaving a position open. If the campaign requires borrowing, reassess the plan with interest and liquidation risk included.', 0, 10, 7);
    } else if (fam === 'trade') {
      step('Test an eligible action', 'Look up the eligible markets and the minimum trade size. If a trade you already intended qualifies, preview its fee and slippage and verify campaign credit afterwards.', 2, 10, 0);
      step('Review progress', 'Check the campaign tracker against the trade receipt. Record any position close costs and avoid volume or activity that the campaign excludes.', 0, 10, 7);
    } else if (fam === 'rwa') {
      step('Check access and redemption', 'Review the issuer’s location and onboarding rules, subscription minimum and redemption windows. Verify the issuer before sharing any identity documents.', 0, 30, 0);
      step('Check subscription credit', 'If the issuer confirms eligibility and an acceptable redemption window, verify that a minimum subscription qualifies in the account tracker.', 2, 10, 7);
    } else if (fam === 'chain') {
      step('Test a listed app', 'Check the campaign’s approved apps and routes. If it includes an app you already use, confirm one eligible action and save the transaction receipt.', 1, 15, 0);
      step('Review campaign credit', 'Use the official tracker to confirm whether the receipt counted and record any minimum activity days stated in the rules.', 0, 10, 7);
    } else {
      step('Check the eligible staking route', 'Verify the supported asset, minimum stake and unbonding delay. If the campaign explicitly credits staking, confirm that a minimum stake appears in the tracker.', 2, 10, 0);
      step('Review withdrawal terms', 'Record the earliest exit date and any slashing or receipt-token price exposure before extending the position.', 0, 10, 7);
    }
    step('Plan the exit', 'Recheck if campaign credit disappears, withdrawals pause, an incident is reported, or TVL falls 30% from the snapshot to ' + money(p.tvl_usd * 0.7) + '. Confirm the official exit instructions before acting.', 2, 10, 0);
    // Participation conditions are checks to clear, not facts the snapshot proves. The compare view
    // shows them side by side so a reader can tell what each plan assumes before committing funds.
    var conditions = [
      'A live campaign with published rules exists for ' + name,
      'The campaign names an eligible ' + (fam === 'trade' ? 'market and trade size' : fam === 'rwa' ? 'issuer and subscription route' : 'vault or qualifying action'),
      p.chains.length ? 'The campaign supports ' + chain + ' and a minimum amount is known' : 'A supported chain and minimum amount are confirmed',
      'Withdrawal terms, exit liquidity and any lockup are reviewed',
      'Only the smallest test amount is committed until credit appears in the tracker'
    ];
    var usd = 0, minutes = 0, days = 0;
    steps.forEach(function (x) { usd += x.usd; minutes += x.minutes; days = Math.max(days, x.days); });
    return { steps: steps, conditions: conditions, usd: p.chains.length ? usd : null, minutes: minutes, days: days, chain: chain };
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
        var plan = farmPlan(p);
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
