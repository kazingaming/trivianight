import type { Question } from '@trivia/shared';

/**
 * Anchors — the easy tier.
 *
 * These are the reference points players will reason *from* later in a run.
 * Knowing the world holds about 8 billion people is what makes "how many
 * people are blind" tractable at all. Every mode opens here.
 */
export const anchorQuestions: Question[] = [
  {
    id: 'anchors.world-population',
    type: 'numeric',
    prompt: 'How many people are alive on Earth right now?',
    category: 'People',
    difficulty: 1,
    tags: ['population', 'anchor'],
    answer: 8.2e9,
    displayAnswer: 'about 8.2 billion',
    unit: 'people',
    magnitude: 'billions',
    tolerance: 0.14,
    reveal: {
      headline: 'about 8.2 billion',
      explanation:
        'The world passed 8 billion in November 2022. Growth is slowing sharply — the annual rate has more than halved since its 1960s peak.',
      comparison: 'Keep this number handy. Half the questions in this game get easier once you can divide by 8 billion.',
    },
    source: {
      citation: 'World Population Prospects',
      publisher: 'United Nations',
      statisticYear: 2024,
      url: 'https://ourworldindata.org',
      kind: 'estimated',
      volatile: true,
    },
  },
  {
    id: 'anchors.un-members',
    type: 'numeric',
    prompt: 'How many countries are member states of the United Nations?',
    category: 'Geography',
    difficulty: 1,
    tags: ['countries', 'anchor'],
    answer: 193,
    displayAnswer: '193',
    unit: 'countries',
    magnitude: 'small',
    tolerance: 0.09,
    reveal: {
      headline: '193',
      explanation:
        'The count has grown from 51 founding members in 1945. South Sudan, admitted in 2011, was the most recent addition.',
      comparison: 'Vatican City and Palestine sit outside as permanent observers rather than members.',
    },
    source: {
      citation: 'United Nations member states',
      publisher: 'United Nations',
      statisticYear: 2024,
      kind: 'measured',
    },
  },
  {
    id: 'anchors.everest',
    type: 'numeric',
    prompt: 'How high is the summit of Mount Everest above sea level?',
    category: 'Geography',
    difficulty: 1,
    tags: ['mountains', 'anchor'],
    answer: 8849,
    displayAnswer: '8,849 m',
    unit: 'm',
    magnitude: 'thousands',
    tolerance: 0.12,
    reveal: {
      headline: '8,849 m',
      explanation:
        'China and Nepal jointly announced this revised height in 2020, adding about 86 cm to the previous figure. The mountain also grows a few millimetres a year as India pushes into Asia.',
      comparison: 'Cruising altitude for an airliner is around 11,000 m — only two kilometres above the summit.',
    },
    source: {
      citation: 'Joint China-Nepal survey',
      year: 2020,
      kind: 'measured',
    },
  },
  {
    id: 'anchors.moon-distance',
    type: 'numeric',
    prompt: 'How far away is the Moon?',
    category: 'Space',
    difficulty: 1,
    tags: ['moon', 'anchor'],
    answer: 384_400,
    displayAnswer: 'about 384,400 km',
    unit: 'km',
    magnitude: 'thousands',
    tolerance: 0.18,
    reveal: {
      headline: 'about 384,400 km',
      explanation:
        'That is the average — the orbit is elliptical, so the distance swings by about 42,000 km over a month. The Moon is also drifting away at roughly 3.8 cm a year.',
      comparison: 'Apollo took three days to cover it. Light takes 1.3 seconds.',
    },
    source: {
      citation: 'NASA Moon fact sheet',
      publisher: 'NASA',
      kind: 'measured',
    },
  },
  {
    id: 'anchors.sunlight-delay',
    type: 'numeric',
    prompt: 'How long does sunlight take to reach Earth?',
    category: 'Space',
    difficulty: 1,
    tags: ['sun', 'anchor'],
    answer: 8.3,
    displayAnswer: 'about 8 minutes 20 seconds',
    unit: 'minutes',
    magnitude: 'small',
    tolerance: 0.2,
    reveal: {
      headline: 'about 8 minutes 20 seconds',
      explanation:
        'Light covers the 150 million km from the Sun in a little over eight minutes. You never see the Sun as it is now — only as it was.',
      comparison: 'A photon can take tens of thousands of years to escape the Sun’s interior, then crosses to Earth in eight minutes.',
    },
    source: {
      citation: 'NASA Sun fact sheet',
      publisher: 'NASA',
      kind: 'measured',
    },
  },
  {
    id: 'anchors.body-water',
    type: 'percentage',
    prompt: 'What percentage of an adult human body is water, by mass?',
    category: 'Science',
    difficulty: 1,
    tags: ['body', 'anchor'],
    answer: 60,
    displayAnswer: 'about 60%',
    tolerance: 12,
    reveal: {
      headline: 'about 60%',
      explanation:
        'It varies with age and body composition: newborns are around 75% water, and fat tissue holds much less of it than muscle.',
      comparison: 'Your brain and heart are closer to 73% water. Even your bones are about 31%.',
    },
    source: {
      citation: 'Water Science School',
      publisher: 'U.S. Geological Survey',
      url: 'https://www.usgs.gov',
      kind: 'estimated',
    },
  },
  {
    id: 'anchors.asia-share',
    type: 'percentage',
    prompt: 'What percentage of the world’s population lives in Asia?',
    category: 'People',
    difficulty: 1,
    tags: ['population', 'anchor'],
    answer: 59,
    displayAnswer: 'about 59%',
    tolerance: 16,
    reveal: {
      headline: 'about 59%',
      explanation:
        'Nearly three people in five live in Asia. India and China alone account for roughly 35% of everyone on Earth.',
      comparison: 'Africa is second at about 18%, and is the only continent whose share is rising quickly.',
    },
    source: {
      citation: 'World Population Prospects',
      publisher: 'United Nations',
      statisticYear: 2024,
      kind: 'estimated',
      volatile: true,
    },
  },
  {
    id: 'anchors.elephant-mass',
    type: 'numeric',
    prompt: 'How much does an adult African bush elephant weigh?',
    category: 'Animals',
    difficulty: 1,
    tags: ['animals', 'anchor'],
    answer: 6000,
    displayAnswer: 'about 6,000 kg',
    unit: 'kg',
    magnitude: 'thousands',
    tolerance: 0.22,
    reveal: {
      headline: 'about 6,000 kg',
      explanation:
        'Bulls average around six tonnes and can exceed ten. They are the largest land animals alive, and they eat up to 150 kg of vegetation a day to stay that way.',
      comparison: 'Roughly four family cars, walking around on four legs.',
    },
    source: {
      citation: 'Standard zoological references',
      kind: 'estimated',
    },
  },
  {
    id: 'anchors.airliner-speed',
    type: 'numeric',
    prompt: 'How fast does a typical passenger jet cruise?',
    category: 'Technology',
    difficulty: 1,
    tags: ['aviation', 'anchor'],
    answer: 900,
    displayAnswer: 'about 900 km/h',
    unit: 'km/h',
    magnitude: 'small',
    tolerance: 0.16,
    reveal: {
      headline: 'about 900 km/h',
      explanation:
        'Most airliners cruise near Mach 0.8. Ground speed can differ hugely from that — a strong jet stream tailwind can add 200 km/h or more.',
      comparison: 'Concorde cruised at about 2,180 km/h. Nothing carrying passengers has gone that fast since 2003.',
    },
    source: {
      citation: 'Manufacturer cruise specifications',
      kind: 'measured',
    },
  },
  {
    id: 'anchors.nile-length',
    type: 'numeric',
    prompt: 'How long is the Nile?',
    category: 'Geography',
    difficulty: 1,
    tags: ['rivers', 'anchor'],
    answer: 6650,
    displayAnswer: 'about 6,650 km',
    unit: 'km',
    magnitude: 'thousands',
    tolerance: 0.2,
    reveal: {
      headline: 'about 6,650 km',
      explanation:
        'The Nile runs through eleven countries. Whether it or the Amazon is the longest river on Earth depends on where you decide the Amazon actually starts — the two are within a few hundred kilometres of each other.',
      comparison: 'Long enough to cross the continental United States and start again.',
    },
    source: {
      citation: 'Standard geographic references',
      kind: 'estimated',
      assumptions: ['River lengths vary by source depending on the chosen source stream.'],
    },
  },
  {
    id: 'anchors.speed-order',
    type: 'order',
    prompt: 'Put these in order of top speed.',
    instruction: 'Fastest first',
    category: 'Animals',
    difficulty: 1,
    tags: ['animals', 'speed'],
    items: [
      { id: 'falcon', label: 'Peregrine falcon (diving)', detail: 'about 390 km/h' },
      { id: 'cheetah', label: 'Cheetah', detail: 'about 110 km/h' },
      { id: 'greyhound', label: 'Greyhound', detail: 'about 70 km/h' },
      { id: 'sprinter', label: 'Usain Bolt at full speed', detail: 'about 45 km/h' },
    ],
    reveal: {
      explanation:
        'The falcon is the fastest animal on Earth, but only while falling — in level flight it is slower than a cheetah. Bolt’s 45 km/h is a peak over a few metres, not his average.',
      comparison: 'A cheetah can reach 100 km/h in about three seconds. Most sports cars cannot.',
    },
    source: {
      citation: 'Standard zoological references; IAAF race telemetry',
      kind: 'measured',
    },
  },
  {
    id: 'anchors.greenland-vs-australia',
    type: 'which-is-bigger',
    prompt: 'Which has the larger land area?',
    category: 'Geography',
    difficulty: 1,
    tags: ['maps', 'countries'],
    options: [
      { label: 'Greenland', detail: '2.2 million km²' },
      { label: 'Australia', detail: '7.7 million km²' },
    ],
    answer: 1,
    reveal: {
      headline: 'Australia, by three and a half times',
      explanation:
        'On the Mercator maps most of us grew up with, Greenland looks about the size of Africa. In reality Africa is fourteen times larger, and Australia alone dwarfs Greenland.',
      comparison: 'Mercator stretches everything near the poles. Greenland is the most famous victim.',
    },
    source: {
      citation: 'Standard geographic references',
      kind: 'measured',
    },
  },
  {
    id: 'anchors.rome-vs-nyc',
    type: 'which-is-closer',
    prompt: 'Which is closer to the equator?',
    category: 'Geography',
    difficulty: 2,
    tags: ['maps', 'cities'],
    options: [
      { label: 'Rome, Italy', detail: '41.9 degrees north' },
      { label: 'New York City, USA', detail: '40.7 degrees north' },
    ],
    answer: 1,
    reveal: {
      headline: 'New York',
      explanation:
        'New York sits slightly further south than Rome. Europe feels warmer for its latitude because the Gulf Stream carries heat north across the Atlantic.',
      comparison: 'London is further north than every part of the contiguous United States — it lines up with northern Newfoundland.',
    },
    source: {
      citation: 'Geographic coordinates',
      kind: 'measured',
    },
  },
];
