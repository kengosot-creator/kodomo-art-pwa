(function () {
  'use strict';
  const L = window.Layout;
  const MAX_WORKS = 30;
  const PREVIEW_MAX = 1200; // プレビュー用に縮小して保持する長辺(px)。元ファイルはPNG保存時に1枚ずつ読み直す
  const FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","BIZ UDPGothic","Yu Gothic UI","Yu Gothic","Meiryo","Noto Sans JP",sans-serif';
  const $ = (id) => document.getElementById(id);
  const state = { works: [], child: null, heroId: null, mode: 'even', orient: 'portrait' };
  let uid = 0, raf = 0, busy = false;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  /* ---------- メッセージ ---------- */
  function say(lines, isErr) {
    const box = $('msg');
    box.textContent = '';
    box.className = 'msg' + (isErr ? ' err' : '');
    (Array.isArray(lines) ? lines : [lines]).forEach((t) => {
      if (!t) return;
      const p = document.createElement('p');
      p.textContent = t;
      box.appendChild(p);
    });
  }

  /* ---------- 画像の読み込み（すべてブラウザ内） ---------- */
  async function decode(file) {
    if (window.createImageBitmap) {
      let b = null;
      try { b = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { try { b = await createImageBitmap(file); } catch (e2) { b = null; } }
      if (b) return { src: b, w: b.width, h: b.height, done: () => { if (b.close) b.close(); } };
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
    } catch (e) { URL.revokeObjectURL(url); throw e; }
  }

  function resample(src, sw, sh, tw, th) {
    let cur = src, cw = sw, ch = sh;
    while (cw / 2 >= tw && ch / 2 >= th) { // 段階的に半分にして画質を保つ
      const nw = Math.ceil(cw / 2), nh = Math.ceil(ch / 2);
      const c = mk(nw, nh), x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, nw, nh);
      cur = c; cw = nw; ch = nh;
    }
    const out = mk(tw, th), x = out.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, tw, th);
    return out;
  }

  async function makeItem(file, kind) {
    const d = await decode(file);
    try {
      if (!d.w || !d.h) throw new Error('size');
      const s = Math.min(1, PREVIEW_MAX / Math.max(d.w, d.h));
      const small = resample(d.src, d.w, d.h, Math.max(1, Math.round(d.w * s)), Math.max(1, Math.round(d.h * s)));
      const ts = 160 / Math.max(d.w, d.h);
      const tc = resample(small, small.width, small.height, Math.max(1, Math.round(d.w * ts)), Math.max(1, Math.round(d.h * ts)));
      return { id: 'i' + (++uid), kind, name: file.name, file, ar: d.w / d.h, small, thumb: tc.toDataURL('image/jpeg', 0.7) };
    } finally { d.done(); }
  }

  const looksImage = (f) => (f.type && f.type.indexOf('image/') === 0) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);

  async function addFiles(list, kind) {
    const files = Array.from(list || []);
    if (!files.length || busy) return;
    const errs = [];
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      say('読み込み中… ' + (i + 1) + '/' + files.length);
      if (kind === 'work' && state.works.length >= MAX_WORKS) {
        errs.push('作品は最大' + MAX_WORKS + '枚までです。超えた分は追加していません。');
        break;
      }
      if (!looksImage(f)) {
        errs.push('「' + f.name + '」は画像ファイルではないため追加できませんでした。JPG・PNG・WebPなどの画像を選んでください。');
        continue;
      }
      try {
        const it = await makeItem(f, kind);
        if (kind === 'child') state.child = it;
        else { state.works.push(it); if (!state.heroId) state.heroId = it.id; }
        added++;
        refresh();
      } catch (e) {
        errs.push('「' + f.name + '」を読み込めませんでした。ブラウザが対応していない形式（HEICなど）か、ファイルが壊れている可能性があります。JPGまたはPNGに変換して、もう一度お試しください。');
      }
      await tick();
    }
    if (errs.length) say(errs, true);
    else say(added ? added + '枚を追加しました。' : '');
  }

  function removeItem(id) {
    if (state.child && state.child.id === id) state.child = null;
    state.works = state.works.filter((w) => w.id !== id);
    if (state.heroId === id || !state.works.some((w) => w.id === state.heroId)) state.heroId = state.works.length ? state.works[0].id : null;
    say('');
    refresh();
  }

  /* ---------- 用紙・レイアウト・描画（プレビューとPNGで共通） ---------- */
  const pageMM = () => (state.orient === 'portrait' ? { w: 210, h: 297 } : { w: 297, h: 210 });
  const fmtMonth = (v) => { const m = /^(\d{4})-(\d{1,2})$/.exec(v || ''); return m ? m[1] + '年' + Number(m[2]) + '月' : (v || '').trim(); };
  const texts = () => {
    const title = $('title').value.trim();
    const sub = [$('name').value.trim(), fmtMonth($('month').value)].filter(Boolean).join('　　');
    return { title, sub };
  };
  const headerH = () => { const t = texts(); return t.title && t.sub ? 26 : t.title ? 18 : t.sub ? 14 : 0; };
  const allItems = () => (state.child ? [state.child] : []).concat(state.works);
  const itemMap = () => { const m = new Map(); allItems().forEach((i) => m.set(i.id, i)); return m; };
  const currentLayout = () => {
    const p = pageMM();
    return L.compute(state.mode, allItems().map((i) => ({ id: i.id, ar: i.ar })), p.w, p.h, headerH(), state.heroId);
  };

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fitFont(ctx, text, maxW, size, weight) {
    while (size > 3) {
      ctx.font = weight + ' ' + size + 'px ' + FONT;
      if (ctx.measureText(text).width <= maxW) break;
      size -= 0.5;
    }
  }

  // ctx は mm 単位で描く。k = 1mmあたりのpx数。getSrc(item) で描画元を返す
  function drawPage(ctx, Wm, Hm, k, getSrc, showEmpty) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, Wm * k, Hm * k);
    ctx.scale(k, k);
    ctx.imageSmoothingQuality = 'high';
    const t = texts(), M = L.MARGIN, maxW = Wm - 2 * M;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (t.title) {
      ctx.fillStyle = '#27352E';
      fitFont(ctx, t.title, maxW, 11, '700');
      ctx.fillText(t.title, Wm / 2, M + (t.sub ? 10 : 11), maxW);
    }
    if (t.sub) {
      ctx.fillStyle = '#5B6B61';
      fitFont(ctx, t.sub, maxW, t.title ? 4.8 : 6, '400');
      ctx.fillText(t.sub, Wm / 2, M + (t.title ? 18.5 : 7.5), maxW);
    }
    const lay = currentLayout(), items = itemMap();
    if (!lay.cells.length && showEmpty) {
      const c = lay.content;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#B9C3B7';
      ctx.lineWidth = 0.4;
      rr(ctx, c.x, c.y, c.w, c.h, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7C8A80';
      fitFont(ctx, '写真を選ぶと、ここに作品が並びます', c.w - 10, 6, '400');
      ctx.fillText('写真を選ぶと、ここに作品が並びます', Wm / 2, c.y + c.h / 2, c.w - 10);
    }
    lay.cells.forEach((c) => {
      const it = items.get(c.id), src = it && getSrc(it);
      if (!src) return;
      const r = L.place(c, it.ar), child = it.kind === 'child', rad = child ? 3 : 0;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = 1.6 * k;
      ctx.shadowOffsetY = 0.5 * k;
      ctx.fillStyle = '#fff';
      rr(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.fill();
      ctx.restore();
      ctx.save();
      rr(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.clip();
      ctx.drawImage(src, r.x, r.y, r.w, r.h);
      ctx.restore();
      const bw = child ? 1.4 : 0.25;
      ctx.save();
      ctx.lineWidth = bw;
      ctx.strokeStyle = child ? '#F4B400' : '#CFCFCF';
      rr(ctx, r.x + bw / 2, r.y + bw / 2, r.w - bw, r.h - bw, Math.max(0, rad - bw / 2));
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  function renderPreview() {
    raf = 0;
    const cv = $('preview'), p = pageMM();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(200, Math.round((cv.clientWidth || 600) * dpr)), ph = Math.round(pw * p.h / p.w);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    drawPage(cv.getContext('2d'), p.w, p.h, pw / p.w, (it) => it.small, true);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(renderPreview); };

  /* ---------- PNG保存・印刷 ---------- */
  async function renderCanvas() {
    const p = pageMM(), k = 300 / 25.4; // 300dpi相当
    const lay = currentLayout(), items = itemMap(), srcs = new Map();
    for (let i = 0; i < lay.cells.length; i++) {
      say('画像を作成中… ' + (i + 1) + '/' + lay.cells.length);
      const c = lay.cells[i], it = items.get(c.id), r = L.place(c, it.ar);
      const d = await decode(it.file); // 元ファイルを1枚ずつ読み直し、使うサイズへ縮小（メモリ節約）
      try {
        srcs.set(c.id, resample(d.src, d.w, d.h, Math.max(1, Math.round(r.w * k)), Math.max(1, Math.round(r.h * k))));
      } finally { d.done(); }
      await tick();
    }
    const cv = mk(Math.round(p.w * k), Math.round(p.h * k));
    drawPage(cv.getContext('2d'), p.w, p.h, cv.width / p.w, (it) => srcs.get(it.id), false);
    return cv;
  }

  const fileBase = () => {
    const t = $('title').value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 60) || '作品集';
    return t + '_' + (state.orient === 'portrait' ? 'A4縦' : 'A4横');
  };

  async function withBusy(fn) {
    if (busy || !allItems().length) return;
    busy = true; syncButtons();
    try { await fn(); }
    catch (e) { say('画像の作成に失敗しました。写真の枚数を減らすか、別のブラウザでもう一度お試しください。（' + (e && e.message ? e.message : '不明なエラー') + '）', true); }
    finally { busy = false; syncButtons(); }
  }

  const savePng = () => withBusy(async () => {
    const cv = await renderCanvas();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('メモリ不足の可能性があります');
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fileBase() + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    say('PNGを保存しました（' + cv.width + '×' + cv.height + 'px）。ダウンロード先をご確認ください。');
  });

  let printUrl = '';
  const doPrint = () => withBusy(async () => {
    const cv = await renderCanvas();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('メモリ不足の可能性があります');
    if (printUrl) URL.revokeObjectURL(printUrl);
    printUrl = URL.createObjectURL(blob);
    const p = pageMM(), img = $('printImg');
    $('pageStyle').textContent = '@page{size:A4 ' + (state.orient === 'portrait' ? 'portrait' : 'landscape') + ';margin:0}';
    img.style.width = p.w + 'mm'; img.style.height = (p.h - 0.5) + 'mm';
    img.src = printUrl;
    await img.decode();
    say('印刷画面を開きます。倍率は「100%（実際のサイズ）」、ヘッダーとフッターは「オフ」にしてください。');
    window.print();
  });
  window.addEventListener('afterprint', () => {
    const img = $('printImg');
    img.removeAttribute('src');
    if (printUrl) { URL.revokeObjectURL(printUrl); printUrl = ''; }
  });

  /* ---------- 画面の更新 ---------- */
  function thumbLi(it, hero) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = it.thumb; img.alt = '';
    li.appendChild(img);
    const row = document.createElement('div');
    row.className = 'trow';
    if (hero) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mini' + (state.heroId === it.id ? ' on' : '');
      b.dataset.act = 'hero'; b.dataset.id = it.id;
      b.setAttribute('aria-pressed', state.heroId === it.id ? 'true' : 'false');
      b.textContent = state.heroId === it.id ? '主役' : '主役にする';
      row.appendChild(b);
    }
    const d = document.createElement('button');
    d.type = 'button'; d.className = 'mini'; d.dataset.act = 'del'; d.dataset.id = it.id;
    d.textContent = '削除';
    d.setAttribute('aria-label', '「' + it.name + '」を削除');
    row.appendChild(d);
    li.appendChild(row);
    return li;
  }

  function syncButtons() {
    const none = !allItems().length;
    $('save').disabled = none || busy;
    $('print').disabled = none || busy;
    $('clear').disabled = none || busy;
  }

  function refresh() {
    const wl = $('workList'), cl = $('childList');
    wl.textContent = ''; cl.textContent = '';
    state.works.forEach((w) => wl.appendChild(thumbLi(w, true)));
    if (state.child) cl.appendChild(thumbLi(state.child, false));
    $('workCount').textContent = state.works.length ? '（' + state.works.length + '枚）' : '';
    $('childLabel').textContent = state.child ? '写真を変える' : '子どもの写真を選ぶ';
    $('heroHint').hidden = state.mode !== 'hero';
    syncButtons();
    schedule();
  }

  function applyOrient() {
    $('sheet').style.setProperty('--ar', state.orient === 'portrait' ? String(210 / 297) : String(297 / 210));
    schedule();
  }

  /* ---------- 初期化 ---------- */
  function init() {
    const now = new Date();
    $('month').value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    $('workInput').addEventListener('change', (e) => { addFiles(e.target.files, 'work'); e.target.value = ''; });
    $('childInput').addEventListener('change', (e) => { addFiles(e.target.files, 'child'); e.target.value = ''; });
    ['title', 'name', 'month'].forEach((id) => $(id).addEventListener('input', schedule));
    document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { state.mode = r.value; refresh(); }));
    document.querySelectorAll('input[name=orient]').forEach((r) => r.addEventListener('change', () => { state.orient = r.value; applyOrient(); }));
    document.querySelector('.controls').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'del') removeItem(b.dataset.id);
      else if (b.dataset.act === 'hero') { state.heroId = b.dataset.id; refresh(); }
    });
    $('clear').addEventListener('click', () => { state.works = []; state.child = null; state.heroId = null; say(''); refresh(); });
    $('save').addEventListener('click', savePng);
    $('print').addEventListener('click', doPrint);
    if (window.ResizeObserver) new ResizeObserver(schedule).observe($('preview'));
    else window.addEventListener('resize', schedule);
    applyOrient();
    refresh();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  init();
})();
