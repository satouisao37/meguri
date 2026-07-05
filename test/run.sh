#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

osascript -l JavaScript <<'JXA'
ObjC.import('Foundation');
ObjC.import('stdlib');

function readText(path) {
  return $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
}

function walk(dir, out) {
  var fm = $.NSFileManager.defaultManager;
  var items = fm.contentsOfDirectoryAtPathError(dir, null);
  for (var i = 0; i < items.count; i++) {
    var name = items.objectAtIndex(i).js;
    var path = dir + '/' + name;
    var isDir = Ref();
    fm.fileExistsAtPathIsDirectory(path, isDir);
    if (isDir[0]) {
      if (name !== '.git' && name !== '.codex-runs') walk(path, out);
    } else if (/\.js$/.test(name)) {
      out.push(path.replace(/^\.\//, ''));
    }
  }
}

var files = [];
walk('.', files);
files.sort();
var failed = false;
for (var i = 0; i < files.length; i++) {
  try {
    new Function(readText(files[i]));
    console.log('構文OK: ' + files[i]);
  } catch (e) {
    console.log('構文NG: ' + files[i] + ' ' + e);
    failed = true;
  }
}
if (failed) $.exit(1);
JXA

osascript -l JavaScript test/test_logic.js
