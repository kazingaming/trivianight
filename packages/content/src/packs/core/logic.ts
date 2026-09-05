import type { Question } from '@trivia/shared';

/**
 * Probability and reasoning.
 *
 * These are the questions where the answer is provable, but intuition still
 * fights you the whole way there.
 */
export const logicQuestions: Question[] = [
  {
    id: 'logic.birthday-23',
    type: 'probability',
    prompt:
      'In a room of 23 randomly chosen people, what is the probability that at least two share a birthday?',
    subPrompt: 'Ignore leap years and assume every birthday is equally likely.',
    category: 'Logic',
    difficulty: 2,
    tags: ['probability', 'classic'],
    answer: 50.7,
    displayAnswer: 'about 50.7%',
    tolerance: 14,
    reveal: {
      headline: '50.7%',
      explanation:
        'Twenty-three people form 253 different pairs, and each pair is a separate chance for a match. Intuition fails because we instinctively compare everyone against ourselves rather than against each other.',
      comparison: 'At 70 people the probability is 99.9%. At 366 it finally becomes certain.',
    },
    source: {
      citation: 'The birthday problem — standard probability result',
      kind: 'definitional',
    },
  },
  {
    id: 'logic.birthday-yours',
    type: 'probability',
    prompt:
      'In that same room of 23 people, what is the probability that someone shares *your* birthday specifically?',
    subPrompt: 'Ignore leap years and assume every birthday is equally likely.',
    category: 'Logic',
    difficulty: 3,
    tags: ['probability', 'classic'],
    answer: 5.9,
    displayAnswer: 'about 5.9%',
    tolerance: 8,
    reveal: {
      headline: '5.9%',
      explanation:
        'Now there are only 22 pairs that matter, not 253 — you against each other person. The probability is 1 minus (364/365) to the power of 22.',
      comparison: 'The famous 50.7% answer and this 5.9% answer come from the same room. That gap is exactly why the birthday problem fools people.',
    },
    source: {
      citation: 'Standard probability result',
      kind: 'definitional',
    },
  },
  {
    id: 'logic.monty-hall',
    type: 'probability',
    prompt:
      'Three doors: one hides a car, two hide goats. You pick one. The host, who knows what is behind each door, opens a different door to reveal a goat and offers you the switch. What is the probability you win the car if you switch?',
    category: 'Logic',
    difficulty: 3,
    tags: ['probability', 'classic'],
    answer: 66.7,
    displayAnswer: 'about 66.7% (two thirds)',
    tolerance: 12,
    timeLimitSec: 60,
    reveal: {
      headline: 'Two thirds',
      explanation:
        'Your first pick was right one time in three, and that never changes. So two times in three the car is behind one of the other doors — and the host has just told you which one.',
      comparison: 'When this appeared in a magazine column in 1990, roughly ten thousand readers wrote in to say it was wrong. Including mathematicians. It was not wrong.',
    },
    source: {
      citation: 'The Monty Hall problem — standard probability result',
      kind: 'definitional',
      assumptions: [
        'The host always opens a losing door and always offers the switch.',
      ],
    },
  },
  {
    id: 'logic.bayes-test',
    type: 'probability',
    prompt:
      'A disease affects 1% of people. A test catches 99% of real cases, but also returns a false positive for 5% of healthy people. You test positive. What is the probability you actually have it?',
    category: 'Logic',
    difficulty: 4,
    tags: ['probability', 'bayes'],
    answer: 16.7,
    displayAnswer: 'about 16.7%',
    tolerance: 13,
    timeLimitSec: 70,
    reveal: {
      headline: '16.7%',
      explanation:
        'Take 1,000 people. Ten have the disease and about ten of those test positive. Of the 990 healthy ones, about 50 also test positive. So 50 of the 60 positives are false alarms.',
      comparison: 'The test is 99% sensitive and you still probably do not have the disease. Rare conditions drown accurate tests in false positives.',
    },
    source: {
      citation: 'Bayes’ theorem — standard result',
      kind: 'definitional',
    },
  },
  {
    id: 'logic.ten-flips',
    type: 'probability',
    prompt: 'Flip a fair coin ten times. What is the probability of getting exactly five heads?',
    category: 'Logic',
    difficulty: 2,
    tags: ['probability'],
    answer: 24.6,
    displayAnswer: 'about 24.6%',
    tolerance: 11,
    reveal: {
      headline: '24.6%',
      explanation:
        'There are 252 ways to get exactly five heads out of 1,024 possible sequences. Five is the single most likely result, but it still happens less than a quarter of the time.',
      comparison: 'Most people say 50%. That is the probability of *around* five heads, not exactly five.',
    },
    source: {
      citation: 'Binomial distribution',
      kind: 'definitional',
    },
  },
  {
    id: 'logic.dice-seven',
    type: 'probability',
    prompt: 'Roll two ordinary six-sided dice. What is the probability the total is exactly 7?',
    category: 'Logic',
    difficulty: 1,
    tags: ['probability'],
    answer: 16.7,
    displayAnswer: 'about 16.7% (1 in 6)',
    tolerance: 9,
    reveal: {
      headline: '1 in 6',
      explanation:
        'Six of the 36 possible combinations add to seven, more than for any other total. That is why seven does so much work in dice games.',
      comparison: 'Compare it with 12, which happens only one time in 36.',
    },
    source: {
      citation: 'Elementary probability',
      kind: 'definitional',
    },
  },
  {
    id: 'logic.bat-and-ball',
    type: 'numeric',
    prompt: 'A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. How much does the ball cost?',
    category: 'Logic',
    difficulty: 2,
    tags: ['reasoning', 'classic'],
    answer: 5,
    displayAnswer: '5 cents',
    unit: 'cents',
    magnitude: 'small',
    tolerance: 0.035,
    timeLimitSec: 40,
    reveal: {
      headline: '5 cents',
      explanation:
        'If the ball were 10 cents, the bat would be $1.10 and the pair would cost $1.20. At 5 cents the bat is $1.05, and together they make $1.10.',
      comparison: 'More than half of students at top universities answer 10 cents. The wrong answer arrives faster than the right one.',
    },
    source: {
      citation: 'Frederick, "Cognitive Reflection and Decision Making"',
      year: 2005,
      kind: 'definitional',
    },
  },
  {
    id: 'logic.widgets',
    type: 'numeric',
    prompt:
      'If 5 machines take 5 minutes to make 5 widgets, how long would 100 machines take to make 100 widgets?',
    category: 'Logic',
    difficulty: 2,
    tags: ['reasoning', 'classic'],
    answer: 5,
    displayAnswer: '5 minutes',
    unit: 'minutes',
    magnitude: 'small',
    tolerance: 0.035,
    timeLimitSec: 40,
    reveal: {
      headline: '5 minutes',
      explanation:
        'Each machine makes one widget in five minutes. Adding machines adds output, not speed — 100 machines make 100 widgets in the same five minutes.',
      comparison: 'The number 100 is a trap. It invites you to scale something that does not need scaling.',
    },
    source: {
      citation: 'Frederick, "Cognitive Reflection and Decision Making"',
      year: 2005,
      kind: 'definitional',
    },
  },
  {
    id: 'logic.lily-pads',
    type: 'numeric',
    prompt:
      'A patch of lily pads doubles in size every day. It covers the whole lake on day 48. On which day was the lake half covered?',
    category: 'Logic',
    difficulty: 2,
    tags: ['reasoning', 'classic', 'exponential'],
    answer: 47,
    displayAnswer: 'Day 47',
    unit: 'day',
    magnitude: 'small',
    tolerance: 0.035,
    timeLimitSec: 40,
    reveal: {
      headline: 'Day 47',
      explanation:
        'Doubling means the day before full is exactly half. On day 41 the lake is less than 1% covered — a week before it disappears entirely.',
      comparison: 'This is why exponential growth always looks like nothing is happening, right up until it is too late.',
    },
    source: {
      citation: 'Frederick, "Cognitive Reflection and Decision Making"',
      year: 2005,
      kind: 'definitional',
    },
  },
  {
    id: 'logic.two-envelopes',
    type: 'multiple-choice',
    prompt:
      'You flip a fair coin 5 times and get heads every time. What is the probability the next flip is heads?',
    category: 'Logic',
    difficulty: 1,
    tags: ['probability'],
    options: ['Less than 50%', 'Exactly 50%', 'More than 50%', 'It depends on the coin'],
    answer: 1,
    reveal: {
      headline: 'Exactly 50%',
      explanation:
        'The coin has no memory. Five heads in a row is unremarkable — it happens about one time in 32 — and it tells you nothing about flip number six.',
      comparison: 'Believing otherwise is the gambler’s fallacy, and casinos have built a lot of carpet on it.',
    },
    source: {
      citation: 'Elementary probability',
      kind: 'definitional',
      assumptions: ['The coin is stated to be fair.'],
    },
  },
];
