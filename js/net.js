'use strict';

(function (global) {
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
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), matrix: matrix }));
    } catch (e) {}
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
    var key = matrixCacheKey(points);
    var cached = readCache(key);
    if (cached) return Promise.resolve({ matrix: cached, source: 'cache', approximate: false });
    var coords = points.map(function (p) {
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
      return { matrix: matrix, source: 'osrm', approximate: false };
    });
  }

  global.MeguriNet = {
    searchNominatim: searchNominatim,
    fetchOsrmMatrix: fetchOsrmMatrix,
    matrixCacheKey: matrixCacheKey
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
