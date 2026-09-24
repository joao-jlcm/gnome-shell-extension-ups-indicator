# Supervise Indicator (GNOME Shell extension)

UPS indicator for the **Ragtech Easy Pro 4162** in the GNOME Shell panel, reading
data straight from the **Supervise** service — no NUT, no `/sys/class/power_supply`.
Requires the **Supervise v6** software (the `supsrv` daemon) installed at
`/usr/local/supervise/`. Download:
[Supervise Personal 6.3, linux64](https://ragtech.com.br/Softwares_download/supervise_personal_6.3_linux64.tar.gz).

Tested **only** with the **Ragtech Easy Pro 1200VA** UPS; report compatibility
issues as a [GitHub issue](https://github.com/joao-jlcm/supervise-indicator/issues).

Full documentation:

- 🇬🇧 [English](README.en.md)
- 🇧🇷 [Português](README.pt.md)
- 🇪🇸 [Español](README.es.md)

## Quick start

    ln -s "$PWD" ~/.local/share/gnome-shell/extensions/supervise-indicator@joao-jlcm.github.io
    npm run build          # compile the gsettings schema
    npm run translations   # compile the translations
    gnome-extensions enable supervise-indicator@joao-jlcm.github.io

    npm test               # parser + classification suite
    npm run pack           # build the zip for extensions.gnome.org

## License

GPL-3.0. See [`LICENSE`](LICENSE).
