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
assert('短い display_name はそのまま', L.shortenDisplayName('京都駅') === '京都駅');
var shortenedMulti = L.shortenDisplayName('清水寺, 東山区, 京都市, 京都府, 日本');
assert('長い display_name は24字以内', shortenedMulti.length <= 24);
assert('長い display_name は先頭セグメントを残す', shortenedMulti.indexOf('清水寺') === 0);
var shortenedOne = L.shortenDisplayName('とても長い名前の観光施設と展示エリア全体を含む複合施設');
assert('1セグメント超長は省略記号付き24字', shortenedOne.length === 24 && shortenedOne.slice(-1) === '…');
assert('空 display_name は空文字', L.shortenDisplayName('  ') === '' && L.shortenDisplayName(null) === '');

// nominatimViewbox: 出発地中心の soft bias 矩形(<x1>,<y1>,<x2>,<y2> = 経度,緯度,経度,緯度 の左上→右下)
var vb = L.nominatimViewbox(34.9858, 135.7588, 0.75);
var vbParts = vb.split(',');
assert('viewbox は4値', vbParts.length === 4);
assert('viewbox 左上経度 = 中心-半辺', vbParts[0] === (135.7588 - 0.75).toFixed(5));
assert('viewbox 左上緯度 = 中心+半辺', vbParts[1] === (34.9858 + 0.75).toFixed(5));
assert('viewbox 右下経度 = 中心+半辺', vbParts[2] === (135.7588 + 0.75).toFixed(5));
assert('viewbox 右下緯度 = 中心-半辺', vbParts[3] === (34.9858 - 0.75).toFixed(5));
assert('不正座標の viewbox は空文字', L.nominatimViewbox(NaN, 135, 0.75) === '' && L.nominatimViewbox(35, 'x', 0.75) === '');
assert('halfDeg<=0 は既定0.75にフォールバック', L.nominatimViewbox(35, 135, 0).split(',')[2] === (135 + 0.75).toFixed(5));
var vbClamp = L.nominatimViewbox(89.8, 179.9, 0.75).split(',');
assert('緯度は90でクランプ', vbClamp[1] === '90.00000');
assert('経度は180でクランプ', vbClamp[2] === '180.00000');

// errorText: catch のエラー詳細を日本語で整形(message 優先 / ネットワーク失敗を平易化 / 空は既定文言)
assert('errorText は message を優先', L.errorText(new Error('OSRM の取得に失敗しました')) === 'OSRM の取得に失敗しました');
assert('errorText は Error でない throw 値を String 化', L.errorText('生の文字列エラー') === '生の文字列エラー');
assert('errorText は Failed to fetch を平易化', L.errorText(new TypeError('Failed to fetch')).indexOf('ネットワーク') === 0);
assert('errorText は Load failed を平易化', L.errorText(new TypeError('Load failed')).indexOf('ネットワーク') === 0);
assert('errorText は null を不明なエラーに', L.errorText(null) === '不明なエラー');
assert('errorText は空 message の Error を不明なエラーに', L.errorText(new Error('')) === '不明なエラー');

