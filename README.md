# Supervise Nobreak (extensão GNOME Shell)

Indicador do nobreak **Ragtech Easy Pro 4162** no painel do GNOME Shell, lendo os
dados direto do serviço **Supervise** — sem NUT, sem `/sys/class/power_supply`.

## Por que não NUT

O nobreak usa protocolo proprietário (Microsol/Supervise). Todo driver do NUT falha
com `short reply` / I/O error nesse aparelho. O que funciona é o próprio Supervise,
que já está instalado em `/usr/local/supervise/`.

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
| 12 | 7× float32 LE | Vin, Vout, Iout (A), carga (%), Hz, Vbat, bateria (%) |

**Cuidado com o timestamp:** o Supervise grava a hora local *como se fosse UTC*, o
que deixa o epoch atrasado em relação ao relógio real (3 h aqui, UTC−3). O leitor
soma o offset do fuso antes de comparar; sem isso um daemon vivo parece parado.

## Arquivos

    extension.js    indicador no painel + menu
    logReader.js    parser puro (sem GNOME, sem I/O) — testável com Node
    prefs.js        preferências (GTK4/Adw)
    schemas/        chaves gsettings
    tests/          suíte do parser e da classificação

## Configuração

    panel-contents          hidden | icon | percent | icon-percent | icon-and-percent
    use-colors              colorir por estado (verde/amarelo/vermelho/cinza)
    low-battery-threshold   % abaixo do qual fica vermelho (padrão 30)
    update-interval         segundos entre leituras (padrão 5)
    stale-after             segundos sem escrita para considerar "sem leitura" (padrão 60)

## Instalação

    ln -s "$PWD" ~/.local/share/gnome-shell/extensions/supervise-indicator@joao.local
    glib-compile-schemas schemas
    gnome-extensions enable supervise-indicator@joao.local

No Wayland, extensões novas só carregam depois de logout/login.

## Desenvolvimento

    node tests/parse.test.mjs      # parser + classificação, inclui o log real se existir
    glib-compile-schemas schemas   # após editar o schema
    journalctl -f -o cat /usr/bin/gnome-shell | grep -i supervise   # logs em execução

## Dependência externa

Se o `supsrv` não estiver rodando, não há log novo: o indicador fica **cinza** e
mostra a idade da última leitura em vez de exibir dado velho como se fosse atual.
Ver [`install-supervise-systemd.sh`] no repositório de dotfiles/config — o serviço
é responsável por manter o log vivo.
