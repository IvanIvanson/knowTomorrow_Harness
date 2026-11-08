#!/usr/bin/env node
/**
 * Внутренняя валидация KnowTomorrow по экспортам пользователей.
 *
 * Использование:
 *   node scripts/research-report.mjs ./exports
 *   node scripts/research-report.mjs ./exports --json
 *   node scripts/research-report.mjs ./exports --out report.md
 *
 * Каждый файл — JSON-экспорт приложения (объект state) или {"state": {...}}.
 * Скрипт не выводит email и заметки; только агрегированные метрики.
 */

import fs from 'node:fs';
import path from 'node:path';

import { normalizeState } from '../shared/app-model.mjs';
import {
  forecastAll,
  mean,
  median,
  pairedTTest,
  sd
} from '../shared/analytics.mjs';
import { formatP } from '../public/js/ui.js';

const args = process.argv.slice(2);
const dir = args.find((arg) => !arg.startsWith('--'));
const jsonMode = args.includes('--json');
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;

if (!dir) {
  console.error('Укажите каталог с JSON-экспортами: node scripts/research-report.mjs ./exports');
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((file) => file.toLowerCase().endsWith('.json'))
  .sort();

if (!files.length) {
  console.error('В каталоге нет JSON-файлов.');
  process.exit(1);
}

const users = [];
let skipped = 0;

for (const [index, file] of files.entries()) {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const raw = payload.state || payload;
    if (!raw || !Array.isArray(raw.entries)) {
      skipped++;
      continue;
    }
    const state = normalizeState(raw);
    if (state.entries.length < 7) {
      skipped++;
      continue;
    }
    const forecast = forecastAll(state);
    const validation = forecast.overall?.validation;
    if (!validation?.available) {
      skipped++;
      continue;
    }
    const naive = validation.models.naive;
    const chosen = validation.models[validation.chosen];
    const ridge = validation.models.ridge;
    if (!naive || !chosen) {
      skipped++;
      continue;
    }
    users.push({
      id: `user-${String(index + 1).padStart(2, '0')}`,
      entries: state.entries.length,
      chosen: validation.chosen,
      folds: validation.folds,
      naiveMae: naive.mae,
      chosenMae: chosen.mae,
      ridgeMae: ridge?.mae ?? null,
      naiveRmse: naive.rmse,
      chosenRmse: chosen.rmse,
      improvement:
        naive.mae > 0 ? ((naive.mae - chosen.mae) / naive.mae) * 100 : null,
      pUser: validation.pValue
    });
  } catch (error) {
    console.warn(`Пропущен ${file}: ${error.message}`);
    skipped++;
  }
}

if (!users.length) {
  console.error('Не удалось извлечь ни одного валидного дневника (нужно ≥ 7 записей).');
  process.exit(1);
}

const naiveMaes = users.map((user) => user.naiveMae);
const chosenMaes = users.map((user) => user.chosenMae);
const ridgeMaes = users
  .map((user) => user.ridgeMae)
  .filter((value) => Number.isFinite(value));
const improvements = users.map((user) => user.improvement).filter(Number.isFinite);
const paired = pairedTTest(chosenMaes, naiveMaes);
const pairedRidge =
  ridgeMaes.length === users.length ? pairedTTest(ridgeMaes, naiveMaes) : null;

const aggregate = {
  files: files.length,
  users: users.length,
  skipped,
  entries: users.reduce((acc, user) => acc + user.entries, 0),
  meanEntries: mean(users.map((user) => user.entries)),
  naiveMaeMean: mean(naiveMaes),
  chosenMaeMean: mean(chosenMaes),
  chosenMaeMedian: median(chosenMaes),
  naiveRmseMean: mean(users.map((user) => user.naiveRmse)),
  chosenRmseMean: mean(users.map((user) => user.chosenRmse)),
  improvementMean: mean(improvements),
  improvementMedian: median(improvements),
  improvedShare: improvements.filter((value) => value > 0).length / improvements.length,
  pairedP: paired.p,
  pairedMeanDiff: paired.meanDiff,
  pairedDf: paired.df,
  ridgeMaeMean: ridgeMaes.length ? mean(ridgeMaes) : null,
  ridgePairedP: pairedRidge?.p ?? null,
  ridgeImprovementMean:
    ridgeMaes.length === users.length
      ? mean(users.map((user) => ((user.naiveMae - user.ridgeMae) / user.naiveMae) * 100))
      : null,
  modelsChosen: users.reduce((acc, user) => {
    acc[user.chosen] = (acc[user.chosen] || 0) + 1;
    return acc;
  }, {})
};

