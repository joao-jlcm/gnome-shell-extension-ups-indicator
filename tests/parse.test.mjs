/*
 * Testes do parser e da classificacao.
 * Rodam com Node puro: `node tests/parse.test.mjs` dentro do repo.
 * O log real e usado quando existe, mas os casos de borda sao sinteticos.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    parseRecords, latestRecord, ageSeconds, classify, stateLabel,
    RECORD_SIZE, OFFLINE,
} from '../logReader.js';

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.log(`  FAIL ${name}\n       ${e.message}`);
        process.exitCode = 1;
    }
}

/** Monta um .rgt sintetico: registros de 72 bytes. */
function buildLog(entries) {
    const buf = new Uint8Array(entries.length * RECORD_SIZE);
    const view = new DataView(buf.buffer);
    entries.forEach((e, i) => {
        const base = i * RECORD_SIZE;
        // o log grava a hora local como se fosse UTC, o que deixa o epoch
        // ATRASADO em relacao ao epoch verdadeiro: raw = ts - |offset|
        view.setUint32(base, e.ts - new Date().getTimezoneOffset() * 60, true);
        view.setUint16(base + 4, 0x255, true);
        view.setUint16(base + 6, e.state, true);
        view.setUint16(base + 8, e.offline ? OFFLINE : 0xa, true);
        const v = e.values ?? [110, 118, 4, 30, 59.7, 13.1, 85];
        v.forEach((val, j) => view.setFloat32(base + 12 + j * 4, val, true));
    });
    return buf;
}

const nowSec = Math.floor(Date.now() / 1000);

test('parse: campos na ordem certa', () => {
    const rec = parseRecords(buildLog([
        {ts: nowSec - 10, state: 10, values: [107, 119, 2.5, 24, 59.7, 13.4, 53]},
    ]))[0];
    assert.equal(rec.values.vin, 107);
    assert.equal(rec.values.battery, 53);
    assert.equal(rec.state, 10);
    assert.equal(rec.offline, false);
});

test('parse: slots vazios (timestamp 0) sao descartados', () => {
    const buf = new Uint8Array(RECORD_SIZE * 3);       // tudo zero
    assert.equal(parseRecords(buf).length, 0);
});

test('parse: ordena do mais antigo ao mais novo', () => {
    const recs = parseRecords(buildLog([
        {ts: nowSec - 5, state: 11},
        {ts: nowSec - 60, state: 11},
        {ts: nowSec - 30, state: 11},
    ]));
    assert.deepEqual(recs.map(r => Math.round(r.ts / 1000)), [nowSec - 60, nowSec - 30, nowSec - 5]);
});

test('parse: arquivo truncado no meio de um registro nao quebra', () => {
    const full = buildLog([{ts: nowSec - 5, state: 11}, {ts: nowSec - 2, state: 11}]);
    const truncated = full.slice(0, RECORD_SIZE + 30);
    assert.equal(parseRecords(truncated).length, 1);
});

test('latestRecord: pega o mais novo entre arquivos e tolera arquivo vazio', () => {
    const older = {contents: buildLog([{ts: nowSec - 100, state: 11}])};
    const newer = {contents: buildLog([{ts: nowSec - 5, state: 10}])};
    assert.equal(latestRecord([older, newer]).state, 10);
    assert.equal(latestRecord([null, older]).state, 11);
    assert.equal(latestRecord([null, undefined]), null);
});

test('ageSeconds: usa o fuso corrigido (nao reporta 3 h de atraso)', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11}]))[0];
    assert.ok(ageSeconds(rec) < 10, `idade=${ageSeconds(rec)}`);
});

test('classify: rede normal = ok/verde', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, values: [110, 118, 2, 25, 59.7, 13.1, 90]}],
    ))[0];
    assert.equal(classify(rec).level, 'ok');
});

test('classify: modo bateria = battery/amarelo', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 10, values: [0, 118, 3, 40, 59.7, 12.5, 80]}],
    ))[0];
    assert.equal(classify(rec).level, 'battery');
});

test('classify: bateria baixa = low/vermelho mesmo em rede', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, values: [110, 118, 2, 25, 59.7, 12.0, 20]}],
    ))[0];
    assert.equal(classify(rec).level, 'low');
});

test('classify: estado 26 (bateria baixa) ganha de tudo', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 26, values: [110, 118, 2, 25, 59.7, 12.0, 60]}],
    ))[0];
    assert.equal(classify(rec).level, 'low');
});

test('classify: log parado (> staleAfter) = unknown/cinza', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 600, state: 11, values: [110, 118, 2, 25, 59.7, 13, 90]}],
    ))[0];
    assert.equal(classify(rec, {staleAfter: 60}).level, 'unknown');
});

test('classify: sem comunicacao com o nobreak = unknown', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, offline: true}], ))[0];
    assert.equal(classify(rec).level, 'unknown');
    assert.equal(stateLabel(rec), 'Sem comunicação');
});

test('classify: sem registro nenhum = unknown', () => {
    assert.equal(classify(null).level, 'unknown');
});

test('limiar configuravel muda a classificacao', () => {
    const rec = parseRecords(buildLog([{ts: nowSec - 5, state: 11, values: [110, 118, 2, 25, 59.7, 13, 45]}],
    ))[0];
    assert.equal(classify(rec, {lowBattery: 30}).level, 'ok');
    assert.equal(classify(rec, {lowBattery: 50}).level, 'low');
});

// --- log real, quando presente (valida contra os bytes que o Supervise escreve)
const realPath = '/usr/local/supervise/000/loghora.rgt';
if (fs.existsSync(realPath)) {
    test('log real: parseia e reporta leitura recente', () => {
        const contents = new Uint8Array(fs.readFileSync(realPath));
        const rec = latestRecord([{contents}]);
        assert.ok(rec, 'nenhum registro valido no log real');
        assert.ok(ageSeconds(rec) < 900, `log real com ${Math.round(ageSeconds(rec))}s de atraso`);
        const c = classify(rec);
        assert.ok(['ok', 'battery', 'low', 'unknown'].includes(c.level));
        console.log(`       log real: ${stateLabel(rec)}, bateria ${rec.values.battery.toFixed(0)}%, ` +
                    `carga ${rec.values.load.toFixed(0)}%, vin ${rec.values.vin.toFixed(0)}V, ` +
                    `idade ${Math.round(ageSeconds(rec))}s`);
    });
} else {
    console.log('  --   log real ausente, pulando o teste de integracao');
}

console.log(`\n${passed} teste(s) ok${process.exitCode ? ', com falhas' : ''}`);