// projectGeoPoints: ミニ地図の歪み補正(cos緯度アスペクト保持＋レターボックス中央寄せ)
var mapOpts = { width: 420, height: 220, pad: 36 };  // availW=348, availH=148, 中心=(210,110)
// 補正後 lngGeoSpan == latSpan になる経度を作ると、画面上の外接矩形は正方形(=アスペクト保持)になる
var mapMidCos = Math.cos(34.5 * Math.PI / 180);
var sq = L.projectGeoPoints([{ lat: 34, lng: 135 }, { lat: 35, lng: 135 + 1 / mapMidCos }], mapOpts);
near('射影 アスペクト保持: 補正後正方形は画面でも縦横同幅', Math.abs(sq.coords[1].x - sq.coords[0].x), Math.abs(sq.coords[0].y - sq.coords[1].y), 0.5);
near('射影 中央寄せ: 横中心=width/2', (sq.coords[0].x + sq.coords[1].x) / 2, 210, 0.5);
near('射影 中央寄せ: 縦中心=height/2', (sq.coords[0].y + sq.coords[1].y) / 2, 110, 0.5);
// 縦が支配的な配置: 高さいっぱい(上端=pad, 下端=height-pad)に伸び、横はレターボックス中央寄せ
var tall = L.projectGeoPoints([{ lat: 34, lng: 135 }, { lat: 35, lng: 135.1 }], mapOpts);
near('射影 縦支配: 下端=height-pad', tall.coords[0].y, 184, 0.5);
near('射影 縦支配: 上端=pad', tall.coords[1].y, 36, 0.5);
near('射影 縦支配: 横は中央寄せ', (tall.coords[0].x + tall.coords[1].x) / 2, 210, 0.5);
// 退化ケース
var same = L.projectGeoPoints([{ lat: 35, lng: 135 }, { lat: 35, lng: 135 }], mapOpts);
near('射影 退化: 同一2点はキャンバス中央X', same.coords[0].x, 210, 0.5);
near('射影 退化: 同一2点はキャンバス中央Y', same.coords[0].y, 110, 0.5);
var vert = L.projectGeoPoints([{ lat: 34, lng: 135 }, { lat: 35, lng: 135 }], mapOpts);
near('射影 退化: 縦一直線は横中央', vert.coords[0].x, 210, 0.5);
assert('射影 2点未満は null', L.projectGeoPoints([{ lat: 35, lng: 135 }]) === null);
assert('射影 不正座標は null', L.projectGeoPoints([{ lat: NaN, lng: 135 }, { lat: 35, lng: 135 }]) === null);
assert('射影 null 入力は null', L.projectGeoPoints(null) === null);

// undoToastText: 削除取り消しトーストの文言(名前入り / 残件数 / 空名 / 長名短縮)
assert('undoToastText 名前入り単件', L.undoToastText('清水寺', 0) === '「清水寺」を削除しました');
assert('undoToastText 残件付き', L.undoToastText('二条城', 2) === '「二条城」を削除しました(ほか2件)');
assert('undoToastText 空名は場所', L.undoToastText('', 0) === '「場所」を削除しました' && L.undoToastText(null, 0) === '「場所」を削除しました');
var longName = L.undoToastText('あいうえおかきくけこさしすせそたちつてとなにぬねの', 0);
assert('undoToastText 長名は19字+…', longName === '「あいうえおかきくけこさしすせそたちつて…」を削除しました');
assert('undoToastText 負の残件は0扱い', L.undoToastText('嵐山', -3) === '「嵐山」を削除しました');

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

var desiredWindow = L.resolveWindow({ desired: '10:00' }, L.timeToMin('09:00'));
assert('resolveWindow は desired を幅ゼロ窓にする', desiredWindow.open === 600 && desiredWindow.close === 600);
var wrappedWindow = L.resolveWindow({ open: '23:30', close: '01:00' }, L.timeToMin('23:00'));
assert('resolveWindow は深夜跨ぎ窓を解決する', wrappedWindow.open === 1410 && wrappedWindow.close === 1500);

