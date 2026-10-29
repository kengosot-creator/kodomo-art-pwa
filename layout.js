/* レイアウト計算（画面プレビューとPNG保存の両方が使う共通ロジック）
   単位はすべて mm。DOMには依存しない。 */
(function (root) {
  'use strict';
  var MARGIN = 12;   // 用紙の外側余白(mm)
  var GAP = 4;       // 作品どうしの間隔(mm)
  var GAP_G = 3;     // ギャラリー配置の間隔(mm)

  function fitGrid(items, rect, gap) {
    var n = items.length;
    if (!n) return [];
    var best = null;
    for (var cols = 1; cols <= n; cols++) {
      var rows = Math.ceil(n / cols);
      var cw = (rect.w - gap * (cols - 1)) / cols;
      var ch = (rect.h - gap * (rows - 1)) / rows;
      if (cw <= 0 || ch <= 0) continue;
      var score = 0;
      for (var i = 0; i < n; i++) {
        var s = Math.min(ch, cw / items[i].ar);
        score += s * s * items[i].ar; // 実際に表示される面積
      }
      if (!best || score > best.score) best = { score: score, cols: cols, rows: rows, cw: cw, ch: ch };
    }
    var cells = [], idx = 0;
    for (var r = 0; r < best.rows; r++) {
      var count = r < best.rows - 1 ? best.cols : n - best.cols * (best.rows - 1);
      var rowW = count * best.cw + gap * (count - 1);
      var x0 = rect.x + (rect.w - rowW) / 2; // 最後の行は中央寄せ
      for (var c = 0; c < count; c++) {
        cells.push({ id: items[idx++].id, x: x0 + c * (best.cw + gap), y: rect.y + r * (best.ch + gap), w: best.cw, h: best.ch });
      }
    }
    return cells;
  }

  function buildRows(items, W, h, gap) {
    var rows = [], cur = [], sum = 0;
    function finish(full) {
      var sumAr = 0;
      cur.forEach(function (it) { sumAr += it.ar; });
      var rh = full ? (W - gap * (cur.length - 1)) / sumAr : h;
      rows.push({ items: cur, h: rh });
      cur = []; sum = 0;
    }
    items.forEach(function (it) {
      cur.push(it); sum += it.ar * h;
      if (sum + gap * (cur.length - 1) >= W) finish(true);
    });
    if (cur.length) finish(false);
    return rows;
  }

  function justified(items, rect, gap) {
    var n = items.length;
    if (!n) return [];
    var rows, total;
    for (var k = 0; k <= 100; k++) {
      var h = rect.h * (1 - 0.97 * k / 100);
      rows = buildRows(items, rect.w, h, gap);
      total = gap * (rows.length - 1);
      rows.forEach(function (r) { total += r.h; });
      if (total <= rect.h + 1e-6) break;
    }
    var f = Math.min(1, rect.h / total);
    var y = rect.y + (rect.h - total * f) / 2;
    var cells = [];
    rows.forEach(function (r) {
      var rh = r.h * f, rw = gap * (r.items.length - 1);
      r.items.forEach(function (it) { rw += it.ar * rh; });
      var g = rw > rect.w ? rect.w / rw : 1; // 念のための横方向ガード
      var x = rect.x + (rect.w - rw * g) / 2;
      r.items.forEach(function (it) {
        var w = it.ar * rh * g;
        cells.push({ id: it.id, x: x, y: y, w: w, h: rh });
        x += w + gap * g;
      });
      y += rh + gap;
    });
    return cells;
  }

  function heroLayout(items, content, heroId) {
    var hero = items[0];
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === heroId) { hero = items[i]; break; }
    }
    var rest = items.filter(function (it) { return it !== hero; });
    if (!rest.length) return [{ id: hero.id, x: content.x, y: content.y, w: content.w, h: content.h }];
    var hr, rr;
    if (content.w <= content.h) {
      var hh = (content.h - GAP) * 0.6;
      hr = { x: content.x, y: content.y, w: content.w, h: hh };
      rr = { x: content.x, y: content.y + hh + GAP, w: content.w, h: content.h - hh - GAP };
    } else {
      var hw = (content.w - GAP) * 0.58;
      hr = { x: content.x, y: content.y, w: hw, h: content.h };
      rr = { x: content.x + hw + GAP, y: content.y, w: content.w - hw - GAP, h: content.h };
    }
    return [{ id: hero.id, x: hr.x, y: hr.y, w: hr.w, h: hr.h }].concat(fitGrid(rest, rr, GAP));
  }

  // mode: 'even' | 'hero' | 'gallery'。items: [{id, ar}] (ar = 幅/高さ)
  function compute(mode, items, W, H, headerH, heroId) {
    var content = { x: MARGIN, y: MARGIN + headerH, w: W - 2 * MARGIN, h: H - 2 * MARGIN - headerH };
    var cells = [], pad = 3;
    if (items.length) {
      if (mode === 'hero') cells = heroLayout(items, content, heroId);
      else if (mode === 'gallery') { cells = justified(items, content, GAP_G); pad = 0.6; }
      else cells = fitGrid(items, content, GAP);
    }
    cells.forEach(function (c) { c.pad = pad; });
    return { content: content, cells: cells };
  }

  // セル内に縦横比を保って収まる描画矩形
  function place(cell, ar) {
    var p = cell.pad || 0;
    var aw = Math.max(0.1, cell.w - 2 * p), ah = Math.max(0.1, cell.h - 2 * p);
    var w, h;
    if (aw / ah > ar) { h = ah; w = h * ar; } else { w = aw; h = w / ar; }
    return { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w: w, h: h };
  }

  var api = { MARGIN: MARGIN, compute: compute, place: place };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layout = api;
})(typeof window !== 'undefined' ? window : this);
