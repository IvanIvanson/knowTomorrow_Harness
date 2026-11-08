#!/usr/bin/env node
/** Проверка, что локальные ссылки и иконки из HTML/манифеста существуют. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const pages = ['index.html', 'app.html', 'privacy.html'];
const errors = [];

function resolvePublic(url) {
  const clean = url.split('?')[0].split('#')[0];
  if (clean === '/' || clean === '') return path.join(publicDir, 'index.html');
  if (clean === '/app') return path.join(publicDir, 'app.html');
  return path.join(publicDir, clean.replace(/^\//, ''));
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|#)/.test(ref)) continue;
    const file = resolvePublic(ref);
    if (!fs.existsSync(file)) {
      errors.push(`${page}: нет файла ${ref} -> ${path.relative(root, file)}`);
    }
  }
  console.log(`${page}: проверено ссылок ${refs.length}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) {
  const file = resolvePublic(icon.src);
  if (!fs.existsSync(file)) errors.push(`manifest: нет иконки ${icon.src}`);
}
for (const shortcut of manifest.shortcuts || []) {
  for (const icon of shortcut.icons || []) {
    if (!fs.existsSync(resolvePublic(icon.src))) errors.push(`manifest shortcut: нет иконки ${icon.src}`);
  }
}

if (errors.length) {
  console.error('\nОшибки:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('Все локальные ссылки и иконки на месте.');
