'use strict';

(function (global) {
  var MAX_OPTIMIZE_PLACES = 15;
  var MIN_PER_DAY = 1440;
  // Google マップ api=1 の directions URL が受け付ける経由地(waypoints)の上限
  var MAX_WAYPOINTS = 9;

  function clampNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function toRad(deg) {
    return deg * Math.PI / 180;
  }

  function haversineKm(a, b) {
    var lat1 = toRad(clampNumber(a.lat, 0));
    var lat2 = toRad(clampNumber(b.lat, 0));
    var dLat = lat2 - lat1;
    var dLng = toRad(clampNumber(b.lng, 0) - clampNumber(a.lng, 0));
    var s1 = Math.sin(dLat / 2);
    var s2 = Math.sin(dLng / 2);
    var h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function transitEstimateMin(a, b) {
    var d = haversineKm(a, b);
    if (d <= 0.9) return d / 4.5 * 60;
    return 12 + d / 20 * 60;
  }

  function carFallbackMin(a, b) {
    var d = haversineKm(a, b);
    var v = d < 3 ? 22 : (d < 15 ? 32 : 55);
    return 5 + (d * 1.3) / v * 60;
  }

  function timeToMin(value) {
    if (value === null || value === undefined || value === '') return null;
    var m = String(value).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h < 0 || h > 47 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  function resolveWindow(place, departMin) {
    var source = place || {};
    var open = timeToMin(source.open);
    var close = timeToMin(source.close);
    if (open === null && close === null && source.desired) {
      var desired = timeToMin(source.desired);
      if (desired !== null) {
        open = desired;
        close = desired;
      }
    }
    if (open !== null && open < departMin - 720) open += MIN_PER_DAY;
    if (close !== null && close < departMin - 720) close += MIN_PER_DAY;
    if (open !== null && close !== null && close < open) close += MIN_PER_DAY;
    return { open: open, close: close };
  }

  function minToTime(total) {
    total = Math.round(clampNumber(total, 0));
    var day = ((total % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
    var h = Math.floor(day / 60);
    var m = day % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // 絶対分を表示用時刻にする。日を跨ぐとき(翌日以降)は「翌 HH:MM」「+N日 HH:MM」を付けて
  // 帰着・到着が翌日であることを明示する(minToTime は 24h で丸めるだけで日情報を落とすため)。
  function formatClock(total) {
    var minutes = Math.round(clampNumber(total, 0));
    var time = minToTime(minutes);
    var day = Math.floor(minutes / MIN_PER_DAY);
    if (day <= 0) return time;
    if (day === 1) return '翌 ' + time;
    return '+' + day + '日 ' + time;
  }

  function durationFromMatrix(matrix, fromIndex, toIndex, points, mode) {
    if (matrix && matrix[fromIndex] && matrix[fromIndex][toIndex] !== undefined && matrix[fromIndex][toIndex] !== null) {
      return Math.max(0, clampNumber(matrix[fromIndex][toIndex], 0));
    }
    if (mode === 'transit') return transitEstimateMin(points[fromIndex], points[toIndex]);
    return carFallbackMin(points[fromIndex], points[toIndex]);
  }

  function buildPointList(departure, places) {
    var points = [departure];
    for (var i = 0; i < places.length; i++) points.push(places[i]);
    return points;
  }

  function scheduleRoute(input) {
    var departure = input.departure;
    var places = input.places || [];
    var matrix = input.matrix || null;
    var departMin = timeToMin(input.departTime) || 0;
    var mode = input.mode || 'car';
    var returnToStart = !!input.returnToStart;
    var points = buildPointList(departure, places);
    var current = departMin;
    var previousIndex = 0;
    var stops = [];
    var legs = [];
    var totalTravelMin = 0;
    var totalStayMin = 0;
    var totalWaitMin = 0;
    var totalLateMin = 0;

    for (var i = 0; i < places.length; i++) {
      var toIndex = i + 1;
      var travel = durationFromMatrix(matrix, previousIndex, toIndex, points, mode);
      var roundedTravel = Math.round(travel);
      var arrival = current + travel;
      var window = resolveWindow(places[i], departMin);
      var wait = window.open !== null ? Math.max(0, window.open - arrival) : 0;
      var late = window.close !== null ? Math.max(0, arrival - window.close) : 0;
      var start = arrival + wait;
      var stay = Math.max(0, Math.round(clampNumber(places[i].stayMin, 0)));
      var depart = start + stay;
      legs.push({
        fromIndex: previousIndex,
        toIndex: toIndex,
        fromName: previousIndex === 0 ? departure.name : places[previousIndex - 1].name,
        toName: places[i].name,
        travelMin: roundedTravel
      });
      stops.push({
        place: places[i],
        index: i,
        arrivalMin: Math.round(arrival),
        startMin: Math.round(start),
        departMin: Math.round(depart),
        arrival: formatClock(arrival),
        start: formatClock(start),
        depart: formatClock(depart),
        waitMin: Math.round(wait),
        lateMin: Math.round(late),
        openMin: window.open,
        closeMin: window.close,
        stayEndsAfterClose: window.close !== null && late === 0 && depart > window.close,
        stayMin: stay
      });
      totalTravelMin += roundedTravel;
      totalStayMin += stay;
      totalWaitMin += Math.round(wait);
      totalLateMin += Math.round(late);
      current = depart;
      previousIndex = toIndex;
    }

    var returnLeg = null;
    if (returnToStart && places.length) {
      var returnTravel = durationFromMatrix(matrix, previousIndex, 0, points, mode);
      returnLeg = {
        fromIndex: previousIndex,
        toIndex: 0,
        fromName: places[places.length - 1].name,
        toName: departure.name,
        travelMin: Math.round(returnTravel)
      };
      legs.push(returnLeg);
      totalTravelMin += Math.round(returnTravel);
      current += returnTravel;
    }

    return {
      stops: stops,
      legs: legs,
      returnLeg: returnLeg,
      departTime: minToTime(departMin),
      finishMin: Math.round(current),
      finishTime: formatClock(current),
      totalTravelMin: totalTravelMin,
      totalStayMin: totalStayMin,
      totalWaitMin: totalWaitMin,
      totalLateMin: totalLateMin,
      score: scoreSchedule(totalTravelMin, totalLateMin, totalWaitMin)
    };
  }

  function scoreSchedule(travel, late, wait) {
    return travel + 3 * late + 0.3 * wait;
  }

  function permuteIndexes(n, visitor) {
    var used = [];
    var order = [];
    function walk() {
      if (order.length === n) {
        visitor(order.slice());
        return;
      }
      for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true;
        order.push(i);
        walk();
        order.pop();
        used[i] = false;
      }
    }
    walk();
  }

  function makeRng(seed) {
    var s = (seed === undefined ? 123456789 : seed) >>> 0;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function routeFromOrder(places, order) {
    var out = [];
    for (var i = 0; i < order.length; i++) out.push(places[order[i]]);
    return out;
  }

  function evaluate(departure, places, matrix, input) {
    return scheduleRoute({
      departure: departure,
      places: places,
      matrix: matrix,
      departTime: input.departTime,
      mode: input.mode,
      returnToStart: input.returnToStart
    });
  }

  function reorderMatrix(matrix, order) {
    if (!matrix) return null;
    var map = [0];
    for (var i = 0; i < order.length; i++) map.push(order[i] + 1);
    var out = [];
    for (var r = 0; r < map.length; r++) {
      out[r] = [];
      for (var c = 0; c < map.length; c++) {
        out[r][c] = matrix[map[r]][map[c]];
      }
    }
    return out;
  }

  function evaluateOrder(departure, sourcePlaces, order, matrix, input) {
    return evaluate(departure, routeFromOrder(sourcePlaces, order), reorderMatrix(matrix, order), input);
  }

  function nearestOrder(departure, places, matrix, input, rng) {
    var remaining = [];
    for (var i = 0; i < places.length; i++) remaining.push(i);
    var order = [];
    var from = 0;
    var points = buildPointList(departure, places);
    var departMin = timeToMin(input.departTime) || 0;
    while (remaining.length) {
      var bestAt = 0;
      var bestCost = Infinity;
      for (var r = 0; r < remaining.length; r++) {
        var idx = remaining[r];
        var cost = durationFromMatrix(matrix, from, idx + 1, points, input.mode);
        var window = resolveWindow(places[idx], departMin);
        var bias = window.close !== null ? window.close : window.open;
        if (bias !== null) cost += bias * 0.001;
        cost += rng() * 0.01;
        if (cost < bestCost) {
          bestCost = cost;
          bestAt = r;
        }
      }
      var next = remaining.splice(bestAt, 1)[0];
      order.push(next);
      from = next + 1;
    }
    return order;
  }

  function improveOrder(order, departure, sourcePlaces, matrix, input) {
    var bestOrder = order.slice();
    var bestScore = evaluateOrder(departure, sourcePlaces, bestOrder, matrix, input).score;
    var changed = true;
    var guard = 0;
    while (changed && guard < 80) {
      changed = false;
      guard++;
      for (var i = 0; i < bestOrder.length - 1; i++) {
        for (var j = i + 1; j < bestOrder.length; j++) {
          var candidate = bestOrder.slice(0, i).concat(bestOrder.slice(i, j + 1).reverse(), bestOrder.slice(j + 1));
          var score = evaluateOrder(departure, sourcePlaces, candidate, matrix, input).score;
          if (score + 0.0001 < bestScore) {
            bestOrder = candidate;
            bestScore = score;
            changed = true;
          }
        }
      }
      for (var len = 1; len <= 3; len++) {
        for (var start = 0; start + len <= bestOrder.length; start++) {
          var block = bestOrder.slice(start, start + len);
          var rest = bestOrder.slice(0, start).concat(bestOrder.slice(start + len));
          for (var pos = 0; pos <= rest.length; pos++) {
            if (pos === start) continue;
            var cand = rest.slice(0, pos).concat(block, rest.slice(pos));
            var candScore = evaluateOrder(departure, sourcePlaces, cand, matrix, input).score;
            if (candScore + 0.0001 < bestScore) {
              bestOrder = cand;
              bestScore = candScore;
              changed = true;
            }
          }
        }
      }
    }
    return { order: bestOrder, score: bestScore };
  }

  function optimizeRoute(input) {
    var places = (input.places || []).slice();
    if (places.length > MAX_OPTIMIZE_PLACES) {
      return { ok: false, error: '最適化できる場所は15件までです。件数を減らしてください。' };
    }
    if (!input.departure || places.length === 0) {
      return { ok: true, places: places, schedule: evaluate(input.departure || {}, places, input.matrix || null, input) };
    }
    var matrix = input.matrix || null;
    var bestOrder = [];
    var bestScore = Infinity;
    var bestSchedule = null;

    if (places.length <= 8) {
      permuteIndexes(places.length, function (order) {
        var ordered = routeFromOrder(places, order);
        var schedule = evaluate(input.departure, ordered, reorderMatrix(matrix, order), input);
        if (schedule.score < bestScore) {
          bestScore = schedule.score;
          bestOrder = order.slice();
          bestSchedule = schedule;
        }
      });
    } else {
      var rng = makeRng(input.seed);
      for (var r = 0; r < 8; r++) {
        var start = nearestOrder(input.departure, places, matrix, input, rng);
        for (var s = start.length - 1; s > 0; s--) {
          var swap = Math.floor(rng() * (s + 1));
          var tmp = start[s];
          start[s] = start[swap];
          start[swap] = tmp;
        }
        var improved = improveOrder(start, input.departure, places, matrix, input);
        if (improved.score < bestScore) {
          bestScore = improved.score;
          bestOrder = improved.order.slice();
        }
      }
      bestSchedule = evaluateOrder(input.departure, places, bestOrder, matrix, input);
    }

    var bestPlaces = routeFromOrder(places, bestOrder);
    return {
      ok: true,
      places: bestPlaces,
      order: bestOrder,
      schedule: bestSchedule || evaluate(input.departure, bestPlaces, matrix, input)
    };
  }

  function estimateMatrix(points, mode) {
    var matrix = [];
    for (var i = 0; i < points.length; i++) {
      matrix[i] = [];
      for (var j = 0; j < points.length; j++) {
        matrix[i][j] = i === j ? 0 : (mode === 'transit' ? transitEstimateMin(points[i], points[j]) : carFallbackMin(points[i], points[j]));
      }
    }
    return matrix;
  }

  // 地点集合を座標で正準化した並び順(元インデックスの配列)を返す純粋関数。
  // 配列順に依存しない行列キャッシュキーを作るための正準順序。経度→緯度→元順で安定ソート。
  function canonicalOrder(points) {
    var order = [];
    for (var i = 0; i < points.length; i++) order.push(i);
    order.sort(function (a, b) {
      var la = clampNumber(points[a].lng, 0);
      var lb = clampNumber(points[b].lng, 0);
      if (la !== lb) return la - lb;
      var ta = clampNumber(points[a].lat, 0);
      var tb = clampNumber(points[b].lat, 0);
      if (ta !== tb) return ta - tb;
      return a - b;
    });
    return order;
  }

  // 正準順で得た行列を、元の要求順へ並べ戻す純粋関数。
  // order[c] = 要求インデックス(canon[c] = points[order[c]])。返り値 R[i][j] = dur(points[i], points[j])。
  function permuteMatrix(canonMatrix, order) {
    var n = order.length;
    var pos = [];
    for (var c = 0; c < n; c++) pos[order[c]] = c;
    var result = [];
    for (var i = 0; i < n; i++) {
      var row = [];
      var canonRow = canonMatrix[pos[i]] || [];
      for (var j = 0; j < n; j++) {
        var value = canonRow[pos[j]];
        row.push(value === undefined ? null : value);
      }
      result.push(row);
    }
    return result;
  }

  function normalizeLatLng(text) {
    var m = String(text || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    var lat = Number(m[1]);
    var lng = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  // Nominatim の長い display_name を候補表示向けに先頭セグメント中心で短くする。
  function shortenDisplayName(displayName) {
    if (typeof displayName !== 'string') return '';
    var text = displayName.trim();
    if (!text) return '';
    var limit = 24;
    var rawParts = text.split(',');
    var parts = [];
    for (var i = 0; i < rawParts.length; i++) {
      var part = rawParts[i].trim();
      if (part) parts.push(part);
    }
    if (!parts.length) return '';
    if (parts[0].length > limit) return parts[0].slice(0, limit - 1) + '…';
    var chosen = parts[0];
    for (var p = 1; p < parts.length; p++) {
      var next = chosen + ', ' + parts[p];
      if (next.length > limit) break;
      chosen = next;
    }
    return chosen;
  }

  // 出発地を中心に ±halfDeg の矩形を Nominatim の viewbox 文字列にする(soft bias 用。bounded は付けない)。
  // 形式は "<x1>,<y1>,<x2>,<y2>"(x=経度・y=緯度、左上→右下の対角2点)。緯度は[-90,90]・経度は[-180,180]でクランプ。
  // 不正座標や halfDeg<=0 は '' を返し、呼び出し側でバイアスを付けない判断ができる。
  function nominatimViewbox(lat, lng, halfDeg) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) return '';
    var h = Number(halfDeg);
    if (!isFinite(h) || h <= 0) h = 0.75;
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    var west = clamp(ln - h, -180, 180);
    var east = clamp(ln + h, -180, 180);
    var north = clamp(la + h, -90, 90);
    var south = clamp(la - h, -90, 90);
    return [west, north, east, south].map(function (v) { return v.toFixed(5); }).join(',');
  }

  function isDesiredTime(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function stringValue(value, fallback) {
    if (value === null || value === undefined) return fallback;
    return String(value);
  }

  function finiteNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function normalizePoint(raw, fallback) {
    var source = raw || {};
    var lat = finiteNumber(source.lat);
    var lng = finiteNumber(source.lng);
    if (lat === null || lng === null) {
      lat = finiteNumber(fallback && fallback.lat);
      lng = finiteNumber(fallback && fallback.lng);
    }
    if (lat === null || lng === null) return null;
    return {
      name: stringValue(source.name, stringValue(fallback && fallback.name, '出発地')),
      lat: lat,
      lng: lng
    };
  }

  function normalizePlace(raw, index) {
    var source = raw || {};
    var lat = finiteNumber(source.lat);
    var lng = finiteNumber(source.lng);
    if (lat === null || lng === null) return null;
    var stay = finiteNumber(source.stayMin);
    if (stay === null || stay < 0) stay = 60;
    var open = isDesiredTime(source.open) ? source.open : null;
    var close = isDesiredTime(source.close) ? source.close : null;
    if (open === null && close === null && isDesiredTime(source.desired)) {
      open = source.desired;
      close = source.desired;
    }
    return {
      id: stringValue(source.id, 'p' + index),
      name: stringValue(source.name, ''),
      lat: lat,
      lng: lng,
      open: open,
      close: close,
      stayMin: Math.round(stay),
      memo: stringValue(source.memo, '')
    };
  }

  // 全行程を1本の経路として開く Google マップ深リンクを組み立てる純粋関数。
  // 経由地(出発地・目的地を除く中間地点。帰路ありなら全訪問地が経由地)が
  // MAX_WAYPOINTS を超える、または訪問地が無いときは null(=全行程リンクを作らない)。
  function buildRouteUrl(opts) {
    var options = opts || {};
    var departure = options.departure;
    var places = options.places instanceof Array ? options.places : [];
    if (!departure || !places.length) return null;
    var travelMode = options.mode === 'transit' ? 'transit' : 'driving';
    var returnToStart = !!options.returnToStart;
    var destination = returnToStart ? departure : places[places.length - 1];
    var waypoints = returnToStart ? places.slice() : places.slice(0, places.length - 1);
    if (waypoints.length > MAX_WAYPOINTS) return null;
    function coord(point) {
      return encodeURIComponent(clampNumber(point.lat, 0) + ',' + clampNumber(point.lng, 0));
    }
    var url = 'https://www.google.com/maps/dir/?api=1' +
      '&origin=' + coord(departure) +
      '&destination=' + coord(destination) +
      '&travelmode=' + travelMode;
    if (waypoints.length) {
      url += '&waypoints=' + waypoints.map(coord).join('%7C');
    }
    return url;
  }

  function normalizePlan(raw, defaults) {
    var source = raw || {};
    var base = defaults || {};
    var defaultDeparture = base.departure || { name: '京都駅', lat: 34.9858, lng: 135.7588 };
    var departure = normalizePoint(source.departure, defaultDeparture) || normalizePoint(defaultDeparture, null);
    var sourcePlaces = source.places instanceof Array ? source.places : (base.places instanceof Array ? base.places : []);
    var places = [];
    for (var i = 0; i < sourcePlaces.length; i++) {
      var place = normalizePlace(sourcePlaces[i], i);
      if (place) places.push(place);
    }
    return {
      departure: departure,
      departTime: isDesiredTime(source.departTime) ? source.departTime : (isDesiredTime(base.departTime) ? base.departTime : '09:00'),
      mode: source.mode === 'transit' || source.mode === 'car' ? source.mode : (source.mode === undefined && base.mode === 'transit' ? 'transit' : 'car'),
      returnToStart: typeof source.returnToStart === 'boolean' ? source.returnToStart : !!base.returnToStart,
      places: places,
      manualOrder: typeof source.manualOrder === 'boolean' ? source.manualOrder : !!base.manualOrder,
      updatedAt: stringValue(source.updatedAt, stringValue(base.updatedAt, ''))
    };
  }

  // 単一プランに id / title を付与して容器内プランへ正規化する純粋関数。
  // 既存 normalizePlan を1プラン正規化として流用し、id/title を決定的に補完する。
  function normalizeStoredPlan(raw, index, defaults) {
    var source = raw || {};
    var base = normalizePlan(source, defaults);
    var id = stringValue(source.id, 'pl' + index);
    if (!id) id = 'pl' + index;
    var title = stringValue(source.title, '');
    if (!title) title = 'プラン' + (index + 1);
    return {
      id: id,
      title: title,
      departure: base.departure,
      departTime: base.departTime,
      mode: base.mode,
      returnToStart: base.returnToStart,
      places: base.places,
      manualOrder: base.manualOrder,
      updatedAt: base.updatedAt
    };
  }

  // 複数プラン容器 { version, activeId, plans[] } を正規化する純粋関数。
  // 容器形状は各プランを正規化(≥1件保証・activeId 整合)。単一プラン形状(旧 v1 等)は
  // 1プランに包んで返す(= meguri.plan.v1 → meguri.plans.v2 のマイグレーション)。
  // Date/乱数は使わない(決定的。id/title の生成は呼び出し側 app.js の責務)。
  function normalizePlanStore(raw, defaults) {
    var source = raw || {};
    if (source.plans instanceof Array) {
      var plans = [];
      for (var i = 0; i < source.plans.length; i++) {
        plans.push(normalizeStoredPlan(source.plans[i], i, defaults));
      }
      if (!plans.length) plans.push(normalizeStoredPlan(defaults, 0, defaults));
      var wanted = stringValue(source.activeId, '');
      var activeId = null;
      for (var j = 0; j < plans.length; j++) {
        if (plans[j].id === wanted) { activeId = wanted; break; }
      }
      if (activeId === null) activeId = plans[0].id;
      return { version: 2, activeId: activeId, plans: plans };
    }
    var one = normalizeStoredPlan(source, 0, defaults);
    return { version: 2, activeId: one.id, plans: [one] };
  }

  global.MeguriLogic = {
    MAX_OPTIMIZE_PLACES: MAX_OPTIMIZE_PLACES,
    MAX_WAYPOINTS: MAX_WAYPOINTS,
    haversineKm: haversineKm,
    transitEstimateMin: transitEstimateMin,
    carFallbackMin: carFallbackMin,
    timeToMin: timeToMin,
    minToTime: minToTime,
    formatClock: formatClock,
    resolveWindow: resolveWindow,
    estimateMatrix: estimateMatrix,
    canonicalOrder: canonicalOrder,
    permuteMatrix: permuteMatrix,
    scheduleRoute: scheduleRoute,
    optimizeRoute: optimizeRoute,
    normalizeLatLng: normalizeLatLng,
    shortenDisplayName: shortenDisplayName,
    nominatimViewbox: nominatimViewbox,
    normalizePlan: normalizePlan,
    normalizePlanStore: normalizePlanStore,
    buildRouteUrl: buildRouteUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
