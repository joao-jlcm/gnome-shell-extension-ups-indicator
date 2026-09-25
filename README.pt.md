# UPS Indicator (extensão GNOME Shell)

Indicador do nobreak **Ragtech Easy Pro 4162** no painel do GNOME Shell, lendo os
dados direto do serviço **Supervise** — sem NUT, sem `/sys/class/power_supply`.

> Este é o README em português. Veja também o [índice](README.md), o
> [inglês](README.en.md) e o [espanhol](README.es.md).

## Compatibilidade

Testada **apenas** com o nobreak **Ragtech Easy Pro 1200VA** (modelo 4162). Outros
modelos podem usar protocolo ou leiaute de log diferente — problemas de
compatibilidade podem ser reportados como uma
[issue no GitHub](https://github.com/joao-jlcm/gnome-shell-extension-ups-indicator/issues).

## Por que não NUT

O nobreak usa protocolo proprietário (Microsol/Supervise). Todo driver do NUT falha
com `short reply` / I/O error nesse aparelho. O que funciona é o próprio Supervise
(v6) — o software do fabricante que acompanha esse nobreak. Ele é um
**pré-requisito**, instalado em `/usr/local/supervise/`; a extensão não o instala.

## Como funciona

O `supsrv` grava um log de histórico binário a cada segundo:

    /usr/local/supervise/000/loghora.rgt   1 hora  @ 1 s
    /usr/local/supervise/000/logdia.rgt    1 dia   @ 24 s
    /usr/local/supervise/000/logmes.rgt    1 mês   @ 12 min
    /usr/local/supervise/000/logevt.rgt    eventos (mudanças de estado)

Esses arquivos são `644 root:root` — legíveis pelo gnome-shell **sem root**, sem
setuid e sem script auxiliar. É esse o motivo de a extensão ler o log em vez de
conversar com o nobreak (o `ttyACM0` exige privilégio).

Cada registro tem 72 bytes:

| offset | tipo | campo |
|---|---|---|
| 0 | uint32 LE | timestamp |
| 4 | uint16 LE | constante `0x0255` |
| 6 | uint16 LE | estado (10 = bateria, 11 = rede, 18 = rede normal, 24 = sem rede, 26 = bateria baixa) |
| 8 | uint16 LE | `0xFFFF` = sem comunicação com o nobreak |
| 10 | uint16 LE | id do modelo (6 = NEP/Toro/Innergie 1200 TI) |
| 12 | float32 LE | tensão de entrada (V) |
| 16 | float32 LE | tensão de saída (V) |
| 20 | float32 LE | corrente de saída (A) |
| 24 | float32 LE | carga (%) |
| 28 | float32 LE | frequência de saída (Hz) |
| 32 | float32 LE | tensão da bateria (V) |
| 36 | float32 LE | temperatura (°C) |
| 40 | float32 LE | carga da bateria (%) |
| 44 | float32 LE | versão do firmware (ex.: 1.4) |

**Cuidado com o timestamp:** o Supervise grava a hora local *como se fosse UTC*, o
que deixa o epoch atrasado em relação ao relógio real (3 h aqui, UTC−3). O leitor
soma o offset do fuso antes de comparar; sem isso um daemon vivo parece parado.

## Arquivos

    extension.js    indicador no painel + menu
    logReader.js    parser puro (sem GNOME, sem I/O) — testável com Node
    panelValue.js   formatação pura do valor do painel — testável com Node
    prefs.js        preferências (GTK4/Adw)
    schemas/        chaves gsettings
    po/             fontes gettext (template POT + traduções)
    locale/         traduções compiladas (gerado por `npm run translations`)
    tests/          suíte do parser e da classificação

## Traduções

O inglês é o idioma fonte; todas as strings de UI são msgids gettext. As traduções
ficam em `po/` e são compiladas para `locale/`:

    npm run pot           # regenera po/ups-indicator.pot a partir do código
    npm run translations  # compila cada po/<lang>.po em locale/<lang>/LC_MESSAGES/

Para adicionar um idioma, crie `po/<lang>.po` (a partir do POT) e acrescente o
código do idioma em `po/LINGUAS`.

## Configuração

    panel-contents          hidden | icon | percent | icon-percent | icon-and-percent
    panel-field             battery | load | vin | vout | temperature (padrão battery)
    use-colors              colorir por estado (verde/amarelo/vermelho/cinza)
    low-battery-threshold   % abaixo do qual fica vermelho (padrão 30)
    temperature-threshold   °C a partir do qual fica laranja (padrão 70)
    update-interval         segundos entre leituras (padrão 5)
    stale-after             segundos sem escrita para considerar "sem leitura" (padrão 60)

## Instalação

    ln -s "$PWD" ~/.local/share/gnome-shell/extensions/ups-indicator@joao-jlcm.github.io
    npm run build          # compila o schema gsettings
    npm run translations   # compila as traduções
    gnome-extensions enable ups-indicator@joao-jlcm.github.io

No Wayland, extensões novas só carregam depois de logout/login.

## Desenvolvimento

    npm test               # parser + classificação, inclui o log real se existir
    npm run preview        # mostra o conteúdo do menu a partir do log real (sem shell)
    npm run dev            # janela aninhada do GNOME Shell para testar (requer mutter-devkit)
    npm run build          # após editar o schema
    npm run pack           # gera o zip para o extensions.gnome.org
    journalctl -f -o cat /usr/bin/gnome-shell | grep -i supervise   # logs em execução

## Dependência externa

Requer o software **Supervise v6** (o daemon `supsrv`) instalado em
`/usr/local/supervise/`. Download oficial (fabricante):
[Supervise Personal 6.3, linux64](https://ragtech.com.br/Softwares_download/supervise_personal_6.3_linux64.tar.gz).

Se o `supsrv` não estiver rodando, não há log novo: o indicador fica **cinza** e
mostra a idade da última leitura em vez de exibir dado velho como se fosse atual.
Ver [`install-supervise-systemd.sh`] no repositório de dotfiles/config — o serviço
é responsável por manter o log vivo.

## Marcas

O UPS Indicator é um projeto independente e não oficial, sem vínculo, endosso
ou patrocínio da Ragtech ou da Microsol. "Supervise" é marca registrada de seu
respectivo titular, usada aqui de forma descritiva para indicar compatibilidade.

## Licença

GPL-3.0-or-later. Veja [`LICENSE`](LICENSE).
