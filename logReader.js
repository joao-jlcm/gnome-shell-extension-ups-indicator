/*
 * Reader for the Supervise history log (Ragtech/Microsol UPS).
 *
 * Pure module: imports nothing from GNOME and does no I/O. It receives bytes
 * and returns records. That is what allows testing with `node tests/parse.test.mjs`.
 *
 * Format: .rgt files are sequences of 72-byte records:
 *   offset 0  uint32 LE  timestamp
 *   offset 4  uint16 LE  h1 (0x0255, constant)
 *   offset 6  uint16 LE  state (see STATE_LABELS)
 *   offset 8  uint16 LE  h3 (0xFFFF = no communication with the UPS)
 *   offset 12 7x float32 LE  Vin, Vout, Iout(A), load(%), Hz, Vbat, battery(%)
 *
 * Timestamp gotcha: Supervise writes the LOCAL time as if it were UTC, which
 * shifts the epoch relative to the real clock (3 h here, UTC-3). That is why
 * `tzOffsetMinutes` is added before any comparison - without it a live daemon
 * looks 3 h stale.
 *
 * The labels below are the canonical English source strings (gettext msgids);
 * the UI layer translates them with `_()`. This module stays language-neutral
 * so it can run under plain Node.
 */

export const RECORD_SIZE = 72;
export const VALUE_OFFSET = 12;
// Order confirmed against `csupcli` (Supervise 6.3) on a Ragtech Easy Pro
// 1200VA: @12 vin, @16 vout, @20 iout, @24 load, @28 hz, @32 vbat,
// @36 temperature (degC), @40 battery charge (%).
export const FIELD_NAMES = ['vin', 'vout', 'iout', 'load', 'hz', 'vbat', 'temp', 'battery'];
export const FIRMWARE_OFFSET = 44;
export const OFFLINE = 0xffff;

// Plausible epoch: discards pre-allocated slots (zero) and garbage (0xffffffff).
const EPOCH_MIN = 1_600_000_000;
const EPOCH_MAX = 2_000_000_000;

export const STATE_LABELS = {
    10: 'On battery',
    11: 'On AC power',
    15: 'Starting up',
    18: 'AC power normal',
    21: 'AC voltage low',
    22: 'AC voltage high',
    24: 'No AC power',
    26: 'Low battery',
    27: 'Battery normal',
    29: 'Battery full',
    31: 'On AC power',
};

/**
 * Converts the binary contents of a .rgt file into records, oldest to newest.
 * @param {Uint8Array|ArrayBuffer} buffer
 * @returns {Array<{ts: number, state: number, offline: boolean, values: Object}>}
 *   ts in milliseconds, already corrected for the local timezone.
 */
export function parseRecords(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tzShift = new Date().getTimezoneOffset() * 60; // seconds: local time stored as UTC
    const records = [];

    for (let offset = 0; offset + RECORD_SIZE <= bytes.byteLength; offset += RECORD_SIZE) {
        const rawTs = view.getUint32(offset, true);
        if (rawTs < EPOCH_MIN || rawTs > EPOCH_MAX)
            continue;

        const state = view.getUint16(offset + 4 + 2, true);
        const h3 = view.getUint16(offset + 8, true);

        const values = {};
        for (let i = 0; i < FIELD_NAMES.length; i++)
            values[FIELD_NAMES[i]] = view.getFloat32(VALUE_OFFSET + offset + i * 4, true);
        values.firmware = view.getFloat32(offset + FIRMWARE_OFFSET, true);

        records.push({
            ts: (rawTs + tzShift) * 1000,
            state,
            offline: h3 === OFFLINE,
            values,
        });
    }

    records.sort((a, b) => a.ts - b.ts);
    return records;
}

/**
 * Newest record across one or more files. Each item of `files` must be
 * `{contents}` (the module does not read from disk).
 */
export function latestRecord(files) {
    let best = null;
    for (const file of files) {
        if (!file || !file.contents)
            continue;
        const records = parseRecords(file.contents);
        const last = records[records.length - 1];
        if (last && (!best || last.ts > best.ts))
            best = last;
    }
    return best;
}

/** Age of the record in seconds (negative if the record is in the future). */
export function ageSeconds(record, now = Date.now()) {
    if (!record)
        return Infinity;
    return (now - record.ts) / 1000;
}

/** State text as an English msgid, or null when there is a real reading. */
export function stateLabel(record) {
    if (!record)
        return 'No data';
    if (record.offline)
        return 'No communication';
    return STATE_LABELS[record.state] ?? `State ${record.state}`;
}

/**
 * Classification for the UI. `summary` is an English msgid; `stale` tells the
 * UI to append a "(stale)" marker and `hot` a "(hot)" one. The UI translates
 * both with `_()`.
 * @returns {{level: 'ok'|'battery'|'low'|'hot'|'unknown', color: string, summary: string, stale: boolean, hot: boolean}}
 */
export function classify(record, {lowBattery = 30, staleAfter = 60, highTemp = 70, now = Date.now()} = {}) {
    if (!record)
        return {level: 'unknown', color: '#9a9996', summary: 'No data', stale: false, hot: false};

    const age = ageSeconds(record, now);
    const battery = record.values.battery;
    const temp = record.values.temp;
    const summary = stateLabel(record);
    const hot = Number.isFinite(temp) && temp >= highTemp;

    if (record.offline)
        return {level: 'unknown', color: '#9a9996', summary, stale: false, hot: false};
    if (age > staleAfter)
        return {level: 'unknown', color: '#9a9996', summary, stale: true, hot: false};

    // 10 = battery mode, 24 = mains power absent
    const onBattery = record.state === 10 || record.state === 24;
    if (record.state === 26 || battery < lowBattery)
        return {level: 'low', color: '#e01b24', summary, stale: false, hot};
    if (hot)
        return {level: 'hot', color: '#ff7800', summary, stale: false, hot: true};
    if (onBattery)
        return {level: 'battery', color: '#e5a50a', summary, stale: false, hot: false};

    return {level: 'ok', color: '#33d17a', summary, stale: false, hot: false};
}
