/*
 * Supervise Nobreak - indicador do nobreak no painel do GNOME Shell.
 *
 * Nao usa NUT nem /sys/class/power_supply: le o log de historico escrito pelo
 * servico Supervise (supsrv), que e world-readable. Nenhum script auxiliar e
 * nenhum privilegio extra sao necessarios.
 *
 * Configuracao (gsettings, veja schemas/): o que mostrar no painel (oculto,
 * icone, percentual, ou ambos), cor por estado, limiares de bateria baixa e de
 * "log parado", e os intervalos de atualizacao.
 */

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {latestRecord, classify, ageSeconds} from './logReader.js';

const LOG_FILES = [
    GLib.build_filenamev(['/usr/local/supervise', '000', 'loghora.rgt']),
    GLib.build_filenamev(['/usr/local/supervise', '000', 'logdia.rgt']),
];

// 'hidden' | 'icon' | 'percent' | 'icon-percent' | 'icon-and-percent'
const CONTENTS = ['hidden', 'icon', 'percent', 'icon-percent', 'icon-and-percent'];

const SuperviseIndicator = GObject.registerClass(
class SuperviseIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Supervise Nobreak', false);

        this._settings = settings;

        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box supervise-indicator-box',
        });
        this._icon = new St.Icon({icon_name: 'battery-symbolic', style_class: 'system-status-icon'});
        this._label = new St.Label({y_align: 2 /* Clutter.ActorAlign.CENTER */});
        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._rows = {};
        this._buildMenu();

        this._settings.connectObject('changed', () => this._applySettings(), this);
        this.connect('destroy', () => this._settings.disconnectObject(this));

        this._timeoutId = null;
        this._applySettings();
        this._read();
        this._schedule();
    }

    _buildMenu() {
        this._header = new PopupMenu.PopupMenuItem('Nobreak (Supervise)', {reactive: false});
        this._header.label.add_style_class_name('supervise-indicator-header');
        this.menu.addMenuItem(this._header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._rows.status = this._addRow('Estado');
        this._rows.battery = this._addRow('Bateria');
        this._rows.load = this._addRow('Carga');
        this._rows.vin = this._addRow('Tensão de entrada');
        this._rows.age = this._addRow('Leitura');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupMenuItem('Preferências');
        prefs.connect('activate', () => this._openPrefs?.());
        this.menu.addMenuItem(prefs);
    }

    _addRow(title) {
        const item = new PopupMenu.PopupMenuItem('', {reactive: false});
        item.label.text = `${title}: —`;
        this.menu.addMenuItem(item);
        return item;
    }

    _setRow(key, text) {
        const item = this._rows[key];
        if (item)
            item.label.text = text;
    }

    /** Aplica ao painel o que a configuracao pede. */
    _applySettings() {
        const mode = this._settings.get_string('panel-contents');
        const contents = CONTENTS.includes(mode) ? mode : 'icon-percent';
        const showIcon = contents !== 'hidden' && contents !== 'percent';
        const showLabel = contents === 'percent' ||
            contents === 'icon-percent' || contents === 'icon-and-percent';
        const space = contents === 'icon-and-percent' ? ' ' : '';

        this._icon.visible = showIcon;
        this._label.visible = showLabel;
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

    /** Le os dois logs e atualiza painel + menu. */
    _read() {
        const files = LOG_FILES.map(path => {
            try {
                const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
                return ok ? {contents} : null;
            } catch (e) {
                return null;   // supsrv nunca rodou, arquivo apagado, etc.
            }
        });

        const record = latestRecord(files);
        const classification = classify(record, {
            lowBattery: this._settings.get_int('low-battery-threshold'),
            staleAfter: this._settings.get_int('stale-after'),
        });
        this._lastClassification = classification;

        this._labelText = record ? `${Math.round(record.values.battery)}%` : '—';
        this._icon.icon_name = classification.level === 'low' || classification.level === 'battery'
            ? 'battery-low-symbolic'
            : 'battery-symbolic';

        // cabeçalho do menu tambem reflete o estado
        this._header.label.text = `Nobreak: ${classification.summary}`;

        this._setRow('status', `Estado: ${classification.summary}`);
        this._setRow('battery', `Bateria: ${record ? `${record.values.battery.toFixed(0)} %` : '—'}`);
        this._setRow('load', `Carga: ${record ? `${record.values.load.toFixed(0)} %` : '—'}`);
        this._setRow('vin', `Tensão de entrada: ${record ? `${record.values.vin.toFixed(0)} V` : '—'}`);
        this._setRow('age', record
            ? `Leitura: ${this._humanAge(ageSeconds(record))} atrás`
            : 'Leitura: sem dados');

        this._render(classification);
    }

    _humanAge(seconds) {
        if (!Number.isFinite(seconds))
            return '—';
        if (seconds < 90)
            return `${Math.round(seconds)} s`;
        if (seconds < 5400)
            return `${Math.round(seconds / 60)} min`;
        return `${(seconds / 3600).toFixed(1)} h`;
    }

    setPrefsOpener(fn) {
        this._openPrefs = fn;
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
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
