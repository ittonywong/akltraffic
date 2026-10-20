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
  var S = { lang: 'en', font: 1, favs: [], cams: [], camsAt: null, filter: 'all', area: null, place: null, q: '', pos: null, view: 'cams', suggestIdx: -1,
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

  function camMeta(cam) {
    var raw = (window.AKLT_CAM_AREA || {})[cam.id];
    if (!raw && cam.id != null) raw = (window.AKLT_CAM_AREA || {})[String(cam.id)];
    if (!raw) return { area: null, place: null };
    var p = String(raw).split('|'); return { area: p[0] || null, place: p[1] || null };
  }
  function placeLabel(pid) {
    var p = (window.AKLT_PLACES || {})[pid]; if (!p) return pid;
    return p[S.lang] || p.en || pid;
  }
  function areaLabel(aid) {
    var a = (window.AKLT_AREAS || {})[aid]; if (!a) return aid;
    return a[S.lang] || a.en || aid;
  }
  function sortOrigin() {
    if (S.place && window.AKLT_PLACES[S.place]) { var p = AKLT_PLACES[S.place]; return { lat: p.lat, lon: p.lon, kind: 'place' }; }
    if (S.area && window.AKLT_AREAS[S.area]) { var a = AKLT_AREAS[S.area]; return { lat: a.lat, lon: a.lon, kind: 'area' }; }
    return null;
  }
  function withDist(list, origin) {
    return list.map(function (c) { return { cam: c, d: haversine(origin.lat, origin.lon, c.lat, c.lon) }; })
      .sort(function (a, b) { return a.d - b.d; });
  }

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
    renderChips(); renderCams(); renderFavs(); renderEvents(); renderTraffic(); renderRoadworks(); renderLegends(); if (S.map) refreshMapLayers();
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
    renderFavs(); }
  function favBtnState(b, id) { var on = isFav(id); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? T('removeFav') : T('addFav'); }

  // ---------- cameras ----------
  function camById(id) { for (var i = 0; i < S.cams.length; i++) if (S.cams[i].id === id) return S.cams[i]; return null; }
  function renderChips() {
    var c = $('chips');
    var items = [['all', T('fAll')], ['near', T('fNear')]];
    ['north', 'city', 'east', 'west', 'south'].forEach(function (a) { items.push(['area:' + a, areaLabel(a)]); });
    HW_ORDER.forEach(function (h) { items.push([h, h]); });
    c.setAttribute('aria-label', T('areasLabel'));
    var cur = chipKey();
    c.innerHTML = items.map(function (it) {
      var pressed = false, f = it[0];
      if (f === 'all') pressed = (S.filter === 'all' && !S.area && !S.place);
      else if (f === 'near') pressed = (S.filter === 'near');
      else if (f.indexOf('area:') === 0) pressed = (S.area === f.slice(5) && S.filter !== 'near');
      else if (HW_ORDER.indexOf(f) >= 0) pressed = (S.filter === f && !S.area && !S.place);
      var cls = f.indexOf('area:') === 0 ? ' chip area' : '';
      return '<button type="button" class="chip' + cls + '" data-f="' + f + '" aria-pressed="' + pressed + '">' + esc(it[1]) + '</button>';
    }).join('');
    renderPlaceChips();
  }
  function chipKey() {
    if (S.place) return 'place:' + S.place;
    if (S.area) return 'area:' + S.area;
    return S.filter;
  }
  function renderPlaceChips() {
    var el = $('placeChips'); if (!el) return;
    if (!S.area || S.filter === 'near') { el.hidden = true; el.innerHTML = ''; return; }
    var places = Object.keys(AKLT_PLACES).filter(function (pid) { return AKLT_PLACES[pid].area === S.area; });
    // only places that have at least one loaded camera (or all known if cams not in yet)
    var have = {};
    S.cams.forEach(function (c) { var m = camMeta(c); if (m.place) have[m.place] = true; });
    places = places.filter(function (pid) { return !S.cams.length || have[pid]; });
    el.hidden = false;
    el.setAttribute('aria-label', T('placesLabel'));
    var html = '<button type="button" class="chip place" data-place="" aria-pressed="' + (!S.place) + '">' + esc(T('allPlaces')) + '</button>';
    html += places.map(function (pid) {
      return '<button type="button" class="chip place" data-place="' + pid + '" aria-pressed="' + (S.place === pid) + '">' + esc(placeLabel(pid)) + '</button>';
    }).join('');
    el.innerHTML = html;
  }
  function matchQ(cam) {
    if (!S.q) return true;
    var q = S.q.toLowerCase();
    var m = camMeta(cam);
    // Place/area display names only (not aliases — aliases are for autocomplete, so "Rosedale" still means the camera).
    var pl = '';
    if (m.place && AKLT_PLACES[m.place]) {
      var p = AKLT_PLACES[m.place];
      pl = placeLabel(m.place) + ' ' + (p.en || '');
    }
    var ar = m.area && AKLT_AREAS[m.area] ? areaLabel(m.area) + ' ' + (AKLT_AREAS[m.area].en || '') : '';
    return (cam.name + ' ' + cam.description + ' ' + cam.highway + ' ' + cam.direction + ' ' + dirT(cam.direction) + ' ' + cam.id + ' ' + pl + ' ' + ar).toLowerCase().indexOf(q) >= 0;
  }
  function sortHw(list, h) { return list.slice().sort(function (a, b) { return (h === 'SH1' || h === 'SH18') ? b.lat - a.lat : a.lon - b.lon; }); }
  function camCard(cam, dist) {
    var tags = (cam.offline ? '<span class="tag off">' + esc(T('offline')) + '</span>' : '') + (cam.underMaintenance ? '<span class="tag off">' + esc(T('maintenance')) + '</span>' : '');
    var m = camMeta(cam);
    var where = (m.place ? placeLabel(m.place) : '') + (m.area ? (m.place ? ' · ' : '') + areaLabel(m.area) : '');
    return '<article class="cam" data-id="' + cam.id + '"' + (m.area ? ' data-area="' + m.area + '"' : '') + (m.place ? ' data-place="' + m.place + '"' : '') + '>' +
      '<h3><span class="hw" aria-hidden="true">' + esc(cam.highway) + '</span>' + esc(cam.name) + '</h3>' +
      '<div class="meta">' + esc(dirT(cam.direction)) + ' · ' + esc(cam.description) + (where ? ' · ' + esc(where) : '') + (dist != null ? ' · <span class="dist">' + esc(T('kmAway', { d: dist.toFixed(1) })) + '</span>' : '') + ' ' + tags + '</div>' +
      '<figure class="camimg zoomable" data-cam="' + cam.id + '" role="button" tabindex="0" aria-label="' + esc(T('enlargeAria', { name: cam.name })) + '"><span>' + esc(T('loadingImg')) + '</span></figure>' +
      '<p class="ts" data-ts="' + cam.id + '"></p>' +
      '<div class="actions"><button type="button" class="btn" data-fav="' + cam.id + '" aria-pressed="' + isFav(cam.id) + '" aria-label="' + esc(T('favAria', { name: cam.name })) + '">' + esc(isFav(cam.id) ? T('removeFav') : T('addFav')) + '</button>' +
      '<button type="button" class="btn" data-onmap="' + cam.id + '">' + esc(T('showOnMap')) + '</button></div></article>';
  }
  function filterCams() {
    var list = S.cams.filter(matchQ);
    if (S.place) list = list.filter(function (c) { return camMeta(c).place === S.place; });
    else if (S.area) list = list.filter(function (c) { return camMeta(c).area === S.area; });
    else if (S.filter !== 'all' && S.filter !== 'near' && HW_ORDER.indexOf(S.filter) >= 0)
      list = list.filter(function (c) { return c.highway === S.filter; });
    return list;
  }
  function renderCams() {
    var el = $('camList'); if (!el) return; var st = $('camStatus');
    if (!S.cams.length) { st.textContent = S.camErr ? T('loadError') : T('loading'); st.classList.toggle('err', !!S.camErr); el.innerHTML = ''; return; }
    var list = filterCams(), html = '';
    $('nearNote').hidden = S.filter !== 'near';
    var origin = sortOrigin();
    $('areaNote').hidden = !(origin && S.filter !== 'near');
    if (origin && S.filter !== 'near') $('areaNote').textContent = T('areaNote');
    if (S.filter === 'near') {
      $('nearNote').textContent = T('privacyLoc') + (S.locMsg ? ' — ' + S.locMsg : '');
      if (S.pos) { var withD = list.map(function (c) { return [c, haversine(S.pos.lat, S.pos.lon, c.lat, c.lon)]; }).sort(function (a, b) { return a[1] - b[1]; }).slice(0, NEAR_N);
        html = '<section class="group near"><h2>' + esc(T('nearTitle')) + '</h2><div class="grid">' + withD.map(function (x) { return camCard(x[0], x[1]); }).join('') + '</div></section>'; }
    } else if (origin) {
      var ranked = withDist(list, origin);
      if (!ranked.length) html = '<p class="note">' + esc(T('noAreaCams')) + '</p>';
      else {
        var title = S.place ? placeLabel(S.place) : areaLabel(S.area);
        html = '<section class="group near"><h2>' + esc(title) + ' · ' + esc(T('groupCount', { n: ranked.length })) + '</h2><div class="grid">' +
          ranked.map(function (x) { return camCard(x.cam, x.d); }).join('') + '</div></section>';
      }
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
  function renderFavs() {
    var el = $('favList'); if (!el) return; var b = $('favBadge');
    b.hidden = !S.favs.length; b.textContent = S.favs.length;
    var favs = S.favs.map(camById).filter(Boolean);
    if (!S.cams.length) { el.innerHTML = '<p class="status">' + esc(S.camErr ? T('loadError') : T('loading')) + '</p>'; return; }
    el.innerHTML = favs.length ? '<p class="status">' + esc(T('camCount', { n: favs.length }) + ' · ' + T('autoRefresh')) + '</p><div class="grid">' + favs.map(function (c) { return camCard(c); }).join('') + '</div>'
      : '<div class="empty"><p class="big" aria-hidden="true">☆</p><p>' + esc(T('noFavs')) + '</p><button type="button" class="btn" id="favGoCams">' + esc(T('favBrowse')) + '</button></div>';
    observeCards();
  }
  function loadCams() {
    return getJSON('/cameras').then(function (j) { S.cams = j.cameras || []; S.camsAt = j.fetchedAt; S.camErr = false; renderCams(); renderFavs(); if (S.map) refreshMapLayers(); },
      function () { S.camErr = true; renderCams(); renderFavs(); setTimeout(loadCams, 30000); });
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
    if (S.viewerCam === id) paintViewer();
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
    document.querySelectorAll('#camList [data-cam], #favList [data-cam]').forEach(function (f) { var id = +f.getAttribute('data-cam'); if (S.imgState[id] && S.imgState[id].url) paintImg(id); if (io) io.observe(f); else maybeLoad(id); });
  }
  function maybeLoad(id) { var st = S.imgState[id]; if (document.hidden) return; if (!st || (!st.loading && Date.now() - (st.at || 0) > REFRESH_MS - 3000)) enqueue(id); }
  function refreshVisible() {
    if (document.hidden) return;
    var ids = {}; S.visible.forEach(function (el) { if (document.body.contains(el) && !el.closest('[hidden]')) ids[el.getAttribute('data-cam')] = 1; });
    if (S.popupCam) ids[S.popupCam] = 1;
    if (S.viewerCam) ids[S.viewerCam] = 1;
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
      '<figure class="camimg zoomable" data-cam="' + cam.id + '" role="button" tabindex="0" aria-label="' + esc(T('enlargeAria', { name: cam.name })) + '"><span>' + esc(T('loadingImg')) + '</span></figure><p class="ts" data-ts="' + cam.id + '"></p>' +
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


  // ---------- full-screen photo viewer (display scaling only; image bytes never altered; opens fit-contain) ----------
  var V = { s: 1, x: 0, y: 0, ptrs: {}, pinch: null, pan: null, opener: null, pushed: false, lastTap: 0 };
  var VMAX = 5;
  function vApply() { var img = $('vImg'); img.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(' + V.s + ')';
    $('vZoomOut').disabled = V.s <= 1; $('vZoomIn').disabled = V.s >= VMAX; $('vFit').disabled = V.s === 1; $('vZoomLvl').textContent = Math.round(V.s * 100) + '%'; }
  function vClamp() { var st = $('vStage').getBoundingClientRect(); var mx = st.width * (V.s - 1) / 2, my = st.height * (V.s - 1) / 2;
    V.x = Math.max(-mx, Math.min(mx, V.x)); V.y = Math.max(-my, Math.min(my, V.y)); }
  function vZoomAt(ns, cx, cy) { ns = Math.max(1, Math.min(VMAX, ns)); var st = $('vStage').getBoundingClientRect();
    var ox = (cx == null ? st.width / 2 : cx - st.left) - st.width / 2, oy = (cy == null ? st.height / 2 : cy - st.top) - st.height / 2;
    V.x = ox - (ox - V.x) * ns / V.s; V.y = oy - (oy - V.y) * ns / V.s; V.s = ns; if (ns === 1) { V.x = 0; V.y = 0; } vClamp(); vApply(); }
  function paintViewer() { var id = S.viewerCam; if (!id) return; var st = S.imgState[id] || {}, cam = camById(id) || { name: '', direction: '', highway: '' };
    var img = $('vImg'); $('vTitle').textContent = cam.name; $('vMeta').textContent = [cam.highway, dirT(cam.direction), cam.description].filter(Boolean).join(' · ');
    img.alt = T('imgAlt', { name: cam.name, dir: dirT(cam.direction) });
    if (st.url) { if (img.src !== st.url) img.src = st.url; img.hidden = false; $('vMsg').hidden = true; }
    else { img.hidden = true; img.removeAttribute('src'); $('vMsg').hidden = false; $('vMsg').textContent = st.err ? T('imgError') : T('loadingImg'); } }
  function openViewer(id, opener) {
    if (!camById(id)) return; S.viewerCam = id; V.opener = opener || document.activeElement; V.s = 1; V.x = 0; V.y = 0;
    var dlg = $('viewer'); $('vTs').setAttribute('data-ts', id); dlg.hidden = false; document.body.classList.add('noscroll');
    document.querySelectorAll('body > :not(#viewer)').forEach(function (el) { if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); el.setAttribute('data-vinert', ''); } });
    paintViewer(); paintTs(id); vApply(); maybeLoad(id);
    try { history.pushState({ akltViewer: id }, ''); V.pushed = true; } catch (e) { V.pushed = false; }
    setTimeout(function () { $('vClose').focus(); }, 0);
  }
  function closeViewer(fromPop) {
    if (!S.viewerCam) return; S.viewerCam = null; $('viewer').hidden = true; document.body.classList.remove('noscroll'); $('vTs').removeAttribute('data-ts');
    document.querySelectorAll('[data-vinert]').forEach(function (el) { el.removeAttribute('inert'); el.removeAttribute('data-vinert'); });
    if (!fromPop && V.pushed) { V.pushed = false; V.ignorePop = true; history.back(); } V.pushed = false;
    if (V.opener && document.body.contains(V.opener)) try { V.opener.focus(); } catch (e) {}
  }
  window.addEventListener('popstate', function () { if (V.ignorePop) { V.ignorePop = false; return; } if (S.viewerCam) { V.pushed = false; closeViewer(true); } });
  function initViewer() {
    var stage = $('vStage');
    $('vClose').addEventListener('click', function () { closeViewer(false); });
    $('vZoomIn').addEventListener('click', function () { vZoomAt(V.s * 1.5); });
    $('vZoomOut').addEventListener('click', function () { vZoomAt(V.s / 1.5); });
    $('vFit').addEventListener('click', function () { vZoomAt(1); });
    $('viewer').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeViewer(false); return; }
      if (e.key === '+' || e.key === '=') { vZoomAt(V.s * 1.5); return; } if (e.key === '-') { vZoomAt(V.s / 1.5); return; } if (e.key === '0') { vZoomAt(1); return; }
      if (e.key === 'Tab') { var f = [].slice.call($('viewer').querySelectorAll('button:not([disabled]), [tabindex="0"]')); if (!f.length) return;
        var i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      if (V.s > 1 && /^Arrow/.test(e.key) && document.activeElement === stage) { e.preventDefault(); var d = 40; if (e.key === 'ArrowLeft') V.x += d; if (e.key === 'ArrowRight') V.x -= d; if (e.key === 'ArrowUp') V.y += d; if (e.key === 'ArrowDown') V.y -= d; vClamp(); vApply(); }
    });
    stage.addEventListener('wheel', function (e) { e.preventDefault(); vZoomAt(V.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
    stage.addEventListener('pointerdown', function (e) { stage.setPointerCapture && stage.setPointerCapture(e.pointerId); V.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(V.ptrs);
      if (ids.length === 2) { var a = V.ptrs[ids[0]], b = V.ptrs[ids[1]]; V.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.s }; V.pan = null; }
      else if (ids.length === 1) { V.pan = { x: e.clientX, y: e.clientY, ox: V.x, oy: V.y };
        var now = Date.now(); if (now - V.lastTap < 300) { vZoomAt(V.s > 1 ? 1 : 2.5, e.clientX, e.clientY); V.lastTap = 0; } else V.lastTap = now; } });
    stage.addEventListener('pointermove', function (e) { if (!V.ptrs[e.pointerId]) return; V.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; var ids = Object.keys(V.ptrs);
      if (ids.length === 2 && V.pinch) { var a = V.ptrs[ids[0]], b = V.ptrs[ids[1]]; vZoomAt(V.pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / V.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); }
      else if (V.pan && V.s > 1) { V.x = V.pan.ox + e.clientX - V.pan.x; V.y = V.pan.oy + e.clientY - V.pan.y; vClamp(); vApply(); } });
    function up(e) { delete V.ptrs[e.pointerId]; if (Object.keys(V.ptrs).length < 2) V.pinch = null; if (!Object.keys(V.ptrs).length) V.pan = null; }
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    window.addEventListener('resize', function () { if (S.viewerCam) { vClamp(); vApply(); } });
  }
  function goHome() {
    if (S.viewerCam) closeViewer(false);
    S.filter = 'all'; S.area = null; S.place = null; S.q = ''; $('q').value = '';
    hideSuggest(); renderChips(); renderCams(); showView('cams'); window.scrollTo(0, 0);
    var l = $('camList'); if (l) l.scrollTop = 0;
  }
  function setArea(aid) {
    S.filter = 'all'; S.area = aid; S.place = null; hideSuggest(); renderChips(); renderCams();
  }
  function setPlace(pid) {
    if (!pid) { S.place = null; hideSuggest(); renderChips(); renderCams(); return; }
    var p = AKLT_PLACES[pid]; if (!p) return;
    S.filter = 'all'; S.area = p.area; S.place = pid; S.q = ''; $('q').value = '';
    hideSuggest(); renderChips(); renderCams();
  }
  function hideSuggest() {
    var s = $('suggest'); if (!s) return; s.hidden = true; s.innerHTML = ''; S.suggestIdx = -1;
    $('q').setAttribute('aria-expanded', 'false');
  }
  function placeSearchBlob(pid) {
    var p = AKLT_PLACES[pid]; if (!p) return '';
    var labels = [p.en, p['zh-Hant'], p['zh-Hans'], p.ja, p.mi, p.ko].concat(p.aliases || []);
    return labels.join(' ').toLowerCase();
  }
  function buildSuggestions(q) {
    q = (q || '').trim().toLowerCase(); if (q.length < 1) return [];
    var out = [], seen = {};
    Object.keys(AKLT_PLACES).forEach(function (pid) {
      if (placeSearchBlob(pid).indexOf(q) >= 0) { out.push({ type: 'place', id: pid, label: placeLabel(pid), sub: areaLabel(AKLT_PLACES[pid].area) }); seen[pid] = 1; }
    });
    // also match English official names when UI is translated
    S.cams.forEach(function (c) {
      var blob = (c.name + ' ' + c.description + ' ' + c.highway).toLowerCase();
      if (blob.indexOf(q) >= 0) out.push({ type: 'cam', id: c.id, label: c.name, sub: c.highway + (camMeta(c).place ? ' · ' + placeLabel(camMeta(c).place) : '') });
    });
    return out.slice(0, 12);
  }
  function renderSuggest(items) {
    var s = $('suggest'); if (!s) return;
    if (!items.length) { hideSuggest(); return; }
    S.suggestIdx = 0;
    s.hidden = false; $('q').setAttribute('aria-expanded', 'true');
    s.innerHTML = items.map(function (it, i) {
      var kind = it.type === 'place' ? T('suggestPlace') : T('suggestCam');
      return '<li role="option" id="sg-' + i + '"><button type="button" data-sg="' + i + '" aria-selected="' + (i === 0) + '"><span class="sg-main">' + esc(it.label) + '</span><span class="sg-sub">' + esc(kind + ' · ' + it.sub) + '</span></button></li>';
    }).join('');
    s._items = items;
  }
  function applySuggestion(it) {
    if (!it) return;
    if (it.type === 'place') setPlace(it.id);
    else if (it.type === 'cam') {
      var m = camMeta({ id: it.id }); S.filter = 'all'; S.area = m.area; S.place = m.place; S.q = ''; $('q').value = '';
      hideSuggest(); renderChips(); renderCams();
      setTimeout(function () { var el = document.querySelector('#camList [data-id="' + it.id + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
    }
  }

  // ---------- events wiring ----------
  function init() {
    var saved = lsGet(LS.lang, null);
    // First visit defaults to English; a chosen language is remembered in localStorage.
    S.lang = saved && I18N[saved] ? saved : 'en';
    S.font = lsGet(LS.font, 1); if (!(S.font >= 0 && S.font < FONT_LEVELS.length)) S.font = 1;
    S.favs = (lsGet(LS.favs, []) || []).filter(function (x) { return typeof x === 'number'; });
    $('lang').innerHTML = LANGS.map(function (l) { return '<option value="' + l.code + '" lang="' + l.html + '">' + esc(l.label) + '</option>'; }).join('');
    $('lang').value = S.lang;
    $('lang').addEventListener('change', function () { S.lang = this.value; lsSet(LS.lang, S.lang); applyLang(); });
    $('fMinus').addEventListener('click', function () { if (S.font > 0) { S.font--; lsSet(LS.font, S.font); applyFont(); } });
    $('fPlus').addEventListener('click', function () { if (S.font < FONT_LEVELS.length - 1) { S.font++; lsSet(LS.font, S.font); applyFont(); } });
    $('fReset').addEventListener('click', function () { S.font = 1; lsSet(LS.font, S.font); applyFont(); });
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (b) showView(b.getAttribute('data-view')); });
    $('tabs').addEventListener('keydown', function (e) { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; var tabs = [].slice.call(document.querySelectorAll('#tabs [role=tab]'));
      var i = tabs.indexOf(document.activeElement); if (i < 0) return; var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); showView(n.getAttribute('data-view')); });
    $('chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-f]'); if (!b) return;
      var f = b.getAttribute('data-f');
      if (f.indexOf('area:') === 0) { setArea(f.slice(5)); return; }
      S.area = null; S.place = null; S.filter = f; hideSuggest(); renderChips();
      if (S.filter === 'near' && !S.pos) locate(); renderCams();
    });
    $('placeChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-place]'); if (!b) return;
      setPlace(b.getAttribute('data-place') || null);
    });
    var qt; $('q').addEventListener('input', function () {
      var v = this.value; clearTimeout(qt);
      qt = setTimeout(function () {
        S.q = v.trim();
        renderSuggest(buildSuggestions(v));
        renderCams();
      }, 120);
    });
    $('q').addEventListener('keydown', function (e) {
      var s = $('suggest'); if (!s || s.hidden || !s._items) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); S.suggestIdx = Math.min(S.suggestIdx + 1, s._items.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); S.suggestIdx = Math.max(S.suggestIdx - 1, 0); }
      else if (e.key === 'Enter' && S.suggestIdx >= 0) { e.preventDefault(); applySuggestion(s._items[S.suggestIdx]); return; }
      else if (e.key === 'Escape') { hideSuggest(); return; }
      else return;
      [].forEach.call(s.querySelectorAll('[data-sg]'), function (btn) {
        var on = +btn.getAttribute('data-sg') === S.suggestIdx; btn.setAttribute('aria-selected', String(on)); if (on) btn.scrollIntoView({ block: 'nearest' });
      });
    });
    $('suggest').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sg]'); if (!b) return;
      applySuggestion(($('suggest')._items || [])[+b.getAttribute('data-sg')]);
    });
    var rt; $('rq').addEventListener('input', function () { clearTimeout(rt); rt = setTimeout(function () { S.rwShown = RW_PAGE; renderRoadworks(); }, 150); });
    $('rwMore').addEventListener('click', function () { S.rwShown += RW_PAGE; renderRoadworks(); });
    initViewer();
    $('homeLink').addEventListener('click', function (e) { e.preventDefault(); goHome(); });
    document.addEventListener('keydown', function (e) { var z = e.target.closest && e.target.closest('.zoomable'); if (z && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openViewer(+z.getAttribute('data-cam'), z); } });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.suggest-wrap')) hideSuggest();
      var z = e.target.closest('.zoomable'); if (z) { openViewer(+z.getAttribute('data-cam'), z); return; }
      if (e.target.closest('#favGoCams')) { goHome(); return; }
      var f = e.target.closest('[data-fav]'); if (f) { toggleFav(+f.getAttribute('data-fav')); return; }
      var m = e.target.closest('[data-onmap]'); if (m) { focusOnMap('cam', +m.getAttribute('data-onmap')); return; }
      var ev = e.target.closest('[data-evmap]'); if (ev) { focusOnMap('ev', ev.getAttribute('data-evmap')); return; }
      var rw = e.target.closest('[data-rwmap]'); if (rw) { focusOnMap('rw', +rw.getAttribute('data-rwmap')); return; }
    });
    ['lyCams', 'lyEvents', 'lyTraffic', 'lyRw'].forEach(function (id) { $(id).addEventListener('change', syncLayerToggles); });
    applyFont(); applyLang();
    var h = (location.hash || '').slice(1); showView(['cams', 'fav', 'map', 'events', 'traffic', 'rw'].indexOf(h) >= 0 ? h : (S.favs.length ? 'fav' : 'cams'));
    loadCams(); loadEvents(); loadJourneys();
    setInterval(function () { if (!document.hidden) loadCams(); }, 10 * 60000);
    setInterval(function () { if (!document.hidden) { loadEvents(); loadJourneys(); } }, 2 * 60000);
    setInterval(function () { if (!document.hidden && S.roadworks) loadRoadworks(); }, 30 * 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
