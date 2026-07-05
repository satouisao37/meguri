'use strict';

ObjC.import('Foundation');
ObjC.import('stdlib');

function readText(path) {
  return $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
}

new Function(readText('js/logic.js'))();

var L = globalThis.MeguriLogic;
var failures = 0;

function assert(name, condition) {
  if (!condition) {
    failures++;
    console.log('NG: ' + name);
  } else {
    console.log('OK: ' + name);
  }
}

function near(name, actual, expected, tolerance) {
  assert(name + ' actual=' + actual + ' expected=' + expected, Math.abs(actual - expected) <= tolerance);
}

var kyoto = { name: '京都駅', lat: 34.9858, lng: 135.7588 };
var kiyomizu = { id: 'p1', name: '清水寺', lat: 34.9949, lng: 135.7850, desired: '10:00', stayMin: 60, memo: '' };
var nijo = { id: 'p2', name: '二条城', lat: 35.0142, lng: 135.7480, desired: '09:15', stayMin: 30, memo: '' };
var arashiyama = { id: 'p3', name: '嵐山', lat: 35.0094, lng: 135.6668, desired: null, stayMin: 45, memo: '' };

near('京都駅から清水寺の距離', L.haversineKm(kyoto, kiyomizu), 2.6, 0.4);
near('近距離公共交通は徒歩式', L.transitEstimateMin(kyoto, { lat: 34.9868, lng: 135.7598 }), 1.9, 1.0);
near('車フォールバック式', L.carFallbackMin(kyoto, kiyomizu), 14.2, 3.0);
assert('時刻パース', L.timeToMin('09:05') === 545);
assert('時刻フォーマット', L.minToTime(24 * 60 + 75) === '01:15');
assert('緯度経度入力を解釈', L.normalizeLatLng('35.0, 135.5').lat === 35);
assert('不正緯度経度は null', L.normalizeLatLng('999, 135') === null);

var matrix = [
  [0, 20, 10, 60],
  [20, 0, 35, 50],
  [10, 35, 0, 45],
  [60, 50, 45, 0]
];

var schedule = L.scheduleRoute({
  departure: kyoto,
  departTime: '09:00',
  mode: 'car',
  returnToStart: true,
  matrix: matrix,
  places: [kiyomizu, nijo]
});

assert('早着時は待機を記録', schedule.stops[0].waitMin === 40);
assert('滞在開始は希望時刻', schedule.stops[0].start === '10:00');
assert('遅刻を記録', schedule.stops[1].lateMin === 140);
assert('帰路を総移動に含める', schedule.totalTravelMin === 65);
assert('帰着時刻を計算', schedule.finishTime === '12:15');

var optimized = L.optimizeRoute({
  departure: kyoto,
  departTime: '09:00',
  mode: 'car',
  returnToStart: false,
  matrix: matrix,
  places: [kiyomizu, nijo, arashiyama],
  seed: 7
});

assert('最適化成功', optimized.ok === true);
assert('希望時刻を考慮して二条城を先にする', optimized.places[0].id === 'p2');
assert('全順列のスケジュールを返す', optimized.schedule.stops.length === 3);
assert('並べ替え後も行列インデックスを維持', optimized.schedule.legs[0].travelMin === 10);

var many = [];
for (var i = 0; i < 16; i++) {
  many.push({ id: 'x' + i, name: '地点' + i, lat: 35 + i * 0.001, lng: 135, desired: null, stayMin: 10, memo: '' });
}
assert('16件は拒否', L.optimizeRoute({ departure: kyoto, places: many }).ok === false);

var normalized = L.normalizePlan({
  mode: 'walk',
  returnToStart: true,
  places: [
    { id: 9, name: 123, lat: '35.1', lng: '135.1', desired: '9:00', stayMin: -5, memo: 456 },
    { name: '欠落', lat: '', lng: 135, desired: '10:00', stayMin: 20 },
    { name: '有効', lat: 35.2, lng: 135.2, desired: '10:30', stayMin: '40', memo: null }
  ]
}, {
  departure: kyoto,
  departTime: '08:00',
  mode: 'transit',
  returnToStart: false,
  manualOrder: false,
  updatedAt: 'default'
});

assert('normalizePlan は不正 mode を car にする', normalized.mode === 'car');
assert('normalizePlan は既定出発地を補完', normalized.departure.name === '京都駅');
assert('normalizePlan は不正地点を除外', normalized.places.length === 2);
assert('normalizePlan は name と memo を文字列化', normalized.places[0].name === '123' && normalized.places[0].memo === '456');
assert('normalizePlan は不正 desired を null にする', normalized.places[0].desired === null);
assert('normalizePlan は stayMin を既定値にする', normalized.places[0].stayMin === 60);
assert('normalizePlan は有効 desired と stayMin を維持', normalized.places[1].desired === '10:30' && normalized.places[1].stayMin === 40);

var filled = L.normalizePlan({ places: [] }, { departure: kyoto, departTime: '08:00', mode: 'transit', places: [kiyomizu] });
assert('normalizePlan は top-level 欠損キーを補完', filled.departTime === '08:00' && filled.mode === 'transit' && filled.departure.name === '京都駅');

if (failures) {
  console.log('失敗: ' + failures);
  $.exit(1);
}
console.log('logic tests passed');
