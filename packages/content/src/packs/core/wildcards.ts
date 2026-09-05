import type { Question } from '@trivia/shared';

/**
 * Wildcards and the deep end.
 *
 * Quantities that are genuinely absurd, but still reachable if you are willing
 * to multiply carefully and trust the result. These exist for the reveal.
 */
export const wildcardQuestions: Question[] = [
  {
    id: 'wild.paper-folds',
    type: 'numeric',
    prompt:
      'A sheet of paper 0.1 mm thick is folded in half 42 times. How thick is the resulting stack?',
    subPrompt: 'Assume the folding is physically possible.',
    category: 'Logic',
    difficulty: 5,
    tags: ['exponential', 'wildcard'],
    answer: 440_000,
    displayAnswer: 'about 440,000 km',
    unit: 'km',
    magnitude: 'thousands',
    tolerance: 0.7,
    timeLimitSec: 60,
    reveal: {
      headline: 'about 440,000 km',
      explanation:
        'Doubling 0.1 mm forty-two times gives roughly 440,000 km. Seven folds gets you the thickness of a notebook; twenty-three reaches a kilometre; forty-two passes the Moon.',
      comparison: 'The Moon is 384,400 km away. Forty-two folds overshoots it.',
    },
    source: {
      citation: 'Direct calculation: 0.1 mm x 2^42',
      kind: 'definitional',
      assumptions: ['Paper cannot actually be folded this many times. The maths still holds.'],
    },
  },
  {
    id: 'wild.atoms-in-sand-grain',
    type: 'numeric',
    prompt: 'How many atoms are in a single grain of sand?',
    subPrompt: 'Take a quartz grain about 1 mm across.',
    category: 'Science',
    difficulty: 5,
    tags: ['atoms', 'wildcard'],
    answer: 8e19,
    displayAnswer: 'roughly 8 x 10^19',
    unit: 'atoms',
    magnitude: 'astronomical',
    tolerance: 0.8,
    timeLimitSec: 60,
    reveal: {
      headline: 'roughly 80 quintillion',
      explanation:
        'A 1 mm quartz grain weighs about 2.6 mg. That works out to around 8 x 10^19 atoms of silicon and oxygen.',
      comparison: 'There are roughly ten times more atoms in that one grain than there are grains of sand on every beach on Earth.',
    },
    source: {
      citation: 'Derived from quartz density and molar mass',
      kind: 'estimated',
      assumptions: ['A cubic grain 1 mm on a side, density 2.65 g/cm³, silicon dioxide.'],
    },
  },
  {
    id: 'wild.atmosphere-mass',
    type: 'numeric',
    prompt: 'What is the total mass of Earth’s atmosphere?',
    category: 'Earth',
    difficulty: 4,
    tags: ['atmosphere', 'physics'],
    answer: 5.15e18,
    displayAnswer: 'about 5.15 quintillion kg',
    unit: 'kg',
    magnitude: 'astronomical',
    tolerance: 0.55,
    reveal: {
      headline: 'about 5.15 quintillion kg',
      explanation:
        'You can derive it from air pressure alone: every square metre of ground carries about 10 tonnes of air above it, and Earth has about 510 trillion square metres of surface.',
      comparison: 'Only about a millionth of Earth’s total mass — the atmosphere is a very thin skin.',
    },
    source: {
      citation: 'Trenberth & Smith, "The Mass of the Atmosphere"',
      publisher: 'Journal of Climate',
      year: 2005,
      kind: 'measured',
    },
  },
  {
    id: 'wild.earth-mass',
    type: 'numeric',
    prompt: 'What is the mass of the Earth?',
    category: 'Space',
    difficulty: 4,
    tags: ['physics'],
    answer: 5.97e24,
    displayAnswer: 'about 5.97 x 10^24 kg',
    unit: 'kg',
    magnitude: 'astronomical',
    tolerance: 0.55,
    reveal: {
      headline: 'about 5.97 x 10^24 kg',
      explanation:
        'Nobody weighed it. The figure comes from the strength of Earth’s gravity and the gravitational constant, which Henry Cavendish first measured in 1798 with lead spheres on a torsion balance.',
      comparison: 'The Sun is about 333,000 times heavier.',
    },
    source: {
      citation: 'NASA Earth fact sheet',
      publisher: 'NASA',
      kind: 'measured',
    },
  },
  {
    id: 'wild.sudoku-grids',
    type: 'numeric',
    prompt: 'How many valid completed 9x9 Sudoku grids exist?',
    category: 'Logic',
    difficulty: 5,
    tags: ['combinatorics', 'wildcard'],
    answer: 6.67e21,
    displayAnswer: 'about 6.67 x 10^21',
    unit: 'grids',
    magnitude: 'astronomical',
    tolerance: 0.9,
    timeLimitSec: 60,
    reveal: {
      headline: 'about 6.67 sextillion',
      explanation:
        'Counted exactly in 2005 by brute force and clever symmetry arguments: 6,670,903,752,021,072,936,960 grids. Ignoring rotations and reflections, about 5.5 billion are genuinely distinct.',
      comparison: 'More completed Sudoku grids than there are grains of sand on Earth — by a factor of a thousand.',
    },
    source: {
      citation: 'Felgenhauer & Jarvis, "Enumerating possible Sudoku grids"',
      year: 2005,
      kind: 'definitional',
    },
  },
  {
    id: 'wild.dna-length',
    type: 'numeric',
    prompt: 'If you unravelled the DNA in every cell of one human body and laid it end to end, how long would it be?',
    category: 'Science',
    difficulty: 4,
    tags: ['biology', 'wildcard'],
    answer: 1.2e10,
    displayAnswer: 'roughly 12 billion km',
    unit: 'km',
    magnitude: 'billions',
    tolerance: 0.75,
    timeLimitSec: 60,
    reveal: {
      headline: 'roughly 12 billion km',
      explanation:
        'Each nucleated cell holds about two metres of DNA, and you have on the order of six trillion of them. Red blood cells are excluded — they throw their nuclei away.',
      comparison: 'Pluto is about 6 billion km from the Sun. Your DNA would reach there and back.',
    },
    source: {
      citation: 'Derived from Hatton et al. (PNAS, 2023) cell counts and genome length',
      kind: 'estimated',
      assumptions: ['About 2 m of DNA per nucleated cell; enucleated red blood cells excluded.'],
    },
  },
  {
    id: 'wild.people-asleep',
    type: 'numeric',
    prompt: 'At this exact moment, roughly how many people around the world are asleep?',
    category: 'People',
    difficulty: 4,
    tags: ['fermi', 'behaviour'],
    answer: 2.6e9,
    displayAnswer: 'roughly 2.6 billion',
    unit: 'people',
    magnitude: 'billions',
    tolerance: 0.4,
    timeLimitSec: 60,
    reveal: {
      headline: 'roughly 2.6 billion',
      explanation:
        'People sleep about a third of the time, so on average about a third of humanity is asleep at any instant. The real figure swings by hundreds of millions depending on whether Asia is in darkness.',
      comparison: 'A third of the species is unconscious right now, and nobody finds that strange.',
    },
    source: {
      citation: 'Derived from world population and average sleep duration',
      statisticYear: 2024,
      kind: 'estimated',
      volatile: true,
      assumptions: ['About 8 billion people sleeping roughly 8 hours in every 24.'],
    },
  },
  {
    id: 'wild.alphabet-orders',
    type: 'numeric',
    prompt: 'How many different ways can the 26 letters of the alphabet be arranged?',
    category: 'Logic',
    difficulty: 4,
    tags: ['combinatorics'],
    answer: 4.03e26,
    displayAnswer: 'about 4 x 10^26',
    unit: 'orderings',
    magnitude: 'astronomical',
    tolerance: 0.75,
    reveal: {
      headline: 'about 403 septillion',
      explanation:
        '26 factorial is 403,291,461,126,605,635,584,000,000. Twenty-six items is a small set; factorials are not.',
      comparison: 'If every person alive listed one arrangement per second, it would take a billion years to finish.',
    },
    source: {
      citation: '26 factorial',
      kind: 'definitional',
    },
  },
  {
    id: 'wild.living-share',
    type: 'percentage',
    prompt: 'Of all the modern humans who have ever been born, what percentage are alive today?',
    category: 'People',
    difficulty: 4,
    tags: ['population', 'history'],
    answer: 6.8,
    displayAnswer: 'about 6.8%',
    tolerance: 8,
    reveal: {
      headline: 'about 6.8%',
      explanation:
        'Around 117 billion people have ever been born and roughly 8 billion are alive, so about one in fifteen. The old line that "most people who ever lived are alive today" was never true.',
      comparison: 'The dead outnumber the living roughly fourteen to one.',
    },
    source: {
      citation: 'Population Reference Bureau, "How Many People Have Ever Lived on Earth?"',
      publisher: 'Population Reference Bureau',
      year: 2022,
      statisticYear: 2022,
      url: 'https://www.prb.org',
      kind: 'modelled',
    },
  },
];
