/*
 * Preferences for the Supervise Indicator extension.
 * Direct gsettings bindings - no logic of its own.
 *
 * Note: gettext is initialized only after the module is imported, so `_()`
 * must be called inside fillPreferencesWindow(), never at module top level.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const DEFAULT = Gio.SettingsBindFlags.DEFAULT;

export default class SuperviseIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const contents = [
            ['icon-percent', _('Icon + value')],
            ['icon-and-percent', _('Icon and value (with space)')],
            ['percent', _('Value only')],
            ['icon', _('Icon only')],
            ['hidden', _('Nothing in the panel')],
        ];

        const fields = [
            ['battery', _('Battery (%)')],
            ['load', _('Load (%)')],
            ['vin', _('Input voltage (V)')],
            ['vout', _('Output voltage (V)')],
            ['temperature', _('Temperature (°C)')],
        ];

        const page = new Adw.PreferencesPage();
        window.add(page);

        const general = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('What appears in the top bar.'),
        });
        page.add(general);

        const contentsRow = new Adw.ComboRow({
            title: _('Contents'),
            model: new Gtk.StringList({strings: contents.map(([, label]) => label)}),
        });
        const current = contents.findIndex(([value]) => value === settings.get_string('panel-contents'));
        contentsRow.selected = current < 0 ? 0 : current;
        contentsRow.connect('notify::selected', () => {
            settings.set_string('panel-contents', contents[contentsRow.selected][0]);
        });
        general.add(contentsRow);

        const fieldRow = new Adw.ComboRow({
            title: _('Panel value'),
            model: new Gtk.StringList({strings: fields.map(([, label]) => label)}),
        });
        const currentField = fields.findIndex(([value]) => value === settings.get_string('panel-field'));
        fieldRow.selected = currentField < 0 ? 0 : currentField;
        fieldRow.connect('notify::selected', () => {
            settings.set_string('panel-field', fields[fieldRow.selected][0]);
        });
        general.add(fieldRow);

        const colorsRow = new Adw.SwitchRow({
            title: _('Colour by state'),
            subtitle: _('Green on mains, yellow on battery, red on low battery, grey without reading'),
        });
        settings.bind('use-colors', colorsRow, 'active', DEFAULT);
        general.add(colorsRow);

        const thresholds = new Adw.PreferencesGroup({title: _('Thresholds')});
        page.add(thresholds);

        const lowRow = new Adw.SpinRow({
            title: _('Low battery below (%)'),
            adjustment: new Gtk.Adjustment({lower: 5, upper: 90, step_increment: 1, page_increment: 5}),
        });
        settings.bind('low-battery-threshold', lowRow, 'value', DEFAULT);
        thresholds.add(lowRow);

        const intervalRow = new Adw.SpinRow({
            title: _('Update every (seconds)'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 300, step_increment: 1, page_increment: 10}),
        });
        settings.bind('update-interval', intervalRow, 'value', DEFAULT);
        thresholds.add(intervalRow);

        const staleRow = new Adw.SpinRow({
            title: _('Consider no reading after (seconds)'),
            subtitle: _('Turns grey when the Supervise service stops writing'),
            adjustment: new Gtk.Adjustment({lower: 10, upper: 3600, step_increment: 10, page_increment: 60}),
        });
        settings.bind('stale-after', staleRow, 'value', DEFAULT);
        thresholds.add(staleRow);

        const tempRow = new Adw.SpinRow({
            title: _('High temperature above (°C)'),
            subtitle: _('Turns the indicator orange when the inverter gets this hot'),
            adjustment: new Gtk.Adjustment({lower: 40, upper: 110, step_increment: 1, page_increment: 5}),
        });
        settings.bind('temperature-threshold', tempRow, 'value', DEFAULT);
        thresholds.add(tempRow);
    }
}
