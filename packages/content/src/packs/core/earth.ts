import type { Question } from '@trivia/shared';

/** Earth, oceans, geography and weather. */
export const earthQuestions: Question[] = [
  {
    id: 'earth.land-share',
    type: 'percentage',
    prompt: 'What percentage of Earth’s surface is land rather than water?',
    category: 'Geography',
    difficulty: 1,
    tags: ['oceans'],
    answer: 29,
    displayAnswer: 'about 29%',
    tolerance: 10,
    reveal: {
      headline: 'about 29%',
      explanation:
        'Land covers roughly 149 million square kilometres of a 510 million square kilometre surface. Only about a tenth of the planet surface is land that people can comfortably live on.',
      comparison: 'Seen from the Pacific side, Earth looks almost entirely blue — that hemisphere is over 80% water.',
    },
    source: {
      citation: 'Standard geodetic figures',
      kind: 'measured',
    },
  },
  {
    id: 'earth.pacific-share',
    type: 'percentage',
    prompt: 'What percentage of Earth’s total surface area is covered by the Pacific Ocean?',
    category: 'Geography',
    difficulty: 3,
    tags: ['oceans'],
    answer: 30,
    displayAnswer: 'about 30%',
    tolerance: 12,
    reveal: {
      headline: 'about 30%',
      explanation:
        'The Pacific covers roughly 165 million square kilometres — more than all of Earth’s land area combined, and about a third of the entire planet’s surface.',
      comparison: 'Every continent on Earth could fit inside the Pacific with room to spare.',
    },
    source: {
      citation: 'NOAA / standard oceanographic figures',
      publisher: 'NOAA',
      kind: 'measured',
    },
  },
  {
    id: 'earth.water-volume',
    type: 'numeric',
    prompt: 'What is the total volume of all water on Earth?',
    category: 'Earth',
    difficulty: 3,
    tags: ['oceans', 'water'],
    answer: 1.386e9,
    displayAnswer: 'about 1.386 billion km³',
    unit: 'km³',
    magnitude: 'billions',
    tolerance: 0.4,
    reveal: {
      headline: '1.386 billion km³',
      explanation:
        'Over 96% of it is salty ocean. Gathered into a single sphere, all the water on Earth would be a ball only about 1,385 km across.',
      comparison: 'That ball would look surprisingly small next to the planet — Earth is a wet rock, not a water world.',
    },
    source: {
      citation: 'Water Science School',
      publisher: 'U.S. Geological Survey',
      url: 'https://www.usgs.gov',
      kind: 'estimated',
    },
  },
  {
    id: 'earth.antarctic-freshwater',
    type: 'percentage',
    prompt: 'What share of the world’s fresh water is locked up in the Antarctic ice sheet?',
    category: 'Earth',
    difficulty: 3,
    tags: ['ice', 'water'],
    answer: 70,
    displayAnswer: 'about 70%',
    tolerance: 13,
    reveal: {
      headline: 'about 70%',
      explanation:
        'Antarctica holds around 90% of the world’s ice and roughly 70% of its fresh water. If the whole sheet melted, global sea level would rise by about 58 metres.',
      comparison: 'The ice is up to 4.8 km thick — deep enough to bury mountain ranges completely.',
    },
    source: {
      citation: 'Water Science School / British Antarctic Survey',
      publisher: 'U.S. Geological Survey',
      url: 'https://www.usgs.gov',
      kind: 'estimated',
    },
  },
  {
    id: 'earth.sahara-area',
    type: 'numeric',
    prompt: 'What is the area of the Sahara Desert?',
    category: 'Geography',
    difficulty: 2,
    tags: ['deserts'],
    answer: 9_200_000,
    displayAnswer: 'about 9.2 million km²',
    unit: 'km²',
    magnitude: 'millions',
    tolerance: 0.26,
    reveal: {
      headline: '9.2 million km²',
      explanation:
        'The Sahara stretches across eleven countries and is close in size to the whole of China, or to the United States including Alaska.',
      comparison: 'It has not always been sand: 6,000 years ago much of it was grassland dotted with lakes.',
    },
    source: {
      citation: 'Standard geographic references',
      kind: 'measured',
    },
  },
  {
    id: 'earth.mariana-depth',
    type: 'numeric',
    prompt: 'How deep is the deepest point in the ocean, the Challenger Deep?',
    category: 'Earth',
    difficulty: 2,
    tags: ['oceans'],
    answer: 10_900,
    displayAnswer: 'about 10,900 m',
    unit: 'm',
    magnitude: 'thousands',
    tolerance: 0.16,
    reveal: {
      headline: 'about 10,900 m',
      explanation:
        'Drop Mount Everest into the Mariana Trench and its peak would still sit more than two kilometres below the surface. Pressure down there is over a thousand times atmospheric.',
      comparison: 'More people have walked on the Moon than have reached the bottom of the Challenger Deep.',
    },
    source: {
      citation: 'NOAA Ocean Exploration',
      publisher: 'NOAA',
      kind: 'measured',
      assumptions: ['Sounding surveys differ by tens of metres; roughly 10,900-10,935 m.'],
    },
  },
  {
    id: 'earth.lightning-rate',
    type: 'numeric',
    prompt: 'On average, how many lightning flashes strike Earth every second?',
    category: 'Nature',
    difficulty: 3,
    tags: ['weather'],
    answer: 44,
    displayAnswer: 'about 44 per second',
    unit: 'flashes per second',
    magnitude: 'small',
    tolerance: 0.3,
    reveal: {
      headline: 'about 44 a second',
      explanation:
        'Satellite lightning sensors record roughly 44 flashes per second worldwide, adding up to around 1.4 billion a year. Most of them never touch the ground.',
      comparison: 'There are around 2,000 thunderstorms in progress across the planet at any given moment.',
    },
    source: {
      citation: 'Global Hydrology Resource Center lightning climatology',
      publisher: 'NASA',
      kind: 'measured',
    },
  },
  {
    id: 'earth.russia-land-share',
    type: 'percentage',
    prompt: 'What percentage of Earth’s total land area is Russia?',
    category: 'Geography',
    difficulty: 2,
    tags: ['countries'],
    answer: 11,
    displayAnswer: 'about 11%',
    tolerance: 6,
    reveal: {
      headline: 'about 11%',
      explanation:
        'Russia covers 17.1 million square kilometres out of roughly 149 million of land. It spans eleven time zones and shares a border with fourteen countries.',
      comparison: 'Russia is closer in area to the surface of Pluto than to any other country on Earth.',
    },
    source: {
      citation: 'Standard geographic references',
      kind: 'measured',
    },
  },
  {
    id: 'earth.country-area-order',
    type: 'order',
    prompt: 'Put these countries in order of land area.',
    instruction: 'Largest first',
    category: 'Geography',
    difficulty: 2,
    tags: ['countries'],
    items: [
      { id: 'ru', label: 'Russia', detail: '17.1 million km²' },
      { id: 'ca', label: 'Canada', detail: '10.0 million km²' },
      { id: 'br', label: 'Brazil', detail: '8.5 million km²' },
      { id: 'au', label: 'Australia', detail: '7.7 million km²' },
    ],
    reveal: {
      explanation:
        'Russia is nearly twice the size of Canada, and Canada, Brazil and Australia are closer together than most maps suggest. Mercator projections badly exaggerate the far north.',
      comparison: 'Brazil is bigger than the contiguous United States, which surprises almost everyone.',
    },
    source: {
      citation: 'Standard geographic references',
      kind: 'measured',
    },
  },
  {
    id: 'earth.population-order',
    type: 'order',
    prompt: 'Put these countries in order of population.',
    instruction: 'Most people first',
    category: 'Geography',
    difficulty: 3,
    tags: ['countries', 'population'],
    items: [
      { id: 'id', label: 'Indonesia', detail: 'about 285 million' },
      { id: 'pk', label: 'Pakistan', detail: 'about 250 million' },
      { id: 'ng', label: 'Nigeria', detail: 'about 230 million' },
      { id: 'br', label: 'Brazil', detail: 'about 215 million' },
    ],
    reveal: {
      explanation:
        'All four are within about 70 million of each other, which makes the ordering genuinely hard. Nigeria is the fastest growing of the group and is projected to pass all of them within decades.',
      comparison: 'Indonesia is spread across roughly 17,000 islands, and more than half its people live on just one of them.',
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
    id: 'earth.sahara-vs-usa',
    type: 'which-is-bigger',
    prompt: 'Which covers more area?',
    category: 'Geography',
    difficulty: 2,
    tags: ['deserts', 'countries'],
    options: [
      { label: 'The Sahara Desert', detail: '9.2 million km²' },
      { label: 'The contiguous United States', detail: '8.1 million km²' },
    ],
    answer: 0,
    reveal: {
      headline: 'The Sahara',
      explanation:
        'The Sahara is about 9.2 million square kilometres against roughly 8.1 million for the lower 48 states — so the desert would blanket the mainland US and still spill over the edges.',
      comparison: 'Add Alaska and Hawaii and the United States nudges ahead, at about 9.8 million.',
    },
    source: {
      citation: 'Standard geographic references',
      kind: 'measured',
    },
  },
  {
    id: 'earth.africa-vs-moon',
    type: 'which-is-bigger',
    prompt: 'Which has the larger surface area?',
    category: 'Space',
    difficulty: 4,
    tags: ['wildcard', 'moon'],
    options: [
      { label: 'The continent of Africa', detail: '30.4 million km²' },
      { label: 'The entire surface of the Moon', detail: '37.9 million km²' },
    ],
    answer: 1,
    reveal: {
      headline: 'The Moon',
      explanation:
        'The Moon has about 37.9 million square kilometres of surface against Africa’s 30.4 million. A sphere with a quarter of Earth’s diameter still adds up to a lot of ground.',
      comparison: 'The whole Moon is roughly the area of Africa plus Australia.',
    },
    source: {
      citation: 'NASA lunar fact sheet / standard geographic references',
      publisher: 'NASA',
      kind: 'measured',
    },
  },
];
