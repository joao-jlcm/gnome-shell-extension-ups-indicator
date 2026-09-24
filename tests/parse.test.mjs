/*
 * Tests for the parser and the classification.
 * Run with plain Node: `node tests/parse.test.mjs` from the repo root.
 * The real log is used when present, but edge cases are synthetic.
 *
 * Field order (values array): vin, vout, iout, load, hz, vbat, temp, battery.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    parseRecords, latestRecord, ageSeconds, classify, stateLabel,
    STATE_LABELS, RECORD_SIZE, OFFLINE,
} from '../logReader.js';
import {formatPanelValue, PANEL_FIELDS} from '../panelValue.js';

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.log(`  FAIL ${name}\n       ${e.message}`);
        process.exitCode = 1;
    }
}

/** Builds a synthetic .rgt: 72-byte records. */
function buildLog(entries) {
    const buf = new Uint8Array(entries.length * RECORD_SIZE);
    const view = new DataView(buf.buffer);
    entries.forEach((e, i) => {
        const base = i * RECORD_SIZE;
        // the log stores local time as if it were UTC, which leaves the epoch
        // BEHIND the true epoch: raw = ts - |offset|
        view.setUint32(base, e.ts - new Date().getTimezoneOffset() * 60, true);
        view.setUint16(base + 4, 0x255, true);
        view.setUint16(base + 6, e.state, true);
        view.setUint16(base + 8, e.offline ? OFFLINE : 0xa, true);
        const v = e.values ?? [110, 118, 4, 30, 59.7, 13.1, 48, 85];
        v.forEach((val, j) => view.setFloat32(base + 12 + j * 4, val, true));
        if (e.firmware !== undefined)
            view.setFloat32(base + 44, e.firmware, true);
    });
    return buf;
}

const nowSec = Math.floor(Date.now() / 1000);

test('parse: fields in the right order', () => {
    const rec = parseRecords(buildLog([
        {ts: nowSec - 10, state: 10, values: [107, 119, 2.5, 24, 59.7, 13.4, 48, 53]},
    ]))[0];
    assert.equal(rec.values.vin, 107);
    assert.equal(rec.values.battery, 53);
    assert.equal(rec.values.temp, 48);
    assert.equal(rec.state, 10);
    assert.equal(rec.offline, false);
});

test('parse: temperature at offset 36 and battery at offset 40', () => {
    const rec = parseRecords(buildLog([
        {ts: nowSec - 5, state: 11, values: [110, 118, 4, 30, 59.7, 13.1, 48, 100]},
    ]))[0];
    assert.equal(rec.values.temp, 48);
    assert.equal(rec.values.battery, 100);
});

test('parse: empty slots (timestamp 0) are discarded', () => {
    const buf = new Uint8Array(RECORD_SIZE * 3);       // all zero
    assert.equal(parseRecords(buf).length, 0);
});

test('parse: firmware is read at offset 44', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, firmware: 1.4}]))[0];
    assert.ok(Math.abs(rec.values.firmware - 1.4) < 1e-6, `fw=${rec.values.firmware}`);
});

test('parse: sorts from oldest to newest', () => {
    const recs = parseRecords(buildLog([
        {ts: nowSec - 5, state: 11},
        {ts: nowSec - 60, state: 11},
        {ts: nowSec - 30, state: 11},
    ]));
    assert.deepEqual(recs.map(r => Math.round(r.ts / 1000)), [nowSec - 60, nowSec - 30, nowSec - 5]);
});

test('parse: a file truncated mid-record does not break', () => {
    const full = buildLog([{ts: nowSec - 5, state: 11}, {ts: nowSec - 2, state: 11}]);
    const truncated = full.slice(0, RECORD_SIZE + 30);
    assert.equal(parseRecords(truncated).length, 1);
});

test('latestRecord: picks the newest across files and tolerates an empty file', () => {
    const older = {contents: buildLog([{ts: nowSec - 100, state: 11}])};
    const newer = {contents: buildLog([{ts: nowSec - 5, state: 10}])};
    assert.equal(latestRecord([older, newer]).state, 10);
    assert.equal(latestRecord([null, older]).state, 11);
    assert.equal(latestRecord([null, undefined]), null);
});

test('ageSeconds: uses the corrected timezone (does not report 3 h of lag)', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11}]))[0];
    assert.ok(ageSeconds(rec) < 10, `age=${ageSeconds(rec)}`);
});

test('classify: mains normal = ok/green', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, values: [110, 118, 2, 25, 59.7, 13.1, 48, 90]}],
    ))[0];
    assert.equal(classify(rec).level, 'ok');
});

