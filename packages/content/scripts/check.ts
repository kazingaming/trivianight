/**
 * Content checker. Run with `npm run content:check`.
 *
 * Validates every question, then reports the shape of the bank so gaps in
 * difficulty or format are obvious before they show up mid-game.
 */

import { ALL_QUESTIONS, contentStats, PACKS, validateAll } from '../src/index.js';
import { DIFFICULTY_NAMES, MODES, difficultyWeights, type Difficulty } from '@trivia/shared';

const issues = validateAll();
const errors = issues.filter((issue) => issue.severity === 'error');
const warnings = issues.filter((issue) => issue.severity === 'warning');
const stats = contentStats();

console.log('');
console.log('  Trivia Night — content check');
console.log('  ' + '-'.repeat(46));
console.log(`  Packs      ${PACKS.length}`);
console.log(`  Questions  ${stats.total}`);
console.log('');

console.log('  By difficulty');
for (const tier of [1, 2, 3, 4, 5] as Difficulty[]) {
  const count = stats.byDifficulty[tier];
  const bar = '#'.repeat(count);
  console.log(`    ${DIFFICULTY_NAMES[tier].padEnd(10)} ${String(count).padStart(3)}  ${bar}`);
}
console.log('');

console.log('  By format');
for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${type.padEnd(16)} ${String(count).padStart(3)}`);
}
console.log('');

console.log('  By category');
const categories = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
for (const [category, count] of categories) {
  console.log(`    ${category.padEnd(12)} ${String(count).padStart(3)}`);
}
console.log('');

// A mode whose late rounds lean on an empty tier will silently substitute.
// Better to know now.
console.log('  Depth check (can each mode fill its curve?)');
for (const mode of Object.values(MODES)) {
  const rounds = mode.rounds ?? 15;
  const shortfalls: string[] = [];
  for (let round = 1; round <= rounds; round++) {
    const weights = difficultyWeights(mode.id, round);
    const dominant = (Object.entries(weights) as Array<[string, number]>).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const tier = Number(dominant[0]) as Difficulty;
    if (stats.byDifficulty[tier] === 0) shortfalls.push(`round ${round} wants ${DIFFICULTY_NAMES[tier]}`);
  }
  const verdict = shortfalls.length === 0 ? 'ok' : shortfalls.join(', ');
  console.log(`    ${mode.label.padEnd(16)} ${rounds} rounds  ${verdict}`);
}
console.log('');

if (stats.volatile > 0) {
  console.log(`  ${stats.volatile} question(s) marked volatile — re-check these periodically.`);
  console.log('');
}

if (warnings.length) {
  console.log(`  Warnings (${warnings.length})`);
  for (const warning of warnings) console.log(`    ! ${warning.questionId}: ${warning.message}`);
  console.log('');
}

if (errors.length) {
  console.log(`  Errors (${errors.length})`);
  for (const error of errors) console.log(`    x ${error.questionId}: ${error.message}`);
  console.log('');
  console.log('  FAILED');
  process.exit(1);
}

console.log(`  All ${ALL_QUESTIONS.length} questions passed.`);
console.log('');
