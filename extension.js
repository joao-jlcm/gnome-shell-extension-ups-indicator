// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Joao Cagnoni

/*
 * UPS Indicator - UPS status indicator for the GNOME Shell panel.
 *
 * It uses neither NUT nor /sys/class/power_supply: it reads the history log
 * written by the Supervise service (supsrv), which is world-readable. No helper
 * script and no extra privileges are needed.
 *
 * Configuration (gsettings, see schemas/): what to show in the panel (hidden,
 * icon, percentage, or both), colour by state, the low-battery and "stale log"
 * thresholds, and the refresh intervals.
 *
 * The English strings below are the canonical gettext msgids. Translations live
 * in po/ and are loaded from locale/ (see metadata.json gettext-domain).
 */

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {latestRecord, classify} from './logReader.js';
import {formatPanelValue} from './panelValue.js';

const SUPERVISE_DIR = '/usr/local/supervise';
const SUPERVISE_DOWNLOAD_URL =
    'https://ragtech.com.br/Softwares_download/supervise_personal_6.3_linux64.tar.gz';

const LOG_FILES = [
    GLib.build_filenamev([SUPERVISE_DIR, '000', 'loghora.rgt']),
    GLib.build_filenamev([SUPERVISE_DIR, '000', 'logdia.rgt']),
];

// 'hidden' | 'icon' | 'percent' | 'icon-percent' | 'icon-and-percent'
const CONTENTS = ['hidden', 'icon', 'percent', 'icon-percent', 'icon-and-percent'];

// Translators: UPS operating states, mirroring STATE_LABELS in logReader.js.
let _stateLabels = null;
function stateLabels() {
    if (!_stateLabels) {
        _stateLabels = {
            10: _('On battery'),
            11: _('On AC power'),
            15: _('Starting up'),
            18: _('AC power normal'),
            21: _('AC voltage low'),
            22: _('AC voltage high'),
            24: _('No AC power'),
            26: _('Low battery'),
            27: _('Battery normal'),
            29: _('Battery full'),
            31: _('On AC power'),
        };
    }
    return _stateLabels;
}

/** Translated state text for a record (or "No data" when there is none). */
function stateText(record) {
    if (!record)
        return _('No data');
    if (record.offline)
        return _('No communication');
    return stateLabels()[record.state] ?? _('State %d').format(record.state);
}

