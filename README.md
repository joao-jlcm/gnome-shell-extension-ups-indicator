# UPS Indicator (GNOME Shell extension)

UPS indicator for the **Ragtech Easy Pro 4162** in the GNOME Shell panel, reading
data straight from the **Supervise** service — no NUT, no `/sys/class/power_supply`.
Requires the **Supervise v6** software (the `supsrv` daemon) installed at
`/usr/local/supervise/`. Download:
[Supervise Personal 6.3, linux64](https://ragtech.com.br/Softwares_download/supervise_personal_6.3_linux64.tar.gz).

Tested **only** with the **Ragtech Easy Pro 1200VA** UPS; report compatibility
issues as a [GitHub issue](https://github.com/joao-jlcm/gnome-shell-extension-ups-indicator/issues).

Full documentation:

- 🇬🇧 [English](README.en.md)
- 🇧🇷 [Português](README.pt.md)
- 🇪🇸 [Español](README.es.md)

## Quick start

    ln -s "$PWD" ~/.local/share/gnome-shell/extensions/ups-indicator@joao-jlcm.github.io
    npm run build          # compile the gsettings schema
    npm run translations   # compile the translations
    gnome-extensions enable ups-indicator@joao-jlcm.github.io

    npm test               # parser + classification suite
    npm run pack           # build the zip for extensions.gnome.org

## Trademarks

UPS Indicator is an independent, unofficial project, not affiliated with,
endorsed by or sponsored by Ragtech or Microsol. "Supervise" is a trademark of
its respective owner, used here descriptively to indicate compatibility.

## License

GPL-3.0. See [`LICENSE`](LICENSE).