if (jsonMode) {
  console.log(JSON.stringify({ aggregate, users }, null, 2));
  process.exit(0);
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

const lines = [];
lines.push('# KnowTomorrow — внутренняя валидация');
lines.push('');
lines.push(`Дата отчёта: ${new Date().toISOString().slice(0, 10)}`);
lines.push('');
lines.push('## Выборка');
lines.push('');
lines.push(`- Файлов в каталоге: ${aggregate.files}`);
lines.push(`- Валидных дневников (≥ 7 записей): ${aggregate.users}`);
lines.push(`- Пропущено: ${aggregate.skipped}`);
lines.push(`- Всего записей: ${aggregate.entries}`);
lines.push(`- Среднее число записей на участника: ${fmt(aggregate.meanEntries, 1)}`);
lines.push('');
lines.push('## Основной результат');
lines.push('');
lines.push('Сравнение на одном и том же walk-forward разбиении внутри каждого дневника:');
lines.push('');
lines.push(`- MAE наивного прогноза «завтра = сегодня»: **${fmt(aggregate.naiveMaeMean)}**`);
lines.push(`- MAE выбранной модели: **${fmt(aggregate.chosenMaeMean)}**`);
lines.push(`- Среднее улучшение MAE: **${fmt(aggregate.improvementMean, 1)}%** (медиана ${fmt(aggregate.improvementMedian, 1)}%)`);
lines.push(`- Доля участников с улучшением: **${Math.round(aggregate.improvedShare * 100)}%**`);
lines.push(`- Парный t-тест по MAE участников: p = **${formatP(aggregate.pairedP)}**, df = ${aggregate.pairedDf}`);
lines.push('');
lines.push('> Положительное улучшение означает, что модель ошибается меньше наивной. Однако выбор модели происходит на тех же данных, поэтому это оптимистичная оценка; для строгого вывода нужен отдельный holdout или предрегистрированный протокол.');
lines.push('');
lines.push('## Фиксированная Ridge-регрессия');
lines.push('');
if (aggregate.ridgeMaeMean !== null) {
  lines.push(`- MAE Ridge: **${fmt(aggregate.ridgeMaeMean)}**`);
  lines.push(`- Среднее улучшение относительно наивной: **${fmt(aggregate.ridgeImprovementMean, 1)}%**`);
  lines.push(`- Парный t-тест: p = **${formatP(aggregate.ridgePairedP)}**`);
} else {
  lines.push('Недостаточно участников с доступной Ridge-моделью для агрегата.');
}
lines.push('');
lines.push('## По участникам');
lines.push('');
lines.push('| Участник | Записей | Модель | MAE naive | MAE chosen | MAE Ridge | Улучшение |');
lines.push('|---|---:|---|---:|---:|---:|---:|');
users.forEach((user) => {
  lines.push(
    `| ${user.id} | ${user.entries} | ${user.chosen} | ${fmt(user.naiveMae)} | ${fmt(
      user.chosenMae
    )} | ${fmt(user.ridgeMae)} | ${fmt(user.improvement, 1)}% |`
  );
});
lines.push('');
lines.push('## Ограничения');
lines.push('');
lines.push('- Малые и неодинаковые ряды; участники не рандомизированы.');
lines.push('- Выбор модели адаптивный, поэтому итог смещён в оптимистичную сторону.');
lines.push('- Самоотчёты подвержены ретроспективным искажениям.');
lines.push('- Результат не доказывает причинность и не является медицинским выводом.');
lines.push('- Для научной публикации нужны предрегистрация, фиксированный протокол и внешняя выборка.');

const report = lines.join('\n');
console.log(report);
if (outFile) {
  fs.writeFileSync(outFile, report, 'utf8');
  console.error(`Отчёт сохранён: ${outFile}`);
}
