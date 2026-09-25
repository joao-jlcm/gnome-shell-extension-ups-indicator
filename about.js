#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Joao Cagnoni
/*
 * Standalone About dialog for the UPS Indicator extension.
 *
 * GNOME Shell itself is Clutter/St, not GTK, so the panel menu cannot create an
 * Adw.AboutDialog. The extension launches this tiny libadwaita app in its own
 * process (via Gio.Subprocess) with the extension directory as the only argument.
 *
 * The full license text is NOT embedded in the dialog: rendering ~35 KB in the
 * Legal page label is slow and freezes the dialog. Instead we show the license
 * type (GPL-3.0) and a link that opens the LICENSE file with the user's default
 * text editor.
 *
 * Usage: gjs -m about.js <extension-dir>
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

const dir = ARGV[0];
if (!dir) {
    printerr('usage: about.js <extension-dir>');
    imports.system.exit(1);
}

const file = Gio.File.new_for_path(GLib.build_filenamev([dir, 'metadata.json']));
const [ok, contents] = file.load_contents(null);
if (!ok) {
    printerr(`cannot read ${file.get_path()}`);
    imports.system.exit(1);
}
const meta = JSON.parse(new TextDecoder().decode(contents));

const licenseFile = Gio.File.new_for_path(GLib.build_filenamev([dir, 'LICENSE']));
const hasLicenseFile = licenseFile.query_exists(null);

const app = new Adw.Application({
    application_id: 'org.gnome.Shell.Extensions.SuperviseIndicator.About',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    // Adw.Dialog is not a Gtk.Window, so hold the app alive until it closes
    app.hold();
    const dialog = new Adw.AboutDialog({
        application_name: meta.name,
        application_icon: 'battery-symbolic',
        developer_name: 'Joao Cagnoni',
        version: meta['version-name'] ? `v${meta['version-name']}` : (meta.version != null ? `v${meta.version}` : ''),
        developers: ['Joao Cagnoni <joao.jlcm@proton.me>'],
        copyright: '© 2026 Joao Cagnoni',
        comments: meta.description,
        website: meta.url,
        issue_url: `${meta.url}/issues`,
        license_type: Gtk.License.GPL_3_0,
    });

    // Open the full license text with the user's default text editor.
    if (hasLicenseFile) {
        try {
            dialog.add_link('Full license text', licenseFile.get_uri());
        } catch (e) {
            logError(e);
        }
    }
    dialog.connect('activate-link', (self, uri) => {
        Gio.AppInfo.launch_default_for_uri(uri, null);
        return true;
    });

    dialog.connect('closed', () => {
        app.release();
        app.quit();
    });
    dialog.present(null);
});

app.run([]);