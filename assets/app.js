/* akltraffic — Auckland traffic cameras (personal, free). Data: NZTA Waka Kotahi Traffic and Travel API via the akl-traffic-proxy Worker; roadworks: Auckland Transport Open GIS (CC BY 4.0). */
(function () {
  'use strict';
  var PROD_API = 'https://akl-traffic-proxy.ytonywong.workers.dev';
  var API = PROD_API;
  try { var qa = new URLSearchParams(location.search).get('api'); if (qa && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /^http:\/\/127\.0\.0\.1:\d+$/.test(qa)) API = qa; } catch (e) {}
  var HW_ORDER = ['SH1', 'SH16', 'SH18', 'SH20', 'SH20A', 'SH20B'];
  var REFRESH_MS = 60000, OLD_IMG_MIN = 5, NEAR_N = 10, RW_PAGE = 40;
  var LS = { lang: 'akltraffic.lang', font: 'akltraffic.font', favs: 'akltraffic.favs' };
  var FONT_LEVELS = [0.875, 1, 1.125, 1.25, 1.4, 1.6];
  var S = { lang: 'zh-Hant', font: 1, favs: [], cams: [], camsAt: null, filter: 'all', q: '', pos: null, view: 'cams',
    events: null, journeys: null, roadworks: null, rwShown: RW_PAGE, imgState: {}, visible: new Set(), map: null, layers: {} };
  window.AKLT = S; // for tests / debugging

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function T(k, vars) { var d = I18N[S.lang] || I18N.en; var s = d[k] != null ? d[k] : (I18N.en[k] != null ? I18N.en[k] : k);
    if (vars) for (var v in vars) s = s.split('{' + v + '}').join(vars[v]); return s; }
  function lsGet(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function langInfo() { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === S.lang) return LANGS[i]; return LANGS[0]; }
  function fmtTime(d, withDate) { if (!d || isNaN(d)) return '—';
    var o = { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }; if (withDate) { o.month = 'short'; o.day = 'numeric'; o.weekday = 'short'; } else o.second = '2-digit';
    try { return new Intl.DateTimeFormat(langInfo().locale, o).format(d); } catch (e) { return d.toISOString(); } }
  function ago(d) { var s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 90) return T('secAgo', { n: s }); if (s < 5400) return T('minAgo', { n: Math.round(s / 60) }); return T('hrAgo', { n: Math.round(s / 3600) }); }
  function dirT(d) { return T('dir_' + d) === 'dir_' + d ? d : T('dir_' + d); }
  function keyOf(s) { return String(s || '').replace(/[^A-Za-z]/g, ''); }
  function haversine(a, b, c, d) { var R = 6371, toR = Math.PI / 180, x = (c - a) * toR, y = (d - b) * toR;
    var h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(y / 2) * Math.sin(y / 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  function getJSON(path) {
    var ctl = new AbortController(); var t = setTimeout(function () { ctl.abort(); }, 45000);
    return fetch(API + path, { signal: ctl.signal, cache: 'no-store' }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status);
      var stale = r.headers.get('X-Stale') === '1';
      return r.json().then(function (j) { j._stale = stale; return j; });
    }, function (e) { clearTimeout(t); throw e; });
  }
  function dataLine(el, j) { var d = new Date(j.fetchedAt); el.classList.toggle('err', !!j._stale);
    return j._stale ? T('staleData', { t: fmtTime(d, true) }) : T('dataTime', { t: fmtTime(d, true) + ' (' + T('nzTime') + ')' }); }

  // ---------- i18n / font ----------
  function applyLang() {
    document.documentElement.lang = langInfo().html;
    document.title = T('appTitle') + ' · Auckland Traffic Cameras';
    document.querySelectorAll('[data-i]').forEach(function (el) { el.textContent = T(el.getAttribute('data-i')); });
    document.querySelectorAll('[data-ia]').forEach(function (el) { var v = T(el.getAttribute('data-ia')); el.setAttribute('aria-label', v); el.title = v; });
    document.querySelectorAll('[data-iph]').forEach(function (el) { el.placeholder = T(el.getAttribute('data-iph')); });
    $('fontGroup').setAttribute('aria-label', T('fontGroup')); $('lang').setAttribute('aria-label', T('langLabel'));
    renderChips(); renderCams(); renderEvents(); renderTraffic(); renderRoadworks(); renderLegends(); if (S.map) refreshMapLayers();
  }
  function applyFont() {
    document.documentElement.style.fontSize = (16 * FONT_LEVELS[S.font]) + 'px';
    $('fMinus').disabled = S.font === 0; $('fPlus').disabled = S.font === FONT_LEVELS.length - 1;
    $('fReset').setAttribute('aria-pressed', String(S.font === 1));
    if (S.map) setTimeout(function () { S.map.invalidateSize(); }, 50);
  }

  // ---------- tabs ----------
  function showView(v) {
    S.view = v;
    document.querySelectorAll('#tabs [role=tab]').forEach(function (b) { var on = b.getAttribute('data-view') === v; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('main .view').forEach(function (s) { s.hidden = s.id !== 'v-' + v; });
    window.scrollTo(0, 0);
    if (v === 'map') { initMap(); setTimeout(function () { S.map.invalidateSize(); }, 30); }
    if (v === 'rw' && !S.roadworks) loadRoadworks();
    if (v === 'traffic' && !S.journeys) loadJourneys();
    if (v === 'events' && !S.events) loadEvents();
    try { history.replaceState(null, '', '#' + v); } catch (e) {}
  }

  // ---------- favourites ----------
  function isFav(id) { return S.favs.indexOf(id) >= 0; }
  function toggleFav(id) { if (isFav(id)) S.favs = S.favs.filter(function (x) { return x !== id; }); else S.favs.push(id); lsSet(LS.favs, S.favs);
    document.querySelectorAll('[data-fav="' + id + '"]').forEach(function (b) { favBtnState(b, id); });
    if (S.filter === 'fav') renderCams(); renderChips(); }
  function favBtnState(b, id) { var on = isFav(id); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? T('removeFav') : T('addFav'); }

  // ---------- cameras ----------
  function camById(id) { for (var i = 0; i < S.cams.length; i++) if (S.cams[i].id === id) return S.cams[i]; return null; }
  function renderChips() {
    var c = $('chips'); var items = [['all', T('fAll')], ['fav', T('fFav') + (S.favs.length ? ' (' + S.favs.length + ')' : '')], ['near', T('fNear')]];
    HW_ORDER.forEach(function (h) { items.push([h, h]); });
    c.setAttribute('aria-label', T('searchLabel'));
    c.innerHTML = items.map(function (it) { return '<button type="button" class="chip" data-f="' + it[0] + '" aria-pressed="' + (S.filter === it[0]) + '">' + esc(it[1]) + '</button>'; }).join('');
  }
  function matchQ(cam) { if (!S.q) return true; var q = S.q.toLowerCase();
    return (cam.name + ' ' + cam.description + ' ' + cam.highway + ' ' + cam.direction + ' ' + dirT(cam.direction) + ' ' + cam.id).toLowerCase().indexOf(q) >= 0; }
  function sortHw(list, h) { return list.slice().sort(function (a, b) { return (h === 'SH1' || h === 'SH18') ? b.lat - a.lat : a.lon - b.lon; }); }
  function camCard(cam, dist) {
    var tags = (cam.offline ? '<span class="tag off">' + esc(T('offline')) + '</span>' : '') + (cam.underMaintenance ? '<span class="tag off">' + esc(T('maintenance')) + '</span>' : '');
    return '<article class="cam" data-id="' + cam.id + '">' +
      '<h3><span class="hw" aria-hidden="true">' + esc(cam.highway) + '</span>' + esc(cam.name) + '</h3>' +
      '<div class="meta">' + esc(dirT(cam.direction)) + ' · ' + esc(cam.description) + (dist != null ? ' · <span class="dist">' + esc(T('kmAway', { d: dist.toFixed(1) })) + '</span>' : '') + ' ' + tags + '</div>' +
      '<figure class="camimg" data-cam="' + cam.id + '"><span>' + esc(T('loadingImg')) + '</span></figure>' +
      '<p class="ts" data-ts="' + cam.id + '"></p>' +
      '<div class="actions"><button type="button" class="btn" data-fav="' + cam.id + '" aria-pressed="' + isFav(cam.id) + '" aria-label="' + esc(T('favAria', { name: cam.name })) + '">' + esc(isFav(cam.id) ? T('removeFav') : T('addFav')) + '</button>' +
      '<button type="button" class="btn" data-onmap="' + cam.id + '">' + esc(T('showOnMap')) + '</button></div></article>';
  }
  function renderCams() {
    var el = $('camList'); if (!el) return; var st = $('camStatus');
    if (!S.cams.length) { st.textContent = S.camErr ? T('loadError') : T('loading'); st.classList.toggle('err', !!S.camErr); el.innerHTML = ''; return; }
    var list = S.cams.filter(matchQ), html = '';
    $('nearNote').hidden = S.filter !== 'near';
    if (S.filter === 'near') {
      $('nearNote').textContent = T('privacyLoc') + (S.locMsg ? ' — ' + S.locMsg : '');
      if (S.pos) { var withD = list.map(function (c) { return [c, haversine(S.pos.lat, S.pos.lon, c.lat, c.lon)]; }).sort(function (a, b) { return a[1] - b[1]; }).slice(0, NEAR_N);
        html = '<section class="group near"><h2>' + esc(T('nearTitle')) + '</h2><div class="grid">' + withD.map(function (x) { return camCard(x[0], x[1]); }).join('') + '</div></section>'; }
    } else if (S.filter === 'fav') {
      var favs = S.favs.map(camById).filter(function (c) { return c && matchQ(c); });
      html = '<section class="group fav"><h2>' + esc(T('favTitle')) + '</h2>' + (favs.length ? '<div class="grid">' + favs.map(function (c) { return camCard(c); }).join('') + '</div>' : '<p class="note">' + esc(T('noFavs')) + '</p>') + '</section>';
    } else {
      HW_ORDER.concat(S.cams.map(function (c) { return c.highway; }).filter(function (h, i, a) { return HW_ORDER.indexOf(h) < 0 && a.indexOf(h) === i; })).forEach(function (h) {
        if (S.filter !== 'all' && S.filter !== h) return;
        var g = sortHw(list.filter(function (c) { return c.highway === h; }), h); if (!g.length) return;
        html += '<details class="group" open data-hw="' + esc(h) + '"><summary><span><span class="hw">' + esc(h) + '</span>' + esc(T('groupCount', { n: g.length })) + '</span></summary><div class="grid">' + g.map(function (c) { return camCard(c); }).join('') + '</div></details>';
      });
      if (!html) html = '<p class="note">' + esc(T('noResults')) + '</p>';
    }
    var shown = (html.match(/class="cam"/g) || []).length;
    st.classList.toggle('err', false);
    st.textContent = T('camCount', { n: shown }) + (shown !== S.cams.length ? ' / ' + S.cams.length : '') + ' · ' + T('autoRefresh');
    el.innerHTML = html; observeCards();
  }
  function loadCams() {
    return getJSON('/cameras').then(function (j) { S.cams = j.cameras || []; S.camsAt = j.fetchedAt; S.camErr = false; renderCams(); if (S.map) refreshMapLayers(); },
      function () { S.camErr = true; renderCams(); setTimeout(loadCams, 30000); });
  }

  // ---------- camera images: unchanged bytes, timestamp from NZTA Last-Modified, refresh 60 s while visible ----------
  var queue = [], running = 0;
  function enqueue(id) { if (queue.indexOf(id) < 0) queue.push(id); pump(); }
  function pump() { while (running < 4 && queue.length) { running++; fetchImg(queue.shift()).then(done, done); } function done() { running--; pump(); } }
  function fetchImg(id) {
    var st = S.imgState[id] || (S.imgState[id] = {}); st.loading = true;
    return fetch(API + '/cam/' + id + '.jpg', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var lm = r.headers.get('X-Image-Time') || r.headers.get('Last-Modified');
      return r.blob().then(function (b) {
        if (st.url) URL.revokeObjectURL(st.url);
        st.url = URL.createObjectURL(b); st.time = lm ? new Date(lm) : null; st.at = Date.now(); st.err = false; st.loading = false; paintImg(id);
      });
    }).catch(function () { st.err = true; st.at = Date.now(); st.loading = false;
      // never keep showing an old picture as if it were current: drop it once it is more than 3 minutes old
      if (st.url && st.time && Date.now() - st.time.getTime() > 180000) { URL.revokeObjectURL(st.url); st.url = null; document.querySelectorAll('[data-cam="' + id + '"]').forEach(function (f) { f.innerHTML = ''; }); }
      paintImg(id); });
  }
  function paintImg(id) {
    var st = S.imgState[id] || {}; var cam = camById(id) || { name: '', direction: '' };
    document.querySelectorAll('[data-cam="' + id + '"]').forEach(function (fig) {
      if (st.url && !st.err) { var img = fig.querySelector('img');
        if (!img) { fig.innerHTML = ''; img = document.createElement('img'); img.decoding = 'async'; fig.appendChild(img); }
        img.alt = T('imgAlt', { name: cam.name, dir: dirT(cam.direction) }); if (img.src !== st.url) img.src = st.url; }
      else if (st.err && !fig.querySelector('img')) fig.innerHTML = '<span>' + esc(T('imgError')) + '</span>';
    });
    paintTs(id);
  }
  function paintTs(id) {
    var st = S.imgState[id] || {};
    document.querySelectorAll('[data-ts="' + id + '"]').forEach(function (p) {
      if (st.err && !st.time) { p.textContent = T('imgError'); p.classList.add('old'); return; }
      if (!st.time) { p.textContent = ''; return; }
      var oldMin = (Date.now() - st.time.getTime()) / 60000;
      p.textContent = T('imageTime') + ': ' + fmtTime(st.time) + ' (' + T('nzTime') + ') · ' + ago(st.time) + (oldMin > OLD_IMG_MIN ? ' — ' + T('imgOld', { n: Math.round(oldMin) }) : '') + (st.err ? ' — ' + T('imgError') : '');
      p.classList.toggle('old', oldMin > OLD_IMG_MIN || !!st.err);
    });
  }
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (ents) {
    ents.forEach(function (e) { var id = +e.target.getAttribute('data-cam');
      if (e.isIntersecting) { S.visible.add(e.target); maybeLoad(id); } else S.visible.delete(e.target); });
  }, { rootMargin: '200px 0px' }) : null;
  function observeCards() {
    S.visible.forEach(function (el) { if (!document.body.contains(el)) S.visible.delete(el); });
    document.querySelectorAll('#camList [data-cam]').forEach(function (f) { var id = +f.getAttribute('data-cam'); if (S.imgState[id] && S.imgState[id].url) paintImg(id); if (io) io.observe(f); else maybeLoad(id); });
  }
  function maybeLoad(id) { var st = S.imgState[id]; if (document.hidden) return; if (!st || (!st.loading && Date.now() - (st.at || 0) > REFRESH_MS - 3000)) enqueue(id); }
  function refreshVisible() {
    if (document.hidden) return;
    var ids = {}; S.visible.forEach(function (el) { if (document.body.contains(el) && !el.closest('[hidden]')) ids[el.getAttribute('data-cam')] = 1; });
    if (S.popupCam) ids[S.popupCam] = 1;
    Object.keys(ids).forEach(function (id) { maybeLoad(+id); });
  }
  setInterval(refreshVisible, 5000);   // checks every 5 s; each image is re-fetched only when it is ~60 s old
  setInterval(function () { Object.keys(S.imgState).forEach(function (id) { paintTs(+id); }); }, 5000);
  document.addEventListener('visibilitychange', function () { var st = $('camStatus'); if (document.hidden) { S.paused = true; } else { S.paused = false; refreshVisible(); } });

  // ---------- nearby (on-device only; never stored, never sent) ----------
  function locate() {
    S.locMsg = T('locating'); renderCams();
    if (!navigator.geolocation) { S.locMsg = T('locUnsupported'); renderCams(); return; }
    navigator.geolocation.getCurrentPosition(function (p) { S.pos = { lat: p.coords.latitude, lon: p.coords.longitude }; S.locMsg = ''; renderCams(); if (S.view === 'rw') renderRoadworks(); if (S.map) showMeOnMap(); },
      function (e) { S.locMsg = e && e.code === 1 ? T('locDenied') : T('locFail'); renderCams(); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  }

  // ---------- events (NZTA, active only) ----------
  function evClass(e) { return /closed/i.test(e.impact) ? 'closed' : 'other'; }
  function evType(e) { var k = 'et_' + keyOf(e.type); var v = T(k); return v === k ? e.type : v; }
  function evImpact(e) { var k = 'im_' + keyOf(e.impact); var v = T(k); return v === k ? e.impact : v; }
  function evPoint(e) { var g = e.geometry; if (!g || !g.coords || !g.coords[0] || !g.coords[0][0]) return null; var l = g.coords[0]; return l[Math.floor(l.length / 2)]; }
  function renderEvents() {
    var el = $('evList'), st = $('evStatus'); if (!el) return;
    var b = $('evBadge'); if (S.events) { b.hidden = false; b.textContent = S.events.events.length; }
    if (!S.events) { st.textContent = S.evErr ? T('loadError') : T('loading'); st.classList.toggle('err', !!S.evErr); return; }
    var evs = S.events.events.slice().sort(function (a, b) { return (evClass(a) === 'closed' ? 0 : 1) - (evClass(b) === 'closed' ? 0 : 1) || new Date(a.start) - new Date(b.start); });
    st.textContent = T('eventsCount', { n: evs.length }) + ' · ' + dataLine(st, S.events);
    if (!evs.length) { el.innerHTML = '<p class="note">' + esc(T('noEvents')) + '</p>'; return; }
    el.innerHTML = evs.map(function (e) {
      var s = e.start ? new Date(e.start) : null, en = e.end ? new Date(e.end) : null, later = s && s > new Date();
      return '<article class="ev ' + evClass(e) + '" data-ev="' + esc(e.id) + '"><h3>' + (e.highway ? '<span class="hw">' + esc(e.highway) + '</span>' : '') + esc(e.location) + '</h3>' +
        '<div><span class="pill ' + (evClass(e) === 'closed' ? 'closed' : '') + '">' + esc(evImpact(e)) + '</span><span class="pill plan">' + esc(evType(e)) + '</span><span class="tag">' + esc(e.planned ? T('evPlanned') : T('evUnplanned')) + '</span></div>' +
        (later ? '<p class="kv"><b>' + esc(T('evStartsLater', { t: fmtTime(s, true) })) + '</b></p>' : '') +
        '<p class="kv">' + esc(T('evStart')) + ': ' + esc(fmtTime(s, true)) + ' · ' + esc(T('evEnd')) + ': ' + esc(en ? fmtTime(en, true) : (e.expectedResolution || '—')) + '</p>' +
        '<div class="orig" lang="en"><span class="sr">' + esc(T('evOfficial')) + ': </span>' + esc(e.description) + (e.comments ? ' — ' + esc(e.comments) : '') + (e.alternativeRoute ? '<br><b>' + esc(T('evAlt')) + ':</b> ' + esc(e.alternativeRoute) : '') + (e.near && e.near.length ? '<br>' + esc(e.near.join(' · ')) : '') + '</div>' +
        (evPoint(e) ? '<button type="button" class="btn" data-evmap="' + esc(e.id) + '">' + esc(T('showOnMap')) + '</button>' : '') + '</article>';
    }).join('');
  }
  function loadEvents() { return getJSON('/events').then(function (j) { S.events = j; S.evErr = false; renderEvents(); if (S.map) refreshMapLayers(); }, function () { S.evErr = true; renderEvents(); }); }

  // ---------- congestion (NZTA journeys) ----------
  function cong(r) { return r >= 0.8 ? 'free' : r >= 0.5 ? 'slow' : 'heavy'; }
  var CCOL = { free: '#1b7f3b', slow: '#b26a00', heavy: '#b3261e' };
  function renderLegends() {
    var l = '<span><span class="sw" style="background:' + CCOL.free + '"></span>' + esc(T('lgFree')) + '</span><span><span class="sw" style="background:' + CCOL.slow + '"></span>' + esc(T('lgSlow')) + '</span><span><span class="sw" style="background:' + CCOL.heavy + '"></span>' + esc(T('lgHeavy')) + '</span>';
    $('trLegend').innerHTML = l;
    $('mapLegend').innerHTML = '<span><span class="dot" style="background:#0b5d7a"></span>' + esc(T('layerCameras')) + '</span><span><span class="dot" style="background:#b3261e"></span>' + esc(T('layerEvents')) + '</span>' + l + '<span><span class="dot" style="background:#6d4c41"></span>' + esc(T('layerRoadworks')) + '</span>';
  }
  function renderTraffic() {
    var el = $('trList'), st = $('trStatus'); if (!el) return;
    if (!S.journeys) { st.textContent = S.trErr ? T('loadError') : T('loading'); st.classList.toggle('err', !!S.trErr); return; }
    var legs = S.journeys.legs; st.textContent = T('trafficCount', { n: legs.length }) + ' · ' + dataLine(st, S.journeys);
    if (!legs.length) { el.innerHTML = '<p class="note">' + esc(T('noTraffic')) + '</p>'; return; }
    var by = {}; legs.forEach(function (l) { (by[l.journey] = by[l.journey] || []).push(l); });
    el.innerHTML = Object.keys(by).sort(function (a, b) { return (HW_ORDER.indexOf(a) + 99) % 99 - (HW_ORDER.indexOf(b) + 99) % 99 || a.localeCompare(b); }).map(function (j) {
      var ls = by[j].slice().sort(function (a, b) { return a.ratio - b.ratio; });
      return '<div class="jhead"><span class="hw">' + esc(j) + '</span>' + esc(T('groupCount', { n: ls.length })) + '</div>' + ls.map(function (l) {
        var c = cong(l.ratio);
        return '<div class="leg" data-cong="' + c + '"><span class="bar" style="background:' + CCOL[c] + '"></span><span class="nm">' + esc(l.name) + ' <span class="pill ' + c + '">' + esc(T(c === 'free' ? 'lgFree' : c === 'slow' ? 'lgSlow' : 'lgHeavy')) + '</span></span>' +
          '<span class="sp">' + (l.heading ? esc(dirT(l.heading)) + ' · ' : '') + esc(T('speedOf', { s: l.speed, l: l.limit })) + ' · ' + l.lengthKm + ' km</span></div>';
      }).join('');
    }).join('');
  }
  function loadJourneys() { return getJSON('/journeys').then(function (j) { S.journeys = j; S.trErr = false; renderTraffic(); if (S.map) refreshMapLayers(); }, function () { S.trErr = true; renderTraffic(); }); }

  // ---------- AT roadworks ----------
  function rwType(t) { var k = 'rt_' + keyOf(t); var v = T(k); return v === k ? t : v; }
  function renderRoadworks() {
    var el = $('rwList'), st = $('rwStatus'), more = $('rwMore'); if (!el) return;
    if (!S.roadworks) { st.textContent = S.rwErr ? T('loadError') : T('loading'); st.classList.toggle('err', !!S.rwErr); return; }
    var q = ($('rq').value || '').toLowerCase().trim();
    var list = S.roadworks.roadworks.filter(function (r) { return !q || (r.name + ' ' + r.org + ' ' + r.code + ' ' + r.type).toLowerCase().indexOf(q) >= 0; });
    if (S.pos) list = list.map(function (r) { r._d = haversine(S.pos.lat, S.pos.lon, r.lat, r.lon); return r; }).sort(function (a, b) { return a._d - b._d; });
    else list = list.slice().sort(function (a, b) { return (b.start || 0) - (a.start || 0); });
    st.textContent = T('rwCount', { n: list.length }) + (S.pos ? ' · ' + T('rwSort') : '') + ' · ' + dataLine(st, S.roadworks);
    el.innerHTML = list.slice(0, S.rwShown).map(function (r) {
      return '<article class="rw"><h3>' + esc(r.name) + '</h3><p class="kv"><span class="pill" style="background:#6d4c41">' + esc(rwType(r.type)) + '</span>' + (S.pos ? '<span class="dist">' + esc(T('kmAway', { d: r._d.toFixed(1) })) + '</span>' : '') + '</p>' +
        '<p class="kv">' + esc(T('rwOrg')) + ': ' + esc(r.org) + ' · ' + esc(r.code) + '</p><p class="kv">' + esc(T('rwFrom')) + ': ' + esc(r.start ? fmtTime(new Date(r.start), true) : '—') + ' · ' + esc(T('rwTo')) + ': ' + esc(r.projectEnd ? fmtTime(new Date(r.projectEnd), true) : '—') + '</p>' +
        '<button type="button" class="btn" data-rwmap="' + r.id + '">' + esc(T('showOnMap')) + '</button></article>';
    }).join('');
    var rest = list.length - S.rwShown; more.hidden = rest <= 0; more.textContent = T('showMore', { n: Math.min(rest, RW_PAGE) });
  }
  function loadRoadworks() { return getJSON('/roadworks').then(function (j) { S.roadworks = j; S.rwErr = false; renderRoadworks(); if (S.map) refreshMapLayers(); }, function () { S.rwErr = true; renderRoadworks(); }); }

  // ---------- map (Leaflet + OpenStreetMap) ----------
  function initMap() {
    if (S.map) return;
    S.map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([-36.88, 174.76], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(S.map);
    S.map.attributionControl.addAttribution('Data: NZTA Waka Kotahi · Auckland Transport (CC BY 4.0)');
    // own pane + canvas per layer so cameras/events always draw above congestion lines and roadworks dots
    S.rend = {};
    [['traffic', 402], ['rw', 404], ['events', 406], ['cams', 408]].forEach(function (p) { var pn = S.map.createPane('p_' + p[0]); pn.style.zIndex = p[1]; S.rend[p[0]] = L.canvas({ pane: 'p_' + p[0] }); S.layers[p[0]] = L.layerGroup(); });
    S.map.on('popupclose', function () { S.popupCam = null; });
    refreshMapLayers(); syncLayerToggles(); if (S.pos) showMeOnMap();
    if (!S.roadworks && $('lyRw').checked) loadRoadworks();
  }
  function syncLayerToggles() {
    if (!S.map) return; [['cams', 'lyCams'], ['events', 'lyEvents'], ['traffic', 'lyTraffic'], ['rw', 'lyRw']].forEach(function (p) {
      var on = $(p[1]).checked, ly = S.layers[p[0]]; if (on && !S.map.hasLayer(ly)) ly.addTo(S.map); if (!on && S.map.hasLayer(ly)) S.map.removeLayer(ly); });
    if ($('lyRw').checked && !S.roadworks) loadRoadworks(); if ($('lyTraffic').checked && !S.journeys) loadJourneys(); if ($('lyEvents').checked && !S.events) loadEvents();
  }
  function camPopup(cam) {
    return '<div class="pop" data-popcam="' + cam.id + '"><h3><span class="hw" aria-hidden="true">' + esc(cam.highway) + '</span>' + esc(cam.name) + '</h3><div class="note">' + esc(dirT(cam.direction)) + '</div>' +
      '<figure class="camimg" data-cam="' + cam.id + '"><span>' + esc(T('loadingImg')) + '</span></figure><p class="ts" data-ts="' + cam.id + '"></p>' +
      '<button type="button" class="btn" data-fav="' + cam.id + '" aria-pressed="' + isFav(cam.id) + '">' + esc(isFav(cam.id) ? T('removeFav') : T('addFav')) + '</button></div>';
  }
  function refreshMapLayers() {
    if (!S.map) return; var Ly = S.layers; S.camMarkers = {};
    Ly.cams.clearLayers(); S.cams.forEach(function (c) {
      var m = L.circleMarker([c.lat, c.lon], { renderer: S.rend.cams, pane: 'p_cams', radius: 8, color: '#fff', weight: 2, fillColor: '#0b5d7a', fillOpacity: 1 }).bindPopup(function () { return camPopup(c); }, { maxWidth: 320, autoPanPadding: [20, 20] });
      m.on('popupopen', function () { S.popupCam = c.id; paintImg(c.id); var st = S.imgState[c.id]; if (!st || Date.now() - (st.at || 0) > REFRESH_MS - 3000) enqueue(c.id); });
      m.bindTooltip(c.name); m.addTo(Ly.cams); S.camMarkers[c.id] = m; });
    Ly.events.clearLayers(); S.evMarkers = {}; if (S.events) S.events.events.forEach(function (e) {
      var html = '<div class="pop"><h3>' + esc(e.location) + '</h3><span class="pill closed">' + esc(evImpact(e)) + '</span> <span class="pill plan">' + esc(evType(e)) + '</span><p lang="en">' + esc(e.comments || e.description) + '</p><p class="note">' + esc(T('disclaimerEvents')) + '</p></div>';
      var g = e.geometry; if (!g) return; var m;
      if (g.type === 'POINT') m = L.circleMarker(g.coords[0][0], { renderer: S.rend.events, pane: 'p_events', radius: 9, color: '#fff', weight: 2, fillColor: '#b3261e', fillOpacity: 1 });
      else m = L.polyline(g.coords, { renderer: S.rend.events, pane: 'p_events', color: '#b3261e', weight: 6, dashArray: '6 6' });
      m.bindPopup(html, { maxWidth: 320 }).addTo(Ly.events); S.evMarkers[e.id] = m; });
    Ly.traffic.clearLayers(); if (S.journeys) S.journeys.legs.forEach(function (l) { if (!l.line) return; var c = cong(l.ratio);
      L.polyline(l.line, { renderer: S.rend.traffic, pane: 'p_traffic', color: CCOL[c], weight: 5, opacity: .85 }).bindPopup('<div class="pop"><h3>' + esc(l.name) + '</h3>' + esc(T('speedOf', { s: l.speed, l: l.limit })) + (l.heading ? '<br>' + esc(dirT(l.heading)) : '') + '</div>').addTo(Ly.traffic); });
    Ly.rw.clearLayers(); S.rwMarkers = {}; if (S.roadworks) S.roadworks.roadworks.forEach(function (r) {
      S.rwMarkers[r.id] = L.circleMarker([r.lat, r.lon], { renderer: S.rend.rw, pane: 'p_rw', radius: 5, color: '#fff', weight: 1, fillColor: '#6d4c41', fillOpacity: .9 })
        .bindPopup('<div class="pop"><h3>' + esc(r.name) + '</h3>' + esc(rwType(r.type)) + ' · ' + esc(r.org) + '<p class="note">Auckland Transport (CC BY 4.0)</p></div>', { maxWidth: 320 }).addTo(Ly.rw); });
  }
  function showMeOnMap() { if (!S.map || !S.pos) return; if (S.meMarker) S.map.removeLayer(S.meMarker);
    S.meMarker = L.circleMarker([S.pos.lat, S.pos.lon], { renderer: S.rend.cams, pane: 'p_cams', radius: 7, color: '#0b5d7a', weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(S.map); }
  function focusOnMap(kind, id) {
    showView('map'); setTimeout(function () {
      var m = kind === 'cam' ? S.camMarkers && S.camMarkers[id] : kind === 'ev' ? S.evMarkers && S.evMarkers[id] : S.rwMarkers && S.rwMarkers[id];
      if (kind === 'rw' && !$('lyRw').checked) { $('lyRw').checked = true; syncLayerToggles(); }
      if (kind === 'ev' && !$('lyEvents').checked) { $('lyEvents').checked = true; syncLayerToggles(); }
      if (kind === 'cam' && !$('lyCams').checked) { $('lyCams').checked = true; syncLayerToggles(); }
      if (!m) return; var ll = m.getLatLng ? m.getLatLng() : m.getBounds().getCenter();
      $('map').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70);
      S.map.setView(ll, 15, { animate: false }); m.openPopup(ll);
    }, 80);
  }

  // ---------- events wiring ----------
  function init() {
    var saved = lsGet(LS.lang, null), nav = (navigator.language || '').toLowerCase();
    S.lang = saved && I18N[saved] ? saved : (/^zh-(cn|sg|hans)/.test(nav) ? 'zh-Hans' : /^zh/.test(nav) ? 'zh-Hant' : /^ja/.test(nav) ? 'ja' : /^ko/.test(nav) ? 'ko' : /^mi/.test(nav) ? 'mi' : /^en/.test(nav) ? 'en' : 'zh-Hant');
    S.font = lsGet(LS.font, 1); if (!(S.font >= 0 && S.font < FONT_LEVELS.length)) S.font = 1;
    S.favs = (lsGet(LS.favs, []) || []).filter(function (x) { return typeof x === 'number'; });
    if (S.favs.length) S.filter = 'fav';
    $('lang').innerHTML = LANGS.map(function (l) { return '<option value="' + l.code + '" lang="' + l.html + '">' + esc(l.label) + '</option>'; }).join('');
    $('lang').value = S.lang;
    $('lang').addEventListener('change', function () { S.lang = this.value; lsSet(LS.lang, S.lang); applyLang(); });
    $('fMinus').addEventListener('click', function () { if (S.font > 0) { S.font--; lsSet(LS.font, S.font); applyFont(); } });
    $('fPlus').addEventListener('click', function () { if (S.font < FONT_LEVELS.length - 1) { S.font++; lsSet(LS.font, S.font); applyFont(); } });
    $('fReset').addEventListener('click', function () { S.font = 1; lsSet(LS.font, S.font); applyFont(); });
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (b) showView(b.getAttribute('data-view')); });
    $('tabs').addEventListener('keydown', function (e) { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; var tabs = [].slice.call(document.querySelectorAll('#tabs [role=tab]'));
      var i = tabs.indexOf(document.activeElement); if (i < 0) return; var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); showView(n.getAttribute('data-view')); });
    $('chips').addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (!b) return; S.filter = b.getAttribute('data-f'); renderChips(); if (S.filter === 'near' && !S.pos) locate(); renderCams(); });
    var qt; $('q').addEventListener('input', function () { var v = this.value; clearTimeout(qt); qt = setTimeout(function () { S.q = v.trim(); renderCams(); }, 150); });
    var rt; $('rq').addEventListener('input', function () { clearTimeout(rt); rt = setTimeout(function () { S.rwShown = RW_PAGE; renderRoadworks(); }, 150); });
    $('rwMore').addEventListener('click', function () { S.rwShown += RW_PAGE; renderRoadworks(); });
    document.addEventListener('click', function (e) {
      var f = e.target.closest('[data-fav]'); if (f) { toggleFav(+f.getAttribute('data-fav')); return; }
      var m = e.target.closest('[data-onmap]'); if (m) { focusOnMap('cam', +m.getAttribute('data-onmap')); return; }
      var ev = e.target.closest('[data-evmap]'); if (ev) { focusOnMap('ev', ev.getAttribute('data-evmap')); return; }
      var rw = e.target.closest('[data-rwmap]'); if (rw) { focusOnMap('rw', +rw.getAttribute('data-rwmap')); return; }
    });
    ['lyCams', 'lyEvents', 'lyTraffic', 'lyRw'].forEach(function (id) { $(id).addEventListener('change', syncLayerToggles); });
    applyFont(); applyLang();
    var h = (location.hash || '').slice(1); showView(['cams', 'map', 'events', 'traffic', 'rw'].indexOf(h) >= 0 ? h : 'cams');
    loadCams(); loadEvents(); loadJourneys();
    setInterval(function () { if (!document.hidden) loadCams(); }, 10 * 60000);
    setInterval(function () { if (!document.hidden) { loadEvents(); loadJourneys(); } }, 2 * 60000);
    setInterval(function () { if (!document.hidden && S.roadworks) loadRoadworks(); }, 30 * 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