var earlyWindow = L.scheduleRoute({
  departure: kyoto,
  departTime: '08:00',
  mode: 'car',
  matrix: [[0, 30], [30, 0]],
  places: [{ id: 'w1', name: '窓', lat: 35, lng: 135, open: '09:00', close: '17:00', stayMin: 0, memo: '' }]
});
assert('窓の開始前到着は待機する', earlyWindow.stops[0].waitMin === 30 && earlyWindow.stops[0].lateMin === 0);
var lateWindow = L.scheduleRoute({
  departure: kyoto,
  departTime: '08:00',
  mode: 'car',
  matrix: [[0, 570], [570, 0]],
  places: [{ id: 'w2', name: '窓', lat: 35, lng: 135, open: '09:00', close: '17:00', stayMin: 0, memo: '' }]
});
assert('窓の終了後到着は遅刻する', lateWindow.stops[0].waitMin === 0 && lateWindow.stops[0].lateMin === 30);
var inWindow = L.scheduleRoute({
  departure: kyoto,
  departTime: '08:00',
  mode: 'car',
  matrix: [[0, 240], [240, 0]],
  places: [{ id: 'w3', name: '窓', lat: 35, lng: 135, open: '09:00', close: '17:00', stayMin: 0, memo: '' }]
});
assert('窓の範囲内到着は待機も遅刻もない', inWindow.stops[0].waitMin === 0 && inWindow.stops[0].lateMin === 0);

var overClose = L.scheduleRoute({
  departure: kyoto,
  departTime: '08:00',
  mode: 'car',
  matrix: [[0, 480], [480, 0]],
  places: [{ id: 'c1', name: '閉店超過', lat: 35, lng: 135, open: '09:00', close: '17:00', stayMin: 90, memo: '' }]
});
assert('到着は間に合うが滞在が閉店を超える', overClose.stops[0].stayEndsAfterClose === true);
assert('閉店後到着は滞在超過扱いにしない', lateWindow.stops[0].stayEndsAfterClose === false);
assert('閉店前に出る場合は滞在超過にしない', inWindow.stops[0].stayEndsAfterClose === false);

assert('formatClock 当日は素の時刻', L.formatClock(90) === '01:30');
assert('formatClock 23:59 境界', L.formatClock(1439) === '23:59');
assert('formatClock 翌0時', L.formatClock(1440) === '翌 00:00');
assert('formatClock 翌日は翌付き', L.formatClock(1440 + 90) === '翌 01:30');
assert('formatClock 2日後は+2日', L.formatClock(2 * 1440 + 90) === '+2日 01:30');

var lateNight = L.scheduleRoute({
  departure: kyoto,
  departTime: '23:00',
  mode: 'car',
  returnToStart: false,
  matrix: [[0, 120], [120, 0]],
  places: [{ id: 'p1', name: '清水寺', lat: 34.9949, lng: 135.7850, desired: null, stayMin: 30, memo: '' }]
});
assert('日跨ぎ到着に翌が付く', lateNight.stops[0].arrival === '翌 01:00');
assert('日跨ぎ出発に翌が付く', lateNight.stops[0].depart === '翌 01:30');
assert('日跨ぎ帰着に翌が付く', lateNight.finishTime === '翌 01:30');

var cpoints = [
  { lat: 34, lng: 135.7 },
  { lat: 35, lng: 135.5 },
  { lat: 34, lng: 135.6 }
];
var cOrder = L.canonicalOrder(cpoints);
assert('canonicalOrder は経度昇順', JSON.stringify(cOrder) === JSON.stringify([1, 2, 0]));
var cReversed = [cpoints[2], cpoints[0], cpoints[1]];
var seq1 = cOrder.map(function (i) { return cpoints[i].lng + ',' + cpoints[i].lat; });
var seq2 = L.canonicalOrder(cReversed).map(function (i) { return cReversed[i].lng + ',' + cReversed[i].lat; });
assert('正準列は入力順に非依存', JSON.stringify(seq1) === JSON.stringify(seq2));

var canonM = [
  [22, 20, 21],
  [2, 0, 1],
  [12, 10, 11]
];
var permuted = L.permuteMatrix(canonM, [2, 0, 1]);
assert('permuteMatrix は要求順へ並べ戻す', JSON.stringify(permuted) === JSON.stringify([[0, 1, 2], [10, 11, 12], [20, 21, 22]]));
assert('permuteMatrix は null を保持', L.permuteMatrix([[0, null], [null, 0]], [1, 0])[0][1] === null);

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

