/* Token Radar page: runs RadarModel over the sealed snapshot (data.js) and renders the board,
 * filters, sorting, the detail drawer, the comparables and the model. State lives in the URL hash,
 * so every view (a filter, a sort, an open protocol) is a link. */
(function () {
  'use strict';
  var R = window.RadarModel, snap = window.SNAPSHOT;
  var radar = R.build(snap), M = radar.model, money = R.money, pct = R.fmtPct;
  var bySlug = {};
  radar.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = radar.rows[0].implied_value_usd;

  var SEGMENTS = [['all', 'All ranked'], ['watchlist', 'Watchlist'], ['above-floor', 'Above floor, off list'], ['early', 'Early: under ' + money(radar.floor_usd)]];
  var COLS = [
    ['rank', '#', 'num'], ['name', 'Protocol', ''], ['tvl', 'TVL', 'num'], ['change', '7d', 'num'],
    ['age', 'Runway', 'num'], ['multiple', 'Peer ×', 'num'], ['implied', 'Implied value', 'num wide'],
    ['cost', 'Est. network fees', 'num']
  ];
  var KEY = {
    rank: function (r) { return r.rank; }, name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; }, change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    age: function (r) { return r.factors.age_days === null ? -1 : r.factors.age_days; },
    multiple: function (r) { return r.factors.multiple; }, implied: function (r) { return r.implied_value_usd; },
    cost: function (r) { return r.plan.usd; }
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function $(id) { return document.getElementById(id); }
  function days(d) { return d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function x2(v) { return '×' + v.toFixed(2); }
  function feeLabel(usd) { return usd === null ? 'Unknown' : '~' + money(usd); }
  function cls(v) { return v === null ? 'flat' : v > 0.5 ? 'up' : v < -0.5 ? 'down' : 'flat'; }

  /* ---- state in the hash ---- */
  function readState() {
    var s = { tab: 'board', seg: 'all', cat: '', chain: '', mom: '', q: '', sort: 'rank', dir: 'asc', p: '', cmp: '' };
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) s[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return s;
  }
  var S = readState();
  function writeState() {
    var parts = [];
    Object.keys(S).forEach(function (k) { if (S[k]) parts.push(k + '=' + encodeURIComponent(S[k])); });
    history.replaceState(null, '', '#' + parts.join('&'));
  }

  /* ---- header and summary ---- */
  function header() {
    $('stamp').innerHTML = 'Snapshot <b>' + esc(radar.as_of) + '</b><span>' + radar.protocol_count + ' protocols ≥ $5M TVL · DefiLlama</span>';
    var wl = radar.rows.filter(function (r) { return r.watchlist; }).length;
    var total = radar.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var early = radar.rows.filter(function (r) { return r.segment === 'early'; }).length;
    var kp = [
      ['Ranked pre-token', radar.rows.length, early + ' below the ' + money(radar.floor_usd) + ' floor'],
      ['Watchlist covered', wl + ' / ' + radar.watchlist_size, 'every house watchlist slug is ranked'],
      ['Implied launch value', money(total), 'sum of the board, model ' + M.version],
      ['Trading comparables', radar.peers.count, 'median mcap/TVL ' + x2(radar.peers.global) + ', the peer anchor']
    ];
    $('kpis').innerHTML = kp.map(function (k) {
      return '<div class="kpi"><span>' + k[0] + '</span><b>' + k[1] + '</b><small>' + esc(k[2]) + '</small></div>';
    }).join('');
  }

  /* ---- board ---- */
  function options(values, sel, all) {
    return '<option value="">' + all + '</option>' + values.map(function (v) {
      return '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }
  function uniq(list) { var o = {}; list.forEach(function (v) { o[v] = 1; }); return Object.keys(o).sort(); }

  function filtered() {
    var q = S.q.toLowerCase();
    var rows = radar.rows.filter(function (r) {
      if (S.seg !== 'all' && r.segment !== S.seg) return false;
      if (S.cat && r.category !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.mom === 'up' && !(r.change_7d > 0)) return false;
      if (S.mom === 'down' && !(r.change_7d < 0)) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = KEY[S.sort] || KEY.rank, dir = S.dir === 'desc' ? -1 : 1;
    return rows.sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x === y) return a.rank - b.rank;
      if (x === null || y === null) return x === null ? 1 : -1;
      return (x < y ? -1 : 1) * dir;
    });
  }

  function board() {
    var cats = uniq(radar.rows.map(function (r) { return r.category || 'Uncategorised'; }));
    var chains = uniq([].concat.apply([], radar.rows.map(function (r) { return r.chains; })));
    var rows = filtered();
    var sum = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var html = '<div class="filters">' +
      '<div class="chips">' + SEGMENTS.map(function (s) {
        var n = s[0] === 'all' ? radar.rows.length : radar.rows.filter(function (r) { return r.segment === s[0]; }).length;
        return '<button class="chip' + (S.seg === s[0] ? ' on' : '') + '" data-seg="' + s[0] + '">' + esc(s[1]) + ' <i>' + n + '</i></button>';
      }).join('') + '</div>' +
      '<div class="controls">' +
      '<input id="q" type="text" inputmode="search" aria-label="Search protocol or category" placeholder="Search protocol or category" value="' + esc(S.q) + '">' +
      '<select id="cat" aria-label="Category">' + options(cats, S.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + options(chains, S.chain, 'All chains') + '</select>' +
      '<select id="mom" aria-label="7-day momentum"><option value="">Any 7d trend</option><option value="up"' + (S.mom === 'up' ? ' selected' : '') + '>TVL growing</option><option value="down"' + (S.mom === 'down' ? ' selected' : '') + '>TVL shrinking</option></select>' +
      '</div></div>' +
      '<p class="count">Showing <b>' + rows.length + '</b> of ' + radar.rows.length + ' ranked protocols · ' + money(sum) + ' implied · click a row for its value build-up and farm plan</p>' +
      '<div class="boardgrid"><div class="tablewrap"><table class="grid"><thead><tr>' + COLS.map(function (c) {
        var on = S.sort === c[0];
        return '<th class="' + c[2] + (on ? ' sorted' : '') + '" data-sort="' + c[0] + '" aria-sort="' + (on ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' + c[1] + (on ? (S.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
      }).join('') + '</tr></thead><tbody>' + rows.map(rowHtml).join('') + '</tbody></table>' +
      (rows.length ? '' : '<p class="empty">No ranked protocol matches these filters.</p>') + '</div>' + rail(rows) + '</div>';
    $('view').innerHTML = html;
  }

  function rowHtml(r) {
    var f = r.factors, w = Math.max(2, Math.round(100 * Math.sqrt(r.implied_value_usd / maxImplied)));
    return '<tr data-slug="' + esc(r.slug) + '"' + (S.p === r.slug ? ' class="sel"' : '') + '>' +
      '<td class="num rank">' + r.rank + '</td>' +
      '<td><div class="pname">' + esc(r.name) + (r.watchlist ? ' <em class="tag wl">watchlist</em>' : r.segment === 'early' ? ' <em class="tag early">early</em>' : '') + '</div>' +
      '<div class="pmeta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains[0] || '–') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') + '</div></td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + cls(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + days(f.age_days) + '</td>' +
      '<td class="num">' + x2(f.multiple) + '</td>' +
      '<td class="num wide"><div class="bar"><span style="width:' + w + '%"></span></div><b>' + money(r.implied_value_usd) + '</b></td>' +
      '<td class="num">' + feeLabel(r.plan.usd) + '<small>' + esc(r.plan.chain) + '</small></td></tr>';
  }

  /* ---- right rail: radar map and value mix of the rows in view ---- */
  function rail(rows) {
    var W = 300, H = 230, P = 26, inView = {};
    rows.forEach(function (r) { inView[r.slug] = 1; });
    var lx = function (v) { return P + (Math.log10(Math.max(v, 5e6)) - 6.7) / (9.6 - 6.7) * (W - P - 8); };
    var ly = function (c) { return 8 + (M.momentum_cap - Math.max(M.momentum_floor, Math.min(M.momentum_cap, c || 0))) / (M.momentum_cap - M.momentum_floor) * (H - P - 8); };
    var dots = radar.rows.slice().reverse().map(function (r) {
      var rad = 2 + 9 * Math.sqrt(r.implied_value_usd / maxImplied);
      return '<circle data-slug="' + esc(r.slug) + '" class="d ' + r.segment + (inView[r.slug] ? '' : ' dim') + (S.p === r.slug ? ' sel' : '') + '" cx="' + lx(r.tvl_usd).toFixed(1) + '" cy="' + ly(r.change_7d).toFixed(1) + '" r="' + rad.toFixed(1) + '"><title>' + esc(r.name) + ' · ' + money(r.implied_value_usd) + '</title></circle>';
    }).join('');
    var axis = [1e7, 1e8, 1e9].map(function (v) { return '<line x1="' + lx(v) + '" x2="' + lx(v) + '" y1="8" y2="' + (H - P) + '"/><text x="' + lx(v) + '" y="' + (H - 10) + '">' + money(v) + '</text>'; }).join('') +
      '<line class="zero" x1="' + P + '" x2="' + W + '" y1="' + ly(0) + '" y2="' + ly(0) + '"/><text class="y" x="2" y="' + (ly(0) + 4) + '">0%</text><text class="y" x="2" y="16">+60</text><text class="y" x="2" y="' + (H - P) + '">−40</text>';
    var mix = {}, total = 0;
    rows.forEach(function (r) { var c = r.category || 'Uncategorised'; mix[c] = (mix[c] || 0) + r.implied_value_usd; total += r.implied_value_usd; });
    var top = Object.keys(mix).sort(function (a, b) { return mix[b] - mix[a]; }).slice(0, 6);
    return '<aside class="rail"><section class="card"><h3>Radar map <small>TVL (log) × 7-day change · dot size = implied value</small></h3>' +
      '<svg class="map" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Radar map">' + axis + dots + '</svg>' +
      '<p class="legend"><i class="watchlist"></i>watchlist <i class="above-floor"></i>above floor <i class="early"></i>early</p></section>' +
      '<section class="card"><h3>Implied value by category <small>rows in view</small></h3>' + (top.length ? top.map(function (c) {
        return '<div class="mix"><span>' + esc(c) + '</span><b>' + money(mix[c]) + '</b><div class="bar"><span style="width:' + Math.round(100 * mix[c] / mix[top[0]]) + '%"></span></div></div>';
      }).join('') : '<p class="note">Nothing in view.</p>') + '</section>' +
      '<section class="card"><h3>Every row, one formula</h3><p class="formula sm">TVL × peer × momentum × runway</p><p class="note">Peer multiple from ' + radar.peers.count + ' trading protocols; see Value model.</p></section></aside>';
  }

  /* ---- detail drawer ---- */
  function drawer() {
    var r = bySlug[S.p], d = $('drawer');
    document.body.classList.toggle('open', !!r);
    d.setAttribute('aria-hidden', r ? 'false' : 'true');
    if (!r) { d.innerHTML = ''; return; }
    var f = r.factors;
    var peers = radar.live.filter(function (l) { return l.category === r.category; }).slice(0, 5);
    var steps = [
      ['TVL', money(r.tvl_usd), 'snapshot tvl_usd', 1],
      ['Peer multiple', x2(f.multiple), f.peer_n ? f.peer_n + ' trading ' + esc(r.category) + ' peer' + (f.peer_n > 1 ? 's' : '') + ', shrunk to the all-category median' : 'no trading peer in category: all-category median', f.multiple],
      ['Momentum', x2(f.momentum), '7-day TVL ' + pct(r.change_7d) + (r.change_7d === null ? ' (counted flat)' : ''), f.momentum],
      ['No-token runway', x2(f.runway), f.age_days === null ? 'listing date unknown: counted as ' + M.unknown_age_days + ' days' : days(f.age_days) + ' tracked with no token, since ' + esc(r.listed_at), f.runway]
    ];
    d.innerHTML = '<button class="close" id="close" aria-label="Close detail">×</button>' +
      '<p class="eyebrow">Rank ' + r.rank + ' of ' + radar.rows.length + ' · ' + esc(r.category || 'Uncategorised') + (r.watchlist ? ' · on the house watchlist' : '') + '</p>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="chainlist">' + r.chains.map(esc).join(' · ') + '</p>' +
      '<div class="hero"><div><span>Implied launch value</span><b>' + money(r.implied_value_usd) + '</b></div>' +
      '<div><span>Estimated network fees</span><b>' + feeLabel(r.plan.usd) + '</b><small>' + esc(r.plan.chain) + ' · one test and exit</small></div></div>' +
      '<div class="dcols"><div>' + '<h3>How the value is built</h3><ol class="build">' + steps.map(function (s, i) {
        var tone = i === 0 ? '' : s[3] >= 1 ? ' up' : ' down';
        return '<li><span class="op">' + (i ? '×' : '') + '</span><div><b>' + s[0] + '</b><small>' + s[2] + '</small></div><em class="' + tone + '">' + s[1] + '</em></li>';
      }).join('') + '<li class="eq"><span class="op">=</span><div><b>Implied value</b><small>rounded to whole dollars, the board.json figure</small></div><em>' + money(r.implied_value_usd) + '</em></li></ol>' +
      '<h3>Sensitivity <small>one factor changed, the rest held</small></h3><table class="mini">' + [
        ['Peer multiple at the all-category median ' + x2(radar.peers.global), r.implied_value_usd / f.multiple * radar.peers.global],
        ['7-day change counted flat', r.implied_value_usd / f.momentum],
        ['Runway at 3 years', r.implied_value_usd / f.runway * (M.runway_floor + M.runway_span * (1 - Math.exp(-1095 / M.runway_tau_days)))],
        ['TVL down 30%', r.implied_value_usd * 0.7]
      ].map(function (v) {
        var d = v[1] / r.implied_value_usd - 1;
        return '<tr><td>' + v[0] + '</td><td class="num">' + money(v[1]) + '</td><td class="num ' + cls(d * 100) + '">' + (d >= 0 ? '+' : '') + Math.round(d * 100) + '%</td></tr>';
      }).join('') + '</table>' +
      '<h3>Trading peers in ' + esc(r.category || 'this category') + '</h3>' +
      (peers.length ? '<table class="mini"><tr><th>Protocol</th><th class="num">Mcap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th></tr>' + peers.map(function (l) {
        return '<tr><td>' + esc(l.name) + ' <small>' + esc(l.symbol || '') + '</small></td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + x2(l.multiple) + '</td></tr>';
      }).join('') + '</table>' : '<p class="note">No protocol in this category trades with a recorded market cap, so the all-category median ' + x2(radar.peers.global) + ' anchors it.</p>') +
      '</div><div>' + '<h3>Farm plan <small>' + r.plan.minutes + ' min hands-on · ' + r.plan.days + '-day review</small></h3>' +
      '<p class="note plan-note">Start with a free eligibility check. The snapshot has no campaign rules. Fee estimates cover network transactions and exclude funding, capital and protocol charges.</p>' +
      '<ol class="plan">' + r.plan.steps.map(function (s) {
        return '<li><strong>' + esc(s.title) + '</strong><p>' + esc(s.text) + '</p><span class="c">' + esc(s.cost) + '</span><span class="t">' + esc(s.time) + '</span></li>';
      }).join('') + '</ol></div></div>' +
      '<p class="note">An implied value is this board\'s claim from the record as it stands, not a forecast that a token will launch. DefiLlama records no token for ' + esc(r.name) + '; a token it does not carry may still exist.</p>';
    $('close').onclick = function () { S.p = ''; sync(); };
  }

  /* ---- side-by-side farm plans, from the same filtered pool as the board ---- */
  function compare() {
    var pool = filtered();
    if (!S.cmp) { S.cmp = pool.slice(0, 3).map(function (r) { return r.slug; }).join(','); writeState(); }
    var picked = S.cmp.split(',').filter(function (s) { return bySlug[s]; });
    picked = picked.filter(function (s, i, a) { return a.indexOf(s) === i; }).slice(0, 4);
    var picker = pool.slice(0, 16).map(function (r) {
      return '<button class="pick' + (picked.indexOf(r.slug) >= 0 ? ' on' : '') + '" data-cmp="' + esc(r.slug) + '">' +
        esc(r.name) + ' <i>#' + r.rank + '</i></button>';
    }).join('');
    var cards = picked.map(function (slug) {
      var r = bySlug[slug], p = r.plan;
      return '<section class="cmpcol"><header><span class="cmp-rank">#' + r.rank + '</span><h3>' + esc(r.name) + '</h3>' +
        '<p class="pmeta">' + esc(r.category || 'Uncategorised') + ' · ' + money(r.implied_value_usd) + ' implied</p></header>' +
        '<div class="cmpstats"><div><span>Fees</span><b>' + feeLabel(p.usd) + '</b></div>' +
        '<div><span>Hands-on</span><b>' + p.minutes + ' min</b></div>' +
        '<div><span>Review</span><b>' + p.days + ' d</b></div>' +
        '<div><span>Cheap chain</span><b>' + esc(p.chain) + '</b></div></div>' +
        '<h4>Participation conditions <small>clear before funding</small></h4><ul class="conds">' +
        p.conditions.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' +
        '<h4>Plan steps <small>cost · time</small></h4><ol class="cmpsteps">' +
        p.steps.map(function (s) { return '<li><b>' + esc(s.title) + '</b><span>' + esc(s.cost) + ' · ' + esc(s.time) + '</span></li>'; }).join('') +
        '</ol></section>';
    }).join('');
    $('view').innerHTML = '<p class="count">Same filters as the board · ' + pool.length + ' protocols in view · ' +
      'pick up to four. Fees are network estimates; eligibility, capital and protocol charges depend on the live campaign.</p>' +
      '<div class="picker">' + picker + '</div>' +
      (cards ? '<div class="cmpgrid">' + cards + '</div>' : '<p class="empty">No protocol in view.</p>');
  }

  /* ---- comparables, parked, model ---- */
  function live() {
    $('view').innerHTML = '<p class="count">Protocols whose token already trades. They are kept off the launch board and used as its yardstick: their mcap/TVL, per category, sets each pre-token protocol\'s peer multiple.</p>' +
      '<div class="tablewrap"><table class="grid"><thead><tr><th>Protocol</th><th>Token</th><th>Category</th><th class="num">Mcap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th><th class="num">7d</th></tr></thead><tbody>' +
      radar.live.map(function (l) {
        return '<tr class="static"><td><div class="pname">' + esc(l.name) + '</div></td><td>' + esc(l.symbol || '–') + '</td><td>' + esc(l.category || '–') + '</td><td class="num">' + money(l.mcap_usd) + '</td><td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + x2(l.multiple) + '</td><td class="num ' + cls(l.change_7d) + '">' + pct(l.change_7d) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function parked() {
    $('view').innerHTML = '<p class="count">' + radar.parked.length + ' protocols record no token but look like a product of a parent (the house watchlist rule, applied to every row above and below the floor). They are listed, not ranked: a launch would most likely come from the parent.</p>' +
      '<div class="tablewrap"><table class="grid"><thead><tr><th>Protocol</th><th>Category</th><th>Why parked</th><th class="num">TVL</th><th class="num">7d</th></tr></thead><tbody>' +
      radar.parked.map(function (p) {
        return '<tr class="static"><td><div class="pname">' + esc(p.name) + '</div></td><td>' + esc(p.category || '–') + '</td><td>' + esc(p.why) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num ' + cls(p.change_7d) + '">' + pct(p.change_7d) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function model() {
    var t = radar.peers.table;
    var cats = Object.keys(t).sort(function (a, b) { return t[b].n - t[a].n || (a < b ? -1 : 1); });
    $('view').innerHTML = '<div class="modelgrid"><section class="card"><h3>Formula</h3>' +
      '<p class="formula">implied = TVL × peer multiple × momentum × runway</p><ul class="defs">' +
      '<li><b>Peer multiple</b> median mcap/TVL of the trading protocols in the same category, blended in log space with ' + M.shrink_k + ' pseudo-peers at the all-category median ' + x2(radar.peers.global) + ', clamped to ' + M.multiple_min + '–' + M.multiple_max + '.</li>' +
      '<li><b>Momentum</b> e^(' + M.momentum_weight + ' × 7-day TVL change), the change clamped to ' + M.momentum_floor + '%…+' + M.momentum_cap + '%; unreported counts flat.</li>' +
      '<li><b>Runway</b> ' + M.runway_floor + ' + ' + M.runway_span + ' × (1 − e^(−days/' + M.runway_tau_days + ')): days since DefiLlama began tracking it with no token. Longer runway, more user history stored up for a launch.</li>' +
      '<li><b>Farm plan</b> uses snapshot category and chains to suggest eligibility checks and a conditional participation route. Network fees are modeled per transaction. Eligibility, capital, funding fees and protocol charges depend on the live campaign.</li>' +
      '<li><b>Parked</b> no-token records in the categories Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, or with a version suffix, a wrapped/staked word or an exchange name, are listed apart.</li></ul>' +
      '<p class="note">No protocol name is special-cased: one function, RadarModel.build, scores every row, here and in main.ts.</p></section>' +
      '<section class="card"><h3>Peer multiples by category</h3><table class="mini"><tr><th>Category</th><th class="num">Trading peers</th><th class="num">Raw median</th><th class="num">Used</th></tr>' +
      cats.map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="num">' + t[c].n + '</td><td class="num">' + x2(t[c].raw) + '</td><td class="num">' + x2(t[c].multiple) + '</td></tr>'; }).join('') +
      '</table></section></div>';
  }

  /* ---- wiring ---- */
  function sync() {
    writeState();
    [].forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === S.tab ? 'true' : 'false');
    });
    ({ board: board, compare: compare, live: live, parked: parked, model: model }[S.tab] || board)();
    drawer();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-seg],[data-sort],[data-cmp],[data-slug]');
    if (e.target.id === 'scrim') { S.p = ''; return sync(); }
    if (!t) return;
    if (t.dataset.cmp) {
      var cur = S.cmp ? S.cmp.split(',') : [], at = cur.indexOf(t.dataset.cmp);
      if (at >= 0) cur.splice(at, 1);
      else { cur.push(t.dataset.cmp); if (cur.length > 4) cur.shift(); }
      S.cmp = cur.join(',');
    } else if (t.dataset.tab) { S.tab = t.dataset.tab; S.p = ''; }
    else if (t.dataset.seg) S.seg = t.dataset.seg;
    else if (t.dataset.sort) {
      if (S.sort === t.dataset.sort) S.dir = S.dir === 'asc' ? 'desc' : 'asc';
      else { S.sort = t.dataset.sort; S.dir = t.dataset.sort === 'rank' || t.dataset.sort === 'name' ? 'asc' : 'desc'; }
    } else if (t.getAttribute('data-slug')) S.p = t.getAttribute('data-slug');
    sync();
  });
  document.addEventListener('change', function (e) {
    if (['cat', 'chain', 'mom'].indexOf(e.target.id) >= 0) { S[e.target.id] = e.target.value; sync(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    S.q = e.target.value; writeState();
    var pos = e.target.selectionStart; board(); var q = $('q'); q.focus(); q.setSelectionRange(pos, pos);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.p) { S.p = ''; sync(); } });
  header();
  sync();
})();
