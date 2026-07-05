'use strict';

(function (global) {
  var MAX_OPTIMIZE_PLACES = 15;
  var MIN_PER_DAY = 1440;

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

  function minToTime(total) {
    total = Math.round(clampNumber(total, 0));
    var day = ((total % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
    var h = Math.floor(day / 60);
    var m = day % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
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
      var desired = timeToMin(places[i].desired);
      if (desired !== null && desired < departMin - 720) desired += MIN_PER_DAY;
      var wait = desired !== null ? Math.max(0, desired - arrival) : 0;
      var late = desired !== null ? Math.max(0, arrival - desired) : 0;
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
        arrival: minToTime(arrival),
        start: minToTime(start),
        depart: minToTime(depart),
        waitMin: Math.round(wait),
        lateMin: Math.round(late),
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
      finishTime: minToTime(current),
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
    while (remaining.length) {
      var bestAt = 0;
      var bestCost = Infinity;
      for (var r = 0; r < remaining.length; r++) {
        var idx = remaining[r];
        var cost = durationFromMatrix(matrix, from, idx + 1, buildPointList(departure, places), input.mode);
        if (places[idx].desired) {
          var desired = timeToMin(places[idx].desired);
          if (desired !== null) cost += desired * 0.001;
        }
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

  function normalizeLatLng(text) {
    var m = String(text || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    var lat = Number(m[1]);
    var lng = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  global.MeguriLogic = {
    MAX_OPTIMIZE_PLACES: MAX_OPTIMIZE_PLACES,
    haversineKm: haversineKm,
    transitEstimateMin: transitEstimateMin,
    carFallbackMin: carFallbackMin,
    timeToMin: timeToMin,
    minToTime: minToTime,
    estimateMatrix: estimateMatrix,
    scheduleRoute: scheduleRoute,
    optimizeRoute: optimizeRoute,
    normalizeLatLng: normalizeLatLng
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
