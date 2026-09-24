/*
 * Pure helpers for the panel label value.
 *
 * Kept free of GNOME imports so the tests can run with plain Node
 * (see tests/parse.test.mjs). `field` is one of PANEL_FIELDS and matches the
 * `panel-field` gsettings key.
 */

export const PANEL_FIELDS = ['battery', 'load', 'vin', 'vout', 'temperature'];

/** Panel label text for a reading, e.g. "87%", "104V", "49°C" (or "—"). */
export function formatPanelValue(field, values) {
    const num = (x, unit) => Number.isFinite(x) ? `${Math.round(x)}${unit}` : '—';
    switch (field) {
    case 'load':
        return num(values?.load, '%');
    case 'vin':
        return num(values?.vin, 'V');
    case 'vout':
        return num(values?.vout, 'V');
    case 'temperature':
        return num(values?.temp, '°C');
    case 'battery':
    default:
        return num(values?.battery, '%');
    }
}