var closeAvoid = L.optimizeRoute({
  departure: kyoto,
  departTime: '09:00',
  mode: 'car',
  returnToStart: false,
  matrix: [
    [0, 30, 10],
    [30, 0, 10],
    [10, 60, 0]
  ],
  places: [
    { id: 'a', name: '早く閉まる場所', lat: 35.0, lng: 135.0, open: null, close: '10:00', stayMin: 0, memo: '' },
    { id: 'b', name: '先に行くと危険な場所', lat: 35.1, lng: 135.1, open: null, close: null, stayMin: 60, memo: '' }
  ]
});
assert('閉店に間に合う順序を優先する', closeAvoid.places[0].id === 'a' && closeAvoid.schedule.stops[0].lateMin === 0);

function enc(p) {
  return encodeURIComponent(p.lat + ',' + p.lng);
}

var routeUrl = L.buildRouteUrl({ departure: kyoto, places: [kiyomizu, nijo, arashiyama], returnToStart: false, mode: 'car' });
assert('全行程URLは api=1 の driving', routeUrl.indexOf('api=1') !== -1 && routeUrl.indexOf('travelmode=driving') !== -1);
assert('全行程URLの出発地は origin', routeUrl.indexOf('origin=' + enc(kyoto)) !== -1);
assert('全行程URLの目的地は最終訪問地', routeUrl.indexOf('destination=' + enc(arashiyama)) !== -1);
assert('全行程URLの経由地は中間地点', routeUrl.indexOf('waypoints=' + enc(kiyomizu) + '%7C' + enc(nijo)) !== -1);

var loopUrl = L.buildRouteUrl({ departure: kyoto, places: [kiyomizu, nijo, arashiyama], returnToStart: true, mode: 'car' });
assert('帰路ありは目的地が出発地', loopUrl.indexOf('destination=' + enc(kyoto)) !== -1);
assert('帰路ありは全訪問地が経由地', loopUrl.indexOf('waypoints=' + enc(kiyomizu) + '%7C' + enc(nijo) + '%7C' + enc(arashiyama)) !== -1);

var oneUrl = L.buildRouteUrl({ departure: kyoto, places: [kiyomizu], returnToStart: false, mode: 'car' });
assert('単一地点は waypoints 無し', oneUrl.indexOf('waypoints=') === -1 && oneUrl.indexOf('destination=' + enc(kiyomizu)) !== -1);

var transitUrl = L.buildRouteUrl({ departure: kyoto, places: [kiyomizu], mode: 'transit' });
assert('公共交通は travelmode=transit', transitUrl.indexOf('travelmode=transit') !== -1);

var overWaypoints = [];
for (var w = 0; w < 11; w++) {
  overWaypoints.push({ id: 'w' + w, name: 'w' + w, lat: 35 + w * 0.01, lng: 135, desired: null, stayMin: 10, memo: '' });
}
assert('経由地9件は全行程URLを作る', L.buildRouteUrl({ departure: kyoto, places: overWaypoints.slice(0, 10), returnToStart: false, mode: 'car' }) !== null);
assert('経由地10件は全行程URLを作らない', L.buildRouteUrl({ departure: kyoto, places: overWaypoints, returnToStart: false, mode: 'car' }) === null);
assert('訪問地が無ければ null', L.buildRouteUrl({ departure: kyoto, places: [], mode: 'car' }) === null);

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
assert('normalizePlan は不正 desired を null 窓にする', normalized.places[0].open === null && normalized.places[0].close === null);
assert('normalizePlan は stayMin を既定値にする', normalized.places[0].stayMin === 60);
assert('normalizePlan は有効 desired を open/close に移行する', normalized.places[1].open === '10:30' && normalized.places[1].close === '10:30' && !('desired' in normalized.places[1]));
assert('normalizePlan は有効 stayMin を維持', normalized.places[1].stayMin === 40);

