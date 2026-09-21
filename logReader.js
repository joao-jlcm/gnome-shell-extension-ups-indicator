/*
 * Leitor do log de historico do Supervise (nobreak Ragtech/Microsol).
 *
 * Modulo puro: nao importa nada do GNOME e nao faz I/O. Recebe bytes e devolve
 * registros. Isso e o que permite testar com `node tests/parse.test.mjs`.
 *
 * Formato: arquivos .rgt sao sequencias de registros de 72 bytes:
 *   offset 0  uint32 LE  timestamp
 *   offset 4  uint16 LE  h1 (0x0255, constante)
 *   offset 6  uint16 LE  estado (ver STATE_LABELS)
 *   offset 8  uint16 LE  h3 (0xFFFF = sem comunicacao com o nobreak)
 *   offset 12 7x float32 LE  Vin, Vout, Iout(A), carga(%), Hz, Vbat, bateria(%)
 *
 * Pegadinha do timestamp: o Supervise grava a hora LOCAL como se fosse UTC, o
 * que deixa o epoch adiantado em relacao ao relogio real (3 h aqui, UTC-3).
 * Por isso `tzOffsetMinutes` e somado antes de qualquer comparacao - sem isso um
 * daemon vivo parece 3 h parado.
 */

export const RECORD_SIZE = 72;
export const VALUE_OFFSET = 12;
export const FIELD_NAMES = ['vin', 'vout', 'iout', 'load', 'hz', 'vbat', 'battery'];
export const OFFLINE = 0xffff;

// Epoch plausivel: descarta slots pre-alocados (zero) e lixo (0xffffffff).
const EPOCH_MIN = 1_600_000_000;
const EPOCH_MAX = 2_000_000_000;

export const STATE_LABELS = {
    10: 'Bateria',
    11: 'Rede',
    15: 'Iniciando',
    18: 'Rede normal',
    21: 'Rede baixa',
    22: 'Rede alta',
    24: 'Sem rede',
    26: 'Bateria baixa',
    27: 'Bateria normal',
    29: 'Bateria cheia',
    31: 'Rede',
};

/**
 * Converte o conteudo binario de um .rgt em registros, do mais antigo ao mais novo.
 * @param {Uint8Array|ArrayBuffer} buffer
 * @returns {Array<{ts: number, state: number, offline: boolean, values: Object}>}
 *   ts em milissegundos ja corrigido para o fuso local.
 */
export function parseRecords(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tzShift = new Date().getTimezoneOffset() * 60; // segundos: hora local gravada como UTC
    const records = [];

    for (let offset = 0; offset + RECORD_SIZE <= bytes.byteLength; offset += RECORD_SIZE) {
        const rawTs = view.getUint32(offset, true);
        if (rawTs < EPOCH_MIN || rawTs > EPOCH_MAX)
            continue;

        const state = view.getUint16(offset + 4 + 2, true);
        const h3 = view.getUint16(offset + 8, true);

        const values = {};
        for (let i = 0; i < FIELD_NAMES.length; i++)
            values[FIELD_NAMES[i]] = view.getFloat32(VALUE_OFFSET + offset + i * 4, true);

        records.push({
            ts: (rawTs + tzShift) * 1000,
            state,
            offline: h3 === OFFLINE,
            values,
        });
    }

    records.sort((a, b) => a.ts - b.ts);
    return records;
}

/**
 * Registro mais novo de um ou mais arquivos. Cada item de `files` deve ser
 * `{contents}` (o modulo nao le disco).
 */
export function latestRecord(files) {
    let best = null;
    for (const file of files) {
        if (!file || !file.contents)
            continue;
        const records = parseRecords(file.contents);
        const last = records[records.length - 1];
        if (last && (!best || last.ts > best.ts))
            best = last;
    }
    return best;
}

/** Idade do registro em segundos (negativa se o registro esta no futuro). */
export function ageSeconds(record, now = Date.now()) {
    if (!record)
        return Infinity;
    return (now - record.ts) / 1000;
}

/** Texto do estado, ou null quando ha leitura de verdade. */
export function stateLabel(record) {
    if (!record)
        return 'Sem dados';
    if (record.offline)
        return 'Sem comunicação';
    return STATE_LABELS[record.state] ?? `Estado ${record.state}`;
}

/**
 * Classificacao para a UI.
 * @returns {{level: 'ok'|'battery'|'low'|'unknown', color: string, summary: string}}
 */
export function classify(record, {lowBattery = 30, staleAfter = 60, now = Date.now()} = {}) {
    if (!record)
        return {level: 'unknown', color: '#9a9996', summary: 'Sem dados'};

    const age = ageSeconds(record, now);
    const battery = record.values.battery;
    const summary = stateLabel(record);

    if (record.offline || age > staleAfter)
        return {level: 'unknown', color: '#9a9996', summary: `${summary} (parado)`};

    // 10 = modo bateria, 24 = ausencia de rede eletrica
    const onBattery = record.state === 10 || record.state === 24;
    if (record.state === 26 || battery < lowBattery)
        return {level: 'low', color: '#e01b24', summary};
    if (onBattery)
        return {level: 'battery', color: '#e5a50a', summary};

    return {level: 'ok', color: '#33d17a', summary};
}
