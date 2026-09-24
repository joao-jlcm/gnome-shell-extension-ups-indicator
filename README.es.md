# UPS Indicator (extensión de GNOME Shell)

Indicador del SAI **Ragtech Easy Pro 4162** en el panel de GNOME Shell, leyendo
los datos directamente del servicio **Supervise** — sin NUT, sin
`/sys/class/power_supply`.

> Este es el README en español. Vea también el [índice](README.md),
> el [inglés](README.en.md) y el [portugués](README.pt.md).

## Compatibilidad

Probada **solo** con el SAI **Ragtech Easy Pro 1200VA** (modelo 4162). Otros
modelos pueden usar un protocolo o diseño de log distinto — los problemas de
compatibilidad se pueden reportar como una
[issue en GitHub](https://github.com/joao-jlcm/gnome-shell-extension-ups-indicator/issues).

## Por qué no NUT

Este SAI usa un protocolo propietario (Microsol/Supervise). Todo driver de NUT
falla con `short reply` / I/O error en este dispositivo. Lo que funciona es el
propio Supervise (v6) — el software del fabricante que viene con este SAI. Es un
**requisito previo**, instalado en `/usr/local/supervise/`; la extensión no lo instala.

## Cómo funciona

`supsrv` escribe un registro de historial binario cada segundo:

    /usr/local/supervise/000/loghora.rgt   1 hora  @ 1 s
    /usr/local/supervise/000/logdia.rgt    1 día   @ 24 s
    /usr/local/supervise/000/logmes.rgt    1 mes   @ 12 min
    /usr/local/supervise/000/logevt.rgt    eventos (cambios de estado)

Estos archivos son `644 root:root` — legibles por gnome-shell **sin root**, sin
setuid y sin script auxiliar. Por eso la extensión lee el log en lugar de hablar
con el SAI (el `ttyACM0` requiere privilegios).

Cada registro tiene 72 bytes:

| offset | tipo | campo |
|---|---|---|
| 0 | uint32 LE | timestamp |
| 4 | uint16 LE | constante `0x0255` |
| 6 | uint16 LE | estado (10 = batería, 11 = red, 18 = red normal, 24 = sin red, 26 = batería baja) |
| 8 | uint16 LE | `0xFFFF` = sin comunicación con el SAI |
| 10 | uint16 LE | id del modelo (6 = NEP/Toro/Innergie 1200 TI) |
| 12 | float32 LE | tensión de entrada (V) |
| 16 | float32 LE | tensión de salida (V) |
| 20 | float32 LE | corriente de salida (A) |
| 24 | float32 LE | carga (%) |
| 28 | float32 LE | frecuencia de salida (Hz) |
| 32 | float32 LE | tensión de la batería (V) |
| 36 | float32 LE | temperatura (°C) |
| 40 | float32 LE | carga de la batería (%) |
| 44 | float32 LE | versión del firmware (p. ej. 1.4) |

**Cuidado con el timestamp:** Supervise escribe la hora local *como si fuera UTC*,
lo que deja el epoch retrasado respecto al reloj real (3 h aquí, UTC−3). El lector
suma el desfase horario antes de comparar; sin eso, un daemon vivo parece detenido.

## Archivos

    extension.js    indicador en el panel + menú
    logReader.js    parser puro (sin GNOME, sin I/O) — testeable con Node
    panelValue.js   formato puro del valor del panel — testeable con Node
    prefs.js        preferencias (GTK4/Adw)
    schemas/        claves de gsettings
    po/             fuentes gettext (plantilla POT + traducciones)
    locale/         traducciones compiladas (generadas por `npm run translations`)
    tests/          suite del parser y de la clasificación

## Traducciones

El inglés es el idioma fuente; todas las cadenas de UI son msgids de gettext. Las
traducciones viven en `po/` y se compilan en `locale/`:

    npm run pot           # regenera po/ups-indicator.pot desde el código
    npm run translations  # compila cada po/<lang>.po en locale/<lang>/LC_MESSAGES/

Para añadir un idioma, crea `po/<lang>.po` (a partir del POT) y agrega el código
del idioma a `po/LINGUAS`.

## Configuración

    panel-contents          hidden | icon | percent | icon-percent | icon-and-percent
    panel-field             battery | load | vin | vout | temperature (por defecto battery)
    use-colors              colorear según el estado (verde/amarillo/rojo/gris)
    low-battery-threshold   % por debajo del cual se vuelve rojo (por defecto 30)
    temperature-threshold   °C a partir de los cuales se vuelve naranja (por defecto 70)
    update-interval         segundos entre lecturas (por defecto 5)
    stale-after             segundos sin escritura para considerar "sin lectura" (por defecto 60)

## Instalación

    ln -s "$PWD" ~/.local/share/gnome-shell/extensions/ups-indicator@joao-jlcm.github.io
    npm run build          # compila el esquema de gsettings
    npm run translations   # compila las traducciones
    gnome-extensions enable ups-indicator@joao-jlcm.github.io

En Wayland, las extensiones nuevas solo se cargan tras cerrar y volver a iniciar sesión.

## Desarrollo

    npm test               # parser + clasificación, incluye el log real si existe
    npm run preview        # muestra el contenido del menú desde el log real (sin shell)
    npm run dev            # ventana anidada de GNOME Shell para probar (requiere mutter-devkit)
    npm run build          # tras editar el esquema
    npm run pack           # genera el zip para extensions.gnome.org
    journalctl -f -o cat /usr/bin/gnome-shell | grep -i supervise   # logs en ejecución

## Dependencia externa

Requiere el software **Supervise v6** (el daemon `supsrv`) instalado en
`/usr/local/supervise/`. Descarga oficial (fabricante):
[Supervise Personal 6.3, linux64](https://ragtech.com.br/Softwares_download/supervise_personal_6.3_linux64.tar.gz).

Si `supsrv` no está en ejecución, no hay log nuevo: el indicador se vuelve **gris**
y muestra la antigüedad de la última lectura en lugar de mostrar datos viejos como
si fueran actuales. Ver [`install-supervise-systemd.sh`] en el repositorio de
dotfiles/config — el servicio es lo que mantiene el log vivo.

## Marcas

UPS Indicator es un proyecto independiente y no oficial, sin afiliación,
respaldo ni patrocinio de Ragtech o Microsol. "Supervise" es una marca
registrada de su respectivo propietario, usada aquí de forma descriptiva para
indicar compatibilidad.

## Licencia

GPL-3.0. Consulte [`LICENSE`](LICENSE).