var legacyPlan = {
  departure: kyoto,
  departTime: '09:00',
  mode: 'car',
  places: [{ id: 'legacy', name: '旧形式', lat: 35, lng: 135, desired: '10:00', stayMin: 20, memo: '' }]
};
var legacySchedule = L.scheduleRoute({
  departure: legacyPlan.departure,
  departTime: legacyPlan.departTime,
  mode: legacyPlan.mode,
  matrix: [[0, 30], [30, 0]],
  places: legacyPlan.places
});
var migratedPlan = L.normalizePlan(legacyPlan, { departure: kyoto, departTime: '08:00', mode: 'transit' });
var migratedSchedule = L.scheduleRoute({
  departure: migratedPlan.departure,
  departTime: migratedPlan.departTime,
  mode: migratedPlan.mode,
  matrix: [[0, 30], [30, 0]],
  places: migratedPlan.places
});
assert('旧 desired プランは open/close に移行して desired を持たない', migratedPlan.places[0].open === '10:00' && migratedPlan.places[0].close === '10:00' && !('desired' in migratedPlan.places[0]));
assert('旧 desired プランの移行前後でスコアが一致する', legacySchedule.score === migratedSchedule.score);

var filled = L.normalizePlan({ places: [] }, { departure: kyoto, departTime: '08:00', mode: 'transit', places: [kiyomizu] });
assert('normalizePlan は top-level 欠損キーを補完', filled.departTime === '08:00' && filled.mode === 'transit' && filled.departure.name === '京都駅');

var storeDefaults = { departure: kyoto, departTime: '09:00', mode: 'car', places: [] };

var planStore = L.normalizePlanStore({
  activeId: 'b',
  plans: [
    { id: 'a', title: '1日目', departure: kyoto, departTime: '09:00', mode: 'car', places: [kiyomizu] },
    { id: 'b', title: '2日目', departure: kyoto, departTime: '10:00', mode: 'transit', places: [nijo] }
  ]
}, storeDefaults);
assert('容器は version 2', planStore.version === 2);
assert('容器は plans を正規化', planStore.plans.length === 2 && planStore.plans[0].places[0].id === 'p1');
assert('容器は activeId を保持', planStore.activeId === 'b');
assert('容器は title を保持', planStore.plans[1].title === '2日目');

var badActive = L.normalizePlanStore({ activeId: 'zzz', plans: [{ id: 'a', title: 'x', departure: kyoto, places: [] }] }, storeDefaults);
assert('不正 activeId は先頭にフォールバック', badActive.activeId === 'a');

var emptyStore = L.normalizePlanStore({ plans: [] }, storeDefaults);
assert('空 plans は1件補完', emptyStore.plans.length === 1 && emptyStore.activeId === emptyStore.plans[0].id);
assert('補完プランは決定的 id/title', emptyStore.plans[0].id === 'pl0' && emptyStore.plans[0].title === 'プラン1');

var legacyV1 = { departure: kyoto, departTime: '08:30', mode: 'transit', returnToStart: true, manualOrder: true, places: [{ id: 'x1', name: 'A', lat: 35, lng: 135, open: '09:00', close: '17:00', stayMin: 40, memo: 'm' }] };
var migratedStore = L.normalizePlanStore(legacyV1, storeDefaults);
assert('旧 v1 単一プランを1プランに包む', migratedStore.version === 2 && migratedStore.plans.length === 1);
assert('移行後 activeId は包んだプラン', migratedStore.activeId === migratedStore.plans[0].id);
var mp = migratedStore.plans[0];
assert('移行でプラン全フィールドを保持', mp.departTime === '08:30' && mp.mode === 'transit' && mp.returnToStart === true && mp.places[0].open === '09:00' && mp.places[0].close === '17:00' && mp.places[0].stayMin === 40);

if (failures) {
  console.log('失敗: ' + failures);
  $.exit(1);
}
console.log('logic tests passed');