test('classify: battery mode = battery/yellow', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 10, values: [0, 118, 3, 40, 59.7, 12.5, 48, 80]}],
    ))[0];
    assert.equal(classify(rec).level, 'battery');
});

test('classify: low battery = low/red even on mains', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, values: [110, 118, 2, 25, 59.7, 12.0, 48, 20]}],
    ))[0];
    assert.equal(classify(rec).level, 'low');
});

test('classify: state 26 (low battery) wins over everything', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 26, values: [110, 118, 2, 25, 59.7, 12.0, 48, 60]}],
    ))[0];
    assert.equal(classify(rec).level, 'low');
});

test('classify: high temperature = hot/orange', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, values: [110, 118, 2, 25, 59.7, 13.1, 85, 90]}],
    ))[0];
    assert.equal(classify(rec, {highTemp: 70}).level, 'hot');
    assert.equal(classify(rec, {highTemp: 70}).hot, true);
    assert.equal(classify(rec, {highTemp: 90}).level, 'ok');
});

test('classify: stale log (> staleAfter) = unknown/grey', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 600, state: 11, values: [110, 118, 2, 25, 59.7, 13, 48, 90]}],
    ))[0];
    assert.equal(classify(rec, {staleAfter: 60}).level, 'unknown');
});

test('classify: no communication with the UPS = unknown', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, offline: true}], ))[0];
    assert.equal(classify(rec).level, 'unknown');
    assert.equal(stateLabel(rec), 'No communication');
});

test('classify: no record at all = unknown', () => {
    assert.equal(classify(null).level, 'unknown');
});

test('configurable threshold changes the classification', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, values: [110, 118, 2, 25, 59.7, 13, 48, 45]}],
    ))[0];
    assert.equal(classify(rec, {lowBattery: 30}).level, 'ok');
    assert.equal(classify(rec, {lowBattery: 50}).level, 'low');
});

test('formatPanelValue: the field selects the reading (with units)', () => {
    const v = {battery: 87.4, load: 34.6, vin: 104.2, vout: 117.9, temp: 48.6};
    assert.equal(formatPanelValue('battery', v), '87%');
    assert.equal(formatPanelValue('load', v), '35%');
    assert.equal(formatPanelValue('vin', v), '104V');
    assert.equal(formatPanelValue('vout', v), '118V');
    assert.equal(formatPanelValue('temperature', v), '49°C');
});

test('formatPanelValue: unknown field falls back to battery, missing values to —', () => {
    assert.equal(formatPanelValue('weird', {battery: 42}), '42%');
    assert.equal(formatPanelValue('battery', {}), '—');
    assert.equal(formatPanelValue('battery', undefined), '—');
    assert.equal(formatPanelValue('load', undefined), '—');
});

test('formatPanelValue: PANEL_FIELDS lists every selectable reading', () => {
    assert.deepEqual(PANEL_FIELDS, ['battery', 'load', 'vin', 'vout', 'temperature']);
});

test('extension.js stateLabels mirror logReader STATE_LABELS', () => {
    const src = fs.readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    const block = src.match(/_stateLabels = \{([\s\S]*?)\};/);
    assert.ok(block, 'stateLabels block not found in extension.js');
    const map = {};
    for (const m of block[1].matchAll(/(\d+):\s*_\('([^']*)'\)/g))
        map[m[1]] = m[2];
    assert.deepEqual(map, STATE_LABELS);
});

// --- real log, when present (validates against the bytes Supervise writes)
const realPath = '/usr/local/supervise/000/loghora.rgt';
if (fs.existsSync(realPath)) {
    test('real log: parses and reports a recent reading', () => {
        const contents = new Uint8Array(fs.readFileSync(realPath));
        const rec = latestRecord([{contents}]);
        assert.ok(rec, 'no valid record in the real log');
        assert.ok(ageSeconds(rec) < 900, `real log ${Math.round(ageSeconds(rec))}s behind`);
        const c = classify(rec);
        assert.ok(['ok', 'battery', 'low', 'hot', 'unknown'].includes(c.level));
        console.log(`       real log: ${stateLabel(rec)}, battery ${rec.values.battery.toFixed(0)}%, ` +
                    `load ${rec.values.load.toFixed(0)}%, vin ${rec.values.vin.toFixed(0)}V, ` +
                    `temp ${rec.values.temp.toFixed(0)}C, age ${Math.round(ageSeconds(rec))}s`);
    });
} else {
    console.log('  --   real log absent, skipping the integration test');
}

console.log(`\n${passed} test(s) ok${process.exitCode ? ', with failures' : ''}`);