/*
 * Preferencias da extensao Supervise Nobreak.
 * Bindings diretos com gsettings - sem logica propria.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CONTENTS = [
    ['icon-percent', 'Ícone + percentual'],
    ['icon-and-percent', 'Ícone e percentual (com espaço)'],
    ['percent', 'Somente percentual'],
    ['icon', 'Somente ícone'],
    ['hidden', 'Nada no painel'],
];

const DEFAULT = Gio.SettingsBindFlags.DEFAULT;

export default class SuperviseIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const general = new Adw.PreferencesGroup({
            title: 'Painel',
            description: 'O que aparece na barra superior.',
        });
        page.add(general);

        const contentsRow = new Adw.ComboRow({
            title: 'Conteúdo',
            model: new Gtk.StringList({strings: CONTENTS.map(([, label]) => label)}),
        });
        const current = CONTENTS.findIndex(([value]) => value === settings.get_string('panel-contents'));
        contentsRow.selected = current < 0 ? 0 : current;
        contentsRow.connect('notify::selected', () => {
            settings.set_string('panel-contents', CONTENTS[contentsRow.selected][0]);
        });
        general.add(contentsRow);

        const colorsRow = new Adw.SwitchRow({
            title: 'Colorir por estado',
            subtitle: 'Verde em rede, amarelo em modo bateria, vermelho com bateria baixa, cinza sem leitura',
        });
        settings.bind('use-colors', colorsRow, 'active', DEFAULT);
        general.add(colorsRow);

        const thresholds = new Adw.PreferencesGroup({title: 'Limiares'});
        page.add(thresholds);

        const lowRow = new Adw.SpinRow({
            title: 'Bateria baixa abaixo de (%)',
            adjustment: new Gtk.Adjustment({lower: 5, upper: 90, step_increment: 1, page_increment: 5}),
        });
        settings.bind('low-battery-threshold', lowRow, 'value', DEFAULT);
        thresholds.add(lowRow);

        const intervalRow = new Adw.SpinRow({
            title: 'Atualizar a cada (segundos)',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 300, step_increment: 1, page_increment: 10}),
        });
        settings.bind('update-interval', intervalRow, 'value', DEFAULT);
        thresholds.add(intervalRow);

        const staleRow = new Adw.SpinRow({
            title: 'Considerar sem leitura depois de (segundos)',
            subtitle: 'Fica cinza quando o serviço Supervise para de gravar',
            adjustment: new Gtk.Adjustment({lower: 10, upper: 3600, step_increment: 10, page_increment: 60}),
        });
        settings.bind('stale-after', staleRow, 'value', DEFAULT);
        thresholds.add(staleRow);
    }
}
