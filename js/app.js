'use strict';

(function () {
  var STORAGE_KEY = 'meguri.plan.v1';
  var L = globalThis.MeguriLogic;
  var Net = globalThis.MeguriNet;
  var DEFAULT_PLAN = {
    departure: { name: '京都駅', lat: 34.9858, lng: 135.7588 },
    departTime: '09:00',
    mode: 'car',
    returnToStart: false,
    places: [],
    manualOrder: false,
    updatedAt: new Date().toISOString()
  };
  var state = L.normalizePlan(DEFAULT_PLAN, DEFAULT_PLAN);
  var lastSchedule = null;
  var matrixInfo = { label: '未計算', approximate: false };
  var lastDeletedPlace = null;
  var toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function save() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('saveState').textContent = '保存済み';
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = L.normalizePlan(JSON.parse(raw), DEFAULT_PLAN);
    } catch (e) {
      state = L.normalizePlan(DEFAULT_PLAN, DEFAULT_PLAN);
    }
  }

  function setMessage(text) {
    $('message').textContent = text || '';
  }

  function setCalcBusy(busy) {
    $('optimizeBtn').disabled = !!busy;
    $('scheduleBtn').disabled = !!busy;
  }

  function fmtMin(min) {
    min = Math.round(Number(min) || 0);
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h > 0) return h + '時間' + (m ? m + '分' : '');
    return m + '分';
  }

  function updateFromInputs() {
    state.departure.name = $('departureName').value.trim() || '出発地';
    // 空欄・非数のときは Number('')=0 を代入せず直前の座標を保持する(場所側の編集ハンドラと同じ検証)。
    // 保持後に render()→syncInputs() でフィールドは元の値に戻る。
    var latRaw = $('departureLat').value;
    var lngRaw = $('departureLng').value;
    var lat = Number(latRaw);
    var lng = Number(lngRaw);
    if (latRaw.trim() && isFinite(lat)) state.departure.lat = lat;
    if (lngRaw.trim() && isFinite(lng)) state.departure.lng = lng;
    state.departTime = $('departTime').value || '09:00';
    state.returnToStart = $('returnToStart').checked;
  }

  function syncInputs() {
    $('departureName').value = state.departure.name || '';
    $('departureLat').value = state.departure.lat;
    $('departureLng').value = state.departure.lng;
    $('departTime').value = state.departTime || '09:00';
    $('returnToStart').checked = !!state.returnToStart;
    var buttons = document.querySelectorAll('[data-mode]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-mode') === state.mode);
    }
  }

  function addPlace(place) {
    if (state.places.length >= L.MAX_OPTIMIZE_PLACES) {
      setMessage('場所は15件までです。');
      return;
    }
    state.places.push({
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: place.name || '地点',
      lat: Number(place.lat),
      lng: Number(place.lng),
      open: null,
      close: null,
      stayMin: 60,
      memo: ''
    });
    state.manualOrder = true;
    lastSchedule = null;
    save();
    render();
  }

  function movePlace(index, delta) {
    var next = index + delta;
    if (next < 0 || next >= state.places.length) return;
    var item = state.places.splice(index, 1)[0];
    state.places.splice(next, 0, item);
    state.manualOrder = true;
    lastSchedule = null;
    save();
    render();
  }

  function deletePlace(index) {
    var removed = state.places.splice(index, 1)[0];
    if (!removed) return;
    lastDeletedPlace = { place: removed, index: index };
    lastSchedule = null;
    save();
    render();
    showUndoToast();
  }

  function hideToast() {
    var toast = $('toast');
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toast) {
      toast.classList.remove('show');
      toast.innerHTML = '';
    }
  }

  function restoreDeletedPlace() {
    if (!lastDeletedPlace) return;
    var restore = lastDeletedPlace;
    lastDeletedPlace = null;
    state.places.splice(Math.min(restore.index, state.places.length), 0, restore.place);
    state.manualOrder = true;
    lastSchedule = null;
    save();
    render();
    hideToast();
  }

  function showUndoToast() {
    var toast = $('toast');
    if (!toast) return;
    if (toastTimer) clearTimeout(toastTimer);
    toast.innerHTML = '';
    var text = document.createElement('span');
    var button = document.createElement('button');
    text.textContent = '削除しました';
    button.type = 'button';
    button.textContent = '元に戻す';
    button.addEventListener('click', restoreDeletedPlace);
    toast.appendChild(text);
    toast.appendChild(button);
    toast.classList.add('show');
    toastTimer = setTimeout(function () {
      lastDeletedPlace = null;
      hideToast();
    }, 6000);
  }

  function googleLink(from, to) {
    var mode = state.mode === 'transit' ? 'transit' : 'driving';
    var origin = encodeURIComponent(from.lat + ',' + from.lng);
    var dest = encodeURIComponent(to.lat + ',' + to.lng);
    return 'https://www.google.com/maps/dir/?api=1&origin=' + origin + '&destination=' + dest + '&travelmode=' + mode;
  }

  function renderSummary() {
    var summary = $('summary');
    var badge = $('matrixBadge');
    badge.textContent = matrixInfo.label;
    badge.className = 'badge' + (matrixInfo.approximate ? ' warn' : '');
    if (!lastSchedule) {
      summary.innerHTML = '<div><b>未計算</b><span>最適ルート計算を実行</span></div>';
      return;
    }
    summary.innerHTML = [
      '<div><b>' + fmtMin(lastSchedule.totalTravelMin) + '</b><span>総移動</span></div>',
      '<div><b>' + fmtMin(lastSchedule.totalStayMin) + '</b><span>総滞在</span></div>',
      '<div><b>' + lastSchedule.finishTime + '</b><span>帰着/終了</span></div>',
      '<div' + (lastSchedule.totalLateMin > 0 ? ' class="crit"' : '') + '><b>' + fmtMin(lastSchedule.totalLateMin) + '</b><span>遅刻合計</span></div>'
    ].join('');
  }

  function renderRouteActions() {
    var target = $('routeActions');
    if (!target) return;
    // 全行程リンクは「計算後・車モード」のみ表示する。
    // 公共交通は Google マップの waypoints が実質使えないため区間リンクに任せる。
    if (!lastSchedule || state.mode !== 'car') {
      target.innerHTML = '';
      return;
    }
    var url = L.buildRouteUrl({
      departure: state.departure,
      places: state.places,
      returnToStart: state.returnToStart,
      mode: state.mode
    });
    if (url) {
      target.innerHTML = '<a class="route-open" href="' + url + '" target="_blank" rel="noopener">全行程をマップで開く</a>';
    } else {
      // 経由地が Google マップの上限(9件)を超えたとき
      target.innerHTML = '<p class="muted route-note">経由地が ' + L.MAX_WAYPOINTS + ' 件を超えるため全行程リンクは作れません。各区間の Google マップリンクをご利用ください。</p>';
    }
  }

  function stopInfoByPlaceId(id) {
    if (!lastSchedule) return null;
    for (var i = 0; i < lastSchedule.stops.length; i++) {
      if (lastSchedule.stops[i].place.id === id) return lastSchedule.stops[i];
    }
    return null;
  }

  function legForIndex(index) {
    if (!lastSchedule) return null;
    return lastSchedule.legs[index] || null;
  }

  function renderPlaces() {
    $('placeCount').textContent = state.places.length + ' 件';
    var timeline = $('timeline');
    if (!state.places.length) {
      timeline.innerHTML = '<p class="empty">場所を追加すると、ここに路線図が描かれます。</p>';
      return;
    }
    // 再レンダリングで details(詳細)の開閉状態を失わないよう、開いている場所IDを控える
    var openDetails = {};
    timeline.querySelectorAll('.more[open]').forEach(function (el) {
      openDetails[el.getAttribute('data-place')] = true;
    });
    timeline.innerHTML = renderTerminalStop('origin-stop', 'S', state.departure.name || '出発地', '出発 ' + (state.departTime || '09:00'));
    for (var i = 0; i < state.places.length; i++) {
      var place = state.places[i];
      var stop = stopInfoByPlaceId(place.id);
      var leg = legForIndex(i);
      var article = document.createElement('article');
      article.className = 'stop';
      var from = i === 0 ? state.departure : state.places[i - 1];
      timeline.insertAdjacentHTML('beforeend', renderLeg(leg, googleLink(from, place), false));
      article.innerHTML =
        '<div class="rail"><span>' + (i + 1) + '</span></div>' +
        '<div class="stop-body">' +
        '<div class="stop-top"><input class="name" data-field="name" data-index="' + i + '" value="' + escapeAttr(place.name) + '">' +
        renderArrival(stop) +
        '<div class="move"><button type="button" data-up="' + i + '" aria-label="上へ">↑</button><button type="button" data-down="' + i + '" aria-label="下へ">↓</button><button type="button" data-del="' + i + '">削除</button></div></div>' +
        renderTimes(stop) +
        '<div class="grid two">' +
        '<label>開始<input type="time" data-field="open" data-index="' + i + '" value="' + escapeAttr(place.open || '') + '"></label>' +
        '<label>終了<input type="time" data-field="close" data-index="' + i + '" value="' + escapeAttr(place.close || '') + '"></label>' +
        '<label>滞在(分)<input type="number" min="0" step="5" data-field="stayMin" data-index="' + i + '" value="' + escapeAttr(place.stayMin) + '"></label>' +
        '</div>' +
        '<details class="more" data-place="' + escapeAttr(place.id) + '"' + (openDetails[place.id] ? ' open' : '') + '><summary>詳細(座標・メモ)</summary>' +
        '<div class="grid two">' +
        '<label>緯度<input type="number" step="0.000001" data-field="lat" data-index="' + i + '" value="' + escapeAttr(place.lat) + '"></label>' +
        '<label>経度<input type="number" step="0.000001" data-field="lng" data-index="' + i + '" value="' + escapeAttr(place.lng) + '"></label>' +
        '</div>' +
        '<label>メモ<textarea data-field="memo" data-index="' + i + '">' + escapeHtml(place.memo || '') + '</textarea></label>' +
        '</details>' +
        '</div>';
      timeline.appendChild(article);
    }
    renderReturnLeg(timeline);
  }

  function renderReturnLeg(timeline) {
    if (!lastSchedule || !lastSchedule.returnLeg) return;
    var from = state.places[state.places.length - 1];
    timeline.insertAdjacentHTML('beforeend', renderLeg(lastSchedule.returnLeg, googleLink(from, state.departure), true));
    timeline.insertAdjacentHTML('beforeend', renderTerminalStop('return-stop', 'G', state.departure.name || '出発地', '帰着 ' + lastSchedule.finishTime));
  }

  function renderTerminalStop(cls, marker, name, time) {
    return '<article class="stop ' + cls + '">' +
      '<div class="rail"><span>' + marker + '</span></div>' +
      '<div class="stop-body">' +
      '<div class="stop-top terminal-top"><strong>' + escapeHtml(name) + '</strong><span class="arrive">' + escapeHtml(time) + '</span></div>' +
      '</div>' +
      '</article>';
  }

  function renderLeg(leg, link, isReturn) {
    var label = leg && matrixInfo.approximate ? '<span class="badge warn">' + (state.mode === 'transit' ? '目安' : '概算') + '</span>' : '';
    return '<article class="leg">' +
      '<div class="rail"></div>' +
      '<div class="leg-body">' +
      (isReturn ? '<span>帰路</span>' : '') +
      '<span>移動 ' + (leg ? fmtMin(leg.travelMin) : '-') + '</span>' +
      label +
      '<a href="' + link + '" target="_blank" rel="noopener">Google マップ</a>' +
      '</div>' +
      '</article>';
  }

  function renderArrival(stop) {
    if (!stop) return '';
    return '<span class="arrive">到着 ' + escapeHtml(stop.arrival) + '</span>';
  }

  function renderTimes(stop) {
    if (!stop) return '<div class="times muted">未計算</div>';
    var badges = '';
    if (stop.waitMin > 0) badges += '<span class="badge">待機 ' + fmtMin(stop.waitMin) + '</span>';
    if (stop.lateMin > 0) badges += '<span class="badge crit">遅刻 ' + fmtMin(stop.lateMin) + '</span>';
    if (stop.stayEndsAfterClose) badges += '<span class="badge warn">閉店後まで滞在</span>';
    return '<div class="times">' +
      '<span>開始 ' + stop.start + '</span>' +
      '<span>出発 ' + stop.depart + '</span>' +
      badges +
      '</div>';
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
  }

  function renderMap() {
    var target = $('miniMap');
    var points = [state.departure].concat(state.places);
    if (points.length < 2) {
      target.innerHTML = '<p class="empty">2点以上で表示します。</p>';
      return;
    }
    var minLat = Infinity;
    var maxLat = -Infinity;
    var minLng = Infinity;
    var maxLng = -Infinity;
    for (var i = 0; i < points.length; i++) {
      minLat = Math.min(minLat, points[i].lat);
      maxLat = Math.max(maxLat, points[i].lat);
      minLng = Math.min(minLng, points[i].lng);
      maxLng = Math.max(maxLng, points[i].lng);
    }
    var pad = 36;
    var w = 420;
    var h = 220;
    var availW = w - pad * 2;
    var availH = h - pad * 2;
    var midLat = (minLat + maxLat) / 2;
    var cosLat = Math.cos(midLat * Math.PI / 180);
    var lngGeoSpan = (maxLng - minLng) * cosLat;
    var latSpan = maxLat - minLat;
    var scale = Math.min(availW / (lngGeoSpan || 1e-9), availH / (latSpan || 1e-9));
    var drawnW = lngGeoSpan * scale;
    var drawnH = latSpan * scale;
    var offsetX = pad + (availW - drawnW) / 2;
    var offsetY = pad + (availH - drawnH) / 2;
    function x(p) {
      return offsetX + ((p.lng - minLng) * cosLat) * scale;
    }
    function y(p) {
      return h - (offsetY + (p.lat - minLat) * scale);
    }
    var poly = points.map(function (p) { return x(p).toFixed(1) + ',' + y(p).toFixed(1); }).join(' ');
    var dots = points.map(function (p, idx) {
      var cls = idx === 0 ? 'start' : 'place';
      return '<g><circle class="' + cls + '" cx="' + x(p).toFixed(1) + '" cy="' + y(p).toFixed(1) + '" r="7"></circle><text x="' + (x(p) + 11).toFixed(1) + '" y="' + (y(p) + 4).toFixed(1) + '">' + (idx === 0 ? 'S' : idx) + '</text></g>';
    }).join('');
    var grid = [
      '<line class="grid-line" x1="' + (w / 4).toFixed(1) + '" y1="1" x2="' + (w / 4).toFixed(1) + '" y2="' + (h - 1) + '"></line>',
      '<line class="grid-line" x1="' + (w / 2).toFixed(1) + '" y1="1" x2="' + (w / 2).toFixed(1) + '" y2="' + (h - 1) + '"></line>',
      '<line class="grid-line" x1="' + (w * 3 / 4).toFixed(1) + '" y1="1" x2="' + (w * 3 / 4).toFixed(1) + '" y2="' + (h - 1) + '"></line>',
      '<line class="grid-line" x1="1" y1="' + (h / 3).toFixed(1) + '" x2="' + (w - 1) + '" y2="' + (h / 3).toFixed(1) + '"></line>',
      '<line class="grid-line" x1="1" y1="' + (h * 2 / 3).toFixed(1) + '" x2="' + (w - 1) + '" y2="' + (h * 2 / 3).toFixed(1) + '"></line>'
    ].join('');
    target.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="訪問順ミニ地図"><rect x="1" y="1" width="' + (w - 2) + '" height="' + (h - 2) + '"></rect>' + grid + '<polyline points="' + poly + '"></polyline>' + dots + '</svg>';
  }

  function render() {
    document.body.classList.toggle('mode-transit', state.mode === 'transit');
    syncInputs();
    renderSummary();
    renderRouteActions();
    renderPlaces();
    renderMap();
  }

  function renderResults(targetId, items, onPick) {
    var target = $(targetId);
    target.innerHTML = '';
    if (!items.length) {
      target.innerHTML = '<p class="empty">候補がありません。</p>';
      return;
    }
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        if (item.full) btn.title = item.full;
        btn.textContent = item.name + ' / ' + item.lat.toFixed(5) + ',' + item.lng.toFixed(5);
        btn.addEventListener('click', function () {
          onPick(item);
          target.innerHTML = '';
        });
        target.appendChild(btn);
      })(items[i]);
    }
  }

  function searchPlace(kind) {
    var input = kind === 'departure' ? $('departureSearch') : $('placeSearch');
    var query = input.value.trim();
    var coord = L.normalizeLatLng(query);
    if (coord) {
      var item = { name: query, lat: coord.lat, lng: coord.lng };
      if (kind === 'departure') {
        state.departure = item;
        save();
        render();
      } else {
        addPlace(item);
      }
      return;
    }
    if (!query) return;
    setMessage('検索中です。');
    Net.searchNominatim(query).then(function (items) {
      setMessage('');
      renderResults(kind === 'departure' ? 'departureResults' : 'placeResults', items, function (item) {
        if (kind === 'departure') {
          state.departure = item;
          save();
          render();
        } else {
          addPlace(item);
        }
      });
    }).catch(function (err) {
      setMessage(err.message || '検索に失敗しました。');
    });
  }

  function buildMatrix() {
    var points = [state.departure].concat(state.places);
    if (state.mode === 'transit') {
      return Promise.resolve({ matrix: L.estimateMatrix(points, 'transit'), label: '目安', approximate: true });
    }
    return Net.fetchOsrmMatrix(points).then(function (result) {
      return { matrix: result.matrix, label: result.source === 'cache' ? 'OSRM キャッシュ' : 'OSRM', approximate: false };
    }).catch(function () {
      return { matrix: L.estimateMatrix(points, 'car'), label: '概算', approximate: true };
    });
  }

  // 起動時の自動計算用: ネットワークを叩かず行列を用意する。
  // 公共交通=目安式、車=OSRM キャッシュがあれば使い、無ければ概算。
  function buildMatrixFromCache() {
    var points = [state.departure].concat(state.places);
    if (state.mode === 'transit') {
      return { matrix: L.estimateMatrix(points, 'transit'), label: '目安', approximate: true };
    }
    var cached = Net.readOsrmMatrix(points);
    if (cached) return { matrix: cached, label: 'OSRM キャッシュ', approximate: false };
    return { matrix: L.estimateMatrix(points, 'car'), label: '概算', approximate: true };
  }

  function optimize() {
    updateFromInputs();
    if (!isFinite(state.departure.lat) || !isFinite(state.departure.lng)) {
      setMessage('出発地の緯度経度を指定してください。');
      return;
    }
    if (state.places.length > L.MAX_OPTIMIZE_PLACES) {
      setMessage('最適化できる場所は15件までです。');
      return;
    }
    if (!state.places.length) {
      setMessage('場所を追加してください。');
      return;
    }
    setMessage('計算中です。');
    setCalcBusy(true);
    buildMatrix().then(function (info) {
      var result = L.optimizeRoute({
        departure: state.departure,
        departTime: state.departTime,
        mode: state.mode,
        returnToStart: state.returnToStart,
        places: state.places,
        matrix: info.matrix,
        seed: 20260705
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      state.places = result.places;
      state.manualOrder = false;
      lastSchedule = result.schedule;
      matrixInfo = { label: info.label, approximate: info.approximate };
      save();
      setMessage('計算しました。');
      render();
    }).catch(function (err) {
      setMessage('計算に失敗しました: ' + (err && err.message ? err.message : String(err)));
    }).finally(function () {
      setCalcBusy(false);
    });
  }

  // 現在の並び順のまま(並べ替えず)時刻を計算し lastSchedule / matrixInfo に反映する。
  function applySchedule(info) {
    lastSchedule = L.scheduleRoute({
      departure: state.departure,
      departTime: state.departTime,
      mode: state.mode,
      returnToStart: state.returnToStart,
      places: state.places,
      matrix: info.matrix
    });
    matrixInfo = { label: info.label, approximate: info.approximate };
  }

  // 現在の並び順(手動調整済み)を守ったまま時刻だけ再計算する。
  // optimize と違い state.places を並べ替えず、manualOrder も true のまま維持する。
  function recalcSchedule() {
    updateFromInputs();
    if (!isFinite(state.departure.lat) || !isFinite(state.departure.lng)) {
      setMessage('出発地の緯度経度を指定してください。');
      return;
    }
    if (!state.places.length) {
      setMessage('場所を追加してください。');
      return;
    }
    setMessage('計算中です。');
    setCalcBusy(true);
    buildMatrix().then(function (info) {
      applySchedule(info);
      save();
      setMessage('この並び順で計算しました。');
      render();
    }).catch(function (err) {
      setMessage('計算に失敗しました: ' + (err && err.message ? err.message : String(err)));
    }).finally(function () {
      setCalcBusy(false);
    });
  }

  // 起動時に現在の順序のまま自動計算する(順序は変えない・ネットワーク不使用)。
  // 表示のためだけの計算なので updatedAt を動かさないよう save は呼ばない。
  function autoSchedule() {
    if (!state.places.length) return;
    if (!isFinite(state.departure.lat) || !isFinite(state.departure.lng)) return;
    applySchedule(buildMatrixFromCache());
  }

  function bind() {
    $('departureSearchBtn').addEventListener('click', function () { searchPlace('departure'); });
    $('placeSearchBtn').addEventListener('click', function () { searchPlace('place'); });
    $('addCoordBtn').addEventListener('click', function () {
      var coord = L.normalizeLatLng($('placeSearch').value);
      if (!coord) {
        setMessage('「緯度,経度」の形式で入力してください。');
        return;
      }
      addPlace({ name: $('placeSearch').value.trim(), lat: coord.lat, lng: coord.lng });
    });
    $('geoBtn').addEventListener('click', function () {
      if (!navigator.geolocation) {
        setMessage('現在地を取得できない環境です。');
        return;
      }
      navigator.geolocation.getCurrentPosition(function (pos) {
        state.departure = { name: '現在地', lat: pos.coords.latitude, lng: pos.coords.longitude };
        save();
        render();
      }, function () {
        setMessage('現在地を取得できませんでした。');
      });
    });
    $('optimizeBtn').addEventListener('click', optimize);
    $('scheduleBtn').addEventListener('click', recalcSchedule);
    $('clearBtn').addEventListener('click', function () {
      if (!confirm('保存データを全て消去しますか。')) return;
      localStorage.removeItem(STORAGE_KEY);
      state.places = [];
      lastSchedule = null;
      save();
      render();
    });
    $('exportBtn').addEventListener('click', function () {
      updateFromInputs();
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'meguri-plan.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('importInput').addEventListener('change', function (event) {
      var file = event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var next = JSON.parse(String(reader.result));
          state = L.normalizePlan(next, DEFAULT_PLAN);
          lastSchedule = null;
          save();
          render();
        } catch (e) {
          setMessage('JSON を読み込めませんでした。');
        }
      };
      reader.readAsText(file);
    });
    document.querySelectorAll('[data-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.mode = button.getAttribute('data-mode');
        lastSchedule = null;
        save();
        render();
      });
    });
    ['departureName', 'departureLat', 'departureLng', 'departTime', 'returnToStart'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        updateFromInputs();
        lastSchedule = null;
        save();
        render();
      });
    });
    $('timeline').addEventListener('click', function (event) {
      var target = event.target;
      if (target.hasAttribute('data-up')) movePlace(Number(target.getAttribute('data-up')), -1);
      if (target.hasAttribute('data-down')) movePlace(Number(target.getAttribute('data-down')), 1);
      if (target.hasAttribute('data-del')) deletePlace(Number(target.getAttribute('data-del')));
    });
    $('timeline').addEventListener('change', function (event) {
      var target = event.target;
      var index = Number(target.getAttribute('data-index'));
      var field = target.getAttribute('data-field');
      if (!field || !state.places[index]) return;
      var value = target.value;
      if (field === 'lat' || field === 'lng') {
        var coord = Number(value);
        if (!value.trim() || !isFinite(coord)) {
          render();
          return;
        }
        state.places[index][field] = coord;
      } else if (field === 'stayMin') {
        var stay = Number(value);
        if (!value.trim() || !isFinite(stay) || stay < 0) {
          render();
          return;
        }
        state.places[index][field] = Math.round(stay);
      } else if (field === 'open' || field === 'close') {
        state.places[index][field] = value || null;
      } else {
        state.places[index][field] = String(value);
      }
      state.manualOrder = true;
      lastSchedule = null;
      save();
      render();
    });
  }

  load();
  document.addEventListener('DOMContentLoaded', function () {
    bind();
    autoSchedule();
    render();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  });
})();