const SuperviseIndicator = GObject.registerClass(
class SuperviseIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, _('UPS Indicator'), false);

        this._settings = settings;
        this._superviseDir = Gio.File.new_for_path(SUPERVISE_DIR);

        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box ups-indicator-box',
        });
        this._icon = new St.Icon({icon_name: 'battery-symbolic', style_class: 'system-status-icon'});
        this._label = new St.Label({y_align: 2 /* Clutter.ActorAlign.CENTER */});
        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._rows = {};
        this._buildMenu();

        this._settings.connectObject('changed', () => this._applySettings(), this);
        this.connect('destroy', () => {
            this._settings.disconnectObject(this);
            if (this._timeoutId) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = null;
            }
        });

        this._timeoutId = null;
        this._applySettings();
        this._read();
        this._schedule();
    }

    _buildMenu() {
        this._header = new PopupMenu.PopupMenuItem(_('UPS Indicator'), {reactive: true, hover: false, can_focus: false});
        this._header.track_hover = false;
        this._header.label.add_style_class_name('ups-indicator-header');
        this.menu.addMenuItem(this._header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._rows.voltage = this._addRow(_('Voltage'));
        this._rows.iout = this._addRow(_('Output current'));
        this._rows.load = this._addRow(_('Load'));
        this._rows.hz = this._addRow(_('Frequency'));
        this._rows.battery = this._addRow(_('Battery'));
        this._rows.vbat = this._addRow(_('Battery voltage'));
        this._rows.temp = this._addRow(_('Temperature'));

        // shown only when Supervise is not installed
        this._hint = new PopupMenu.PopupMenuItem(_('Download Supervise'));
        this._hint.visible = false;
        this._hint.connect('activate', () => this._openDownload());
        this.menu.addMenuItem(this._hint);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupMenuItem(_('Preferences'));
        prefs.connect('activate', () => this._openPrefs?.());
        this.menu.addMenuItem(prefs);

        const about = new PopupMenu.PopupMenuItem(_('About'));
        about.connect('activate', () => this._openAbout?.());
        this.menu.addMenuItem(about);
    }

    _addRow(title) {
        // A PopupBaseMenuItem with reactive:false is "insensitive" (getSensitive()
        // requires _activatable), and the theme dims insensitive items. Keep it
        // active (sensitive = normal text colour) but drop hover/focus.
        const item = new PopupMenu.PopupBaseMenuItem({reactive: true, hover: false, can_focus: false});
        item.track_hover = false;   // sensitive (normal colour) but no hover highlight
        item.add_style_class_name('ups-indicator-row');
        const label = new St.Label({
            text: title,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const value = new St.Label({
            text: '—',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'ups-indicator-value',
        });
        item.add_child(label);
        item.add_child(value);
        this.menu.addMenuItem(item);
        return value;
    }

    _setRow(key, text) {
        const value = this._rows[key];
        if (value)
            value.text = text;
    }

    /** Panel label text for the reading chosen in preferences (panel-field). */
    _panelValue(v) {
        let field = 'battery';
        try {
            field = this._settings.get_string('panel-field');
        } catch (e) {
            // stale schema (panel-field not loaded yet): fall back to battery
            logError(e);
        }
        return formatPanelValue(field, v);
    }

    /** Applies whatever the configuration asks for to the panel. */
    _applySettings() {
        const mode = this._settings.get_string('panel-contents');
        const contents = CONTENTS.includes(mode) ? mode : 'icon-percent';
        const showIcon = contents !== 'hidden' && contents !== 'percent';
        const showLabel = contents === 'percent' ||
            contents === 'icon-percent' || contents === 'icon-and-percent';
        const space = contents === 'icon-and-percent' ? ' ' : '';

        this._icon.visible = showIcon;
        this._label.visible = showLabel;
        this._labelText = this._panelValue(this._lastValues);
        this._label.text = this._labelText ? `${space}${this._labelText}` : '';
        this._space = space;

        if (this._lastClassification)
            this._render(this._lastClassification);
    }

    _render(classification) {
        const useColors = this._settings.get_boolean('use-colors');
        const color = useColors ? classification.color : null;
        if (color) {
            this._icon.style = `color: ${color};`;
            this._label.style = `color: ${color};`;
        } else {
            this._icon.style = null;
            this._label.style = null;
        }
        this._label.text = this._labelText ? `${this._space ?? ''}${this._labelText}` : '';
    }

    _schedule() {
        const interval = this._settings.get_int('update-interval') * 1000;
        if (this._timeoutId)
            GLib.Source.remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._read();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /** Reads both logs asynchronously, then refreshes panel + menu. */
    _read() {
        let pending = LOG_FILES.length;
        const files = new Array(LOG_FILES.length).fill(null);

        LOG_FILES.forEach((path, i) => {
            const file = Gio.File.new_for_path(path);
            file.load_contents_async(null, (source, res) => {
                try {
                    const [ok, contents] = file.load_contents_finish(res);
                    files[i] = ok ? {contents} : null;
                } catch (e) {
                    files[i] = null;   // supsrv never ran, file deleted, etc.
                }
                if (--pending === 0)
                    this._processRead(files);
            });
        });
    }

    /** Applies the loaded logs to the panel + menu. */
    _processRead(files) {
        const missing = !this._superviseDir.query_exists(null);
        const record = latestRecord(files);
        const classification = classify(record, {
            lowBattery: this._settings.get_int('low-battery-threshold'),
            staleAfter: this._settings.get_int('stale-after'),
            highTemp: this._settings.get_int('temperature-threshold'),
        });
        this._lastClassification = classification;
        this._hint.visible = missing;

        let summary;
        if (missing) {
            summary = _('Supervise not found');
        } else {
            summary = stateText(record);
            if (classification.hot)
                summary = _('%s (hot)').format(summary);
            else if (classification.stale)
                summary = _('%s (stale)').format(summary);
        }

        this._lastValues = record?.values;
        this._labelText = this._panelValue(record?.values);
        this._icon.icon_name = classification.level === 'low' || classification.level === 'battery'
            ? 'battery-low-symbolic'
            : 'battery-symbolic';

        // the menu header also reflects the state
        this._header.label.text = _('UPS: %s').format(summary);

        const v = record?.values;
        const fmt = (value, digits, unit = '') =>
            Number.isFinite(value) ? `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}` : '—';
        const loadText = Number.isFinite(v?.load) ? `${v.load.toFixed(0)} %` : '—';

        this._setRow('voltage', `${fmt(v?.vin, 0, 'V')} → ${fmt(v?.vout, 0, 'V')}`);
        this._setRow('iout', fmt(v?.iout, 2, 'A'));
        this._setRow('load', loadText);
        this._setRow('hz', fmt(v?.hz, 1, 'Hz'));
        this._setRow('vbat', fmt(v?.vbat, 2, 'V'));
        this._setRow('battery', fmt(v?.battery, 0, '%'));
        this._setRow('temp', fmt(v?.temp, 0, '°C'));

        this._render(classification);
    }

    _openDownload() {
        try {
            Gio.AppInfo.launch_default_for_uri(SUPERVISE_DOWNLOAD_URL, null);
        } catch (e) {
            logError(e);
        }
    }

    setPrefsOpener(fn) {
        this._openPrefs = fn;
    }

    setAboutOpener(fn) {
        this._openAbout = fn;
    }

    destroy() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        super.destroy();
    }
});

export default class SuperviseIndicatorExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new SuperviseIndicator(this._settings);
        this._indicator.setPrefsOpener(() => this.openPreferences());
        this._indicator.setAboutOpener(() => this._openAboutDialog());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    /** The shell is not a GTK app, so the About dialog runs in its own gjs process. */
    _openAboutDialog() {
        try {
            Gio.Subprocess.new(
                ['gjs', '-m', GLib.build_filenamev([this.path, 'about.js']), this.path],
                Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e);
        }
    }
}
