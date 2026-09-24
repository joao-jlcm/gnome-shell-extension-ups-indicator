/*
 * Terminal preview of the panel menu, built from the real Supervise log.
 * No GNOME Shell needed: useful to check the values without a logout/login.
 *
 * Usage: node scripts/preview.mjs
 */

import fs from 'node:fs';

import {latestRecord, classify, stateLabel} from '../logReader.js';

const LOG_FILES = [
    '/usr/local/supervise/000/loghora.rgt',
    '/usr/local/supervise/000/logdia.rgt',
];

const files = LOG_FILES.map(path => {
    try {
        return {contents: new Uint8Array(fs.readFileSync(path))};
    } catch {
        return null;
    }
});

const record = latestRecord(files);
const classification = classify(record);
const values = record?.values;

const fmt = (value, digits, unit = '') =>
    Number.isFinite(value) ? `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}` : '—';

const loadText = Number.isFinite(values?.load) ? `${values.load.toFixed(0)} %` : '—';

let summary;
if (!fs.existsSync('/usr/local/supervise')) {
    summary = 'Supervise not found';
} else {
    summary = stateLabel(record);
    if (classification.hot)
        summary += ' (hot)';
    else if (classification.stale)
        summary += ' (stale)';
}

console.log(`  UPS: ${summary}`);
console.log('  ──────────────────────────────');
console.log(`  Voltage:           ${fmt(values?.vin, 0, 'V')} → ${fmt(values?.vout, 0, 'V')}`);
console.log(`  Output current:    ${fmt(values?.iout, 2, 'A')}`);
console.log(`  Load:              ${loadText}`);
console.log(`  Frequency:         ${fmt(values?.hz, 1, 'Hz')}`);
console.log(`  Battery:           ${fmt(values?.battery, 0, '%')}`);
console.log(`  Battery voltage:   ${fmt(values?.vbat, 2, 'V')}`);
console.log(`  Temperature:       ${fmt(values?.temp, 0, '°C')}`);
console.log('  ──────────────────────────────');
console.log('  Preferences');
console.log(`\n  source: ${record ? LOG_FILES.join(', ') : '(no log found)'}`);