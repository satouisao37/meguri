'use strict';

(function (global) {
  var L = global.MeguriLogic;
  var CACHE_KEY_PREFIX = 'meguri.osrm.v1.';
  var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function roundCoord(value) {
    return Number(value).toFixed(4);
  }

  function matrixCacheKey(points) {
    var parts = [];
    for (var i = 0; i < points.length; i++) {
      parts.push(roundCoord(points[i].lng) + ',' + roundCoord(points[i].lat));
    }
    return CACHE_KEY_PREFIX + parts.join(';');
  }

  function readCache(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var item = JSON.parse(raw);
      if (!item || !item.savedAt || !item.matrix) return null;
      if (Date.now() - item.savedAt > CACHE_TTL_MS) return null;
      return item.matrix;
    } catch (e) {
      return null;
    }
  }

  function writeCache(key, matrix) {
    try {
      pruneExpiredCache();
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), matrix: matrix }));
    } catch (e) {}
  }

  function pruneExpiredCache() {
    var now = Date.now();
    var remove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf(CACHE_KEY_PREFIX) !== 0) continue;
      try {
        var item = JSON.parse(localStorage.getItem(key));
        if (!item || !item.savedAt || now - item.savedAt > CACHE_TTL_MS) remove.push(key);
      } catch (e) {
        remove.push(key);
      }
    }
    for (var r = 0; r < remove.length; r++) localStorage.removeItem(remove[r]);
  }

  function searchNominatim(query) {
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=ja&q=' + encodeURIComponent(query);
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (response) {
      if (!response.ok) throw new Error('地名検索に失敗しました');
      return response.json();
    }).then(function (items) {
      return items.map(function (item) {
        return {
          name: item.display_name,
          lat: Number(item.lat),
          lng: Number(item.lon)
        };
      }).filter(function (item) {
        return isFinite(item.lat) && isFinite(item.lng);
      });
    });
  }

  function fetchOsrmMatrix(points) {
    // 地点を座標で正準化した順に並べてキー生成・フェッチする(配列順に依存しないキャッシュ)。
    // 保存する行列も正準順。返す直前に要求順(points の並び)へ並べ戻す。
    var order = L.canonicalOrder(points);
    var canon = order.map(function (i) { return points[i]; });
    var key = matrixCacheKey(canon);
    var cached = readCache(key);
    if (cached && cached.length === canon.length) {
      return Promise.resolve({ matrix: L.permuteMatrix(cached, order), source: 'cache', approximate: false });
    }
    var coords = canon.map(function (p) {
      return roundCoord(p.lng) + ',' + roundCoord(p.lat);
    }).join(';');
    var url = 'https://router.project-osrm.org/table/v1/driving/' + coords + '?annotations=duration';
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('OSRM の取得に失敗しました');
      return response.json();
    }).then(function (json) {
      if (!json || json.code !== 'Ok' || !json.durations) throw new Error('OSRM の応答が不正です');
      var matrix = json.durations.map(function (row) {
        return row.map(function (sec) {
          return sec === null ? null : Math.max(0, sec / 60);
        });
      });
      writeCache(key, matrix);
      return { matrix: L.permuteMatrix(matrix, order), source: 'osrm', approximate: false };
    });
  }

  // フェッチせずキャッシュだけを読む(起動時の自動計算用)。ヒットすれば要求順へ
  // 並べ戻した行列、無ければ null。ネットワークは一切叩かない。
  function readOsrmMatrix(points) {
    var order = L.canonicalOrder(points);
    var canon = order.map(function (i) { return points[i]; });
    var cached = readCache(matrixCacheKey(canon));
    if (cached && cached.length === canon.length) return L.permuteMatrix(cached, order);
    return null;
  }

  global.MeguriNet = {
    searchNominatim: searchNominatim,
    fetchOsrmMatrix: fetchOsrmMatrix,
    readOsrmMatrix: readOsrmMatrix,
    matrixCacheKey: matrixCacheKey
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
