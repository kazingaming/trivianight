import type { Question } from '@trivia/shared';

/**
 * History and mythology.
 *
 * The aim is to break the compressed mental model where everything "ancient"
 * feels like it happened at once — not to test whether you memorised a date.
 */
export const historyQuestions: Question[] = [
  {
    id: 'history.cleopatra',
    type: 'which-is-closer',
    prompt: 'Cleopatra lived closer in time to which of these?',
    category: 'History',
    difficulty: 2,
    tags: ['ancient', 'egypt', 'time'],
    options: [
      { label: 'The completion of the Great Pyramid of Giza', detail: 'about 2560 BCE' },
      { label: 'The launch of the first iPhone', detail: '2007 CE' },
    ],
    answer: 1,
    reveal: {
      headline: 'The iPhone',
      explanation:
        'Cleopatra was born around 69 BCE. The Great Pyramid was already about 2,500 years old by then, while the iPhone was only about 2,080 years away.',
      comparison: 'She lived closer to the invention of the smartphone than to the building of the pyramids beside her own capital.',
    },
    source: {
      citation: 'Standard historical chronology; Apple introduced the iPhone in January 2007',
      kind: 'measured',
    },
  },
  {
    id: 'history.trex',
    type: 'which-is-closer',
    prompt: 'Which lived closer in time to Tyrannosaurus rex?',
    category: 'Science',
    difficulty: 2,
    tags: ['dinosaurs', 'time'],
    options: [
      { label: 'Stegosaurus', detail: 'about 150 million years ago' },
      { label: 'You, today', detail: '0 years ago' },
    ],
    answer: 1,
    reveal: {
      headline: 'You are',
      explanation:
        'T. rex lived roughly 68 to 66 million years ago. Stegosaurus died out around 150 million years ago — some 83 million years before T. rex ever appeared.',
      comparison: 'The gap between Stegosaurus and T. rex is bigger than the gap between T. rex and the invention of the internet.',
    },
    source: {
      citation: 'Natural History Museum / Smithsonian dinosaur chronology',
      kind: 'measured',
    },
  },
  {
    id: 'history.mammoths',
    type: 'year',
    prompt: 'In roughly what year did the last woolly mammoths die out?',
    category: 'Science',
    difficulty: 3,
    tags: ['prehistory', 'animals'],
    answer: -1700,
    displayAnswer: 'about 1700 BCE',
    tolerance: 1200,
    reveal: {
      headline: 'about 1700 BCE',
      explanation:
        'Mainland mammoths vanished around 10,000 years ago, but an isolated population survived on Wrangel Island in the Arctic Ocean until roughly 3,700 years ago.',
      comparison: 'Mammoths were still alive when the Great Pyramid was already a thousand years old, and when Stonehenge was standing.',
    },
    source: {
      citation: 'Radiocarbon dating of Wrangel Island remains',
      kind: 'measured',
    },
  },
  {
    id: 'history.pyramid-year',
    type: 'year',
    prompt: 'In roughly what year was the Great Pyramid of Giza completed?',
    category: 'History',
    difficulty: 2,
    tags: ['ancient', 'egypt'],
    answer: -2560,
    displayAnswer: 'about 2560 BCE',
    tolerance: 700,
    reveal: {
      headline: 'about 2560 BCE',
      explanation:
        'Built for the pharaoh Khufu in around twenty years, it stood as the tallest structure made by humans for over 3,800 years — a record no other building has come close to.',
      comparison: 'It was already ancient when Rome was founded, and ancient again by the time Rome fell.',
    },
    source: {
      citation: 'Standard Egyptological chronology',
      kind: 'estimated',
      assumptions: ['Dating of the Fourth Dynasty varies by roughly a century between scholars.'],
    },
  },
  {
    id: 'history.rome-falls',
    type: 'year',
    prompt: 'In what year did the last emperor of the Western Roman Empire lose his throne?',
    category: 'History',
    difficulty: 3,
    tags: ['rome', 'ancient'],
    answer: 476,
    displayAnswer: '476 CE',
    tolerance: 150,
    reveal: {
      headline: '476 CE',
      explanation:
        'Romulus Augustulus was deposed in 476, the date usually given for the fall of the Western Empire. The Eastern half carried on from Constantinople for almost another thousand years.',
      comparison: 'The Roman Empire outlived its own famous fall by 977 years.',
    },
    source: {
      citation: 'Standard historical chronology',
      kind: 'measured',
    },
  },
  {
    id: 'history.printing-press',
    type: 'year',
    prompt: 'In roughly what year did Gutenberg begin printing with movable metal type in Europe?',
    category: 'History',
    difficulty: 2,
    tags: ['inventions'],
    answer: 1440,
    displayAnswer: 'about 1440',
    tolerance: 90,
    reveal: {
      headline: 'about 1440',
      explanation:
        'Gutenberg was working on his press in Mainz by around 1440, and printed his famous Bible by 1455. Movable type already existed in China and Korea centuries earlier.',
      comparison: 'Within fifty years, printers across Europe had produced more books than all of the previous thousand years of copying by hand.',
    },
    source: {
      citation: 'Standard historical chronology',
      kind: 'estimated',
    },
  },
  {
    id: 'history.vikings-america',
    type: 'year',
    prompt: 'In roughly what year did Norse sailors first reach North America?',
    category: 'History',
    difficulty: 3,
    tags: ['vikings', 'exploration'],
    answer: 1000,
    displayAnswer: 'about 1000 CE',
    tolerance: 200,
    reveal: {
      headline: 'about 1000 CE',
      explanation:
        'The Norse settlement at L’Anse aux Meadows in Newfoundland has been dated precisely: timber cut there was felled in the year 1021, thanks to a solar storm that left a marker in tree rings worldwide.',
      comparison: 'Europeans reached America, built houses, gave up and went home — roughly 470 years before Columbus set sail.',
    },
    source: {
      citation: 'Kuitems et al., Nature (2021); UNESCO L’Anse aux Meadows',
      publisher: 'Nature',
      year: 2021,
      kind: 'measured',
    },
  },
  {
    id: 'history.sharks-vs-trees',
    type: 'multiple-choice',
    prompt: 'Which appeared on Earth first?',
    category: 'Science',
    difficulty: 2,
    tags: ['prehistory', 'evolution'],
    options: ['Sharks', 'Trees'],
    answer: 0,
    reveal: {
      headline: 'Sharks',
      explanation:
        'Sharks have been swimming for around 450 million years. The first true trees appeared roughly 385 million years ago.',
      comparison: 'Sharks are older than trees, older than Saturn’s rings, and older than the North Star.',
    },
    source: {
      citation: 'Fossil record chronology',
      kind: 'estimated',
    },
  },
  {
    id: 'history.oxford-vs-aztec',
    type: 'multiple-choice',
    prompt: 'Which is older?',
    category: 'History',
    difficulty: 2,
    tags: ['medieval', 'americas'],
    options: ['The University of Oxford', 'The Aztec Empire'],
    answer: 0,
    reveal: {
      headline: 'Oxford',
      explanation:
        'Teaching was under way at Oxford by 1096. Tenochtitlan was founded in 1325 and the Aztec Triple Alliance formed in 1428.',
      comparison: 'Oxford had been running for over three centuries before the Aztec capital existed.',
    },
    source: {
      citation: 'University of Oxford records; standard Mesoamerican chronology',
      kind: 'measured',
    },
  },
  {
    id: 'history.fax-vs-civil-war',
    type: 'multiple-choice',
    prompt: 'Which came first?',
    category: 'History',
    difficulty: 3,
    tags: ['inventions', 'modern'],
    options: ['The first patent for a fax machine', 'The start of the American Civil War'],
    answer: 0,
    reveal: {
      headline: 'The fax machine',
      explanation:
        'Alexander Bain patented an "electric printing telegraph" that could send images over wires in 1843 — eighteen years before the Civil War began in 1861.',
      comparison: 'Fax technology is older than the telephone, the light bulb and the transcontinental railroad.',
    },
    source: {
      citation: 'Bain patent, 1843; standard historical chronology',
      kind: 'measured',
    },
  },
  {
    id: 'history.chronology-order',
    type: 'order',
    prompt: 'Put these events in chronological order.',
    instruction: 'Earliest first',
    category: 'History',
    difficulty: 1,
    tags: ['ancient', 'modern'],
    items: [
      { id: 'stonehenge', label: 'Stonehenge begun', detail: 'about 3000 BCE' },
      { id: 'caesar', label: 'Julius Caesar assassinated', detail: '44 BCE' },
      { id: 'constantinople', label: 'Constantinople falls', detail: '1453 CE' },
      { id: 'moon', label: 'First Moon landing', detail: '1969 CE' },
    ],
    reveal: {
      explanation:
        'The gap between Stonehenge and Caesar is about 2,950 years. The gap between Caesar and the Moon landing is about 2,013 years — so Stonehenge is further from Caesar than Caesar is from us.',
    },
    source: {
      citation: 'Standard historical chronology',
      kind: 'measured',
    },
  },
  {
    id: 'history.landmark-height-order',
    type: 'order',
    prompt: 'Put these structures in order of height.',
    instruction: 'Tallest first',
    category: 'History',
    difficulty: 2,
    tags: ['buildings'],
    items: [
      { id: 'burj', label: 'Burj Khalifa', detail: '828 m' },
      { id: 'eiffel', label: 'Eiffel Tower', detail: '330 m' },
      { id: 'pyramid', label: 'Great Pyramid of Giza', detail: '139 m today, 146 m when built' },
      { id: 'liberty', label: 'Statue of Liberty', detail: '93 m to the torch' },
    ],
    reveal: {
      explanation:
        'The Burj Khalifa is taller than the other three stacked on top of each other. The Great Pyramid held the height record for 3,800 years until Lincoln Cathedral in 1311.',
      comparison: 'The Eiffel Tower took that record back in 1889 and held it for forty years.',
    },
    source: {
      citation: 'Council on Tall Buildings and Urban Habitat; standard references',
      kind: 'measured',
    },
  },
  {
    id: 'history.great-wall',
    type: 'numeric',
    prompt: 'What is the total length of the Great Wall of China, counting every branch and section?',
    category: 'History',
    difficulty: 3,
    tags: ['ancient', 'buildings'],
    answer: 21_196,
    displayAnswer: 'about 21,200 km',
    unit: 'km',
    magnitude: 'thousands',
    tolerance: 0.3,
    reveal: {
      headline: 'about 21,200 km',
      explanation:
        'A five-year archaeological survey completed in 2012 mapped 21,196 km of wall, trenches and natural barriers built across more than two thousand years by successive dynasties.',
      comparison: 'Laid out in a straight line it would stretch more than halfway around the planet.',
    },
    source: {
      citation: 'National cultural heritage survey of the Great Wall',
      publisher: 'State Administration of Cultural Heritage, China',
      year: 2012,
      kind: 'measured',
    },
  },
  {
    id: 'history.heracles-labours',
    type: 'numeric',
    prompt: 'In Greek myth, how many labours was Heracles required to complete?',
    category: 'Mythology',
    difficulty: 1,
    tags: ['greek'],
    answer: 12,
    displayAnswer: '12',
    unit: 'labours',
    magnitude: 'small',
    tolerance: 0.06,
    reveal: {
      headline: 'Twelve',
      explanation:
        'It was meant to be ten. King Eurystheus disqualified two of them — the Hydra, because Heracles had help, and the Augean stables, because he took payment — so two more were added.',
      comparison: 'The labours took twelve years, and they were a punishment, not a quest.',
    },
    source: {
      citation: 'Classical Greek mythology',
      kind: 'definitional',
    },
  },
  {
    id: 'history.sleipnir',
    type: 'multiple-choice',
    prompt: 'In Norse mythology, what is the name of Odin’s eight-legged horse?',
    category: 'Mythology',
    difficulty: 2,
    tags: ['norse'],
    options: ['Fenrir', 'Sleipnir', 'Huginn', 'Gungnir'],
    answer: 1,
    reveal: {
      headline: 'Sleipnir',
      explanation:
        'Sleipnir is described as the finest of all horses, able to travel over sea and air. Fenrir is a wolf, Huginn is one of Odin’s two ravens, and Gungnir is his spear.',
      comparison: 'By one account Sleipnir father was Loki — who was also, in the same story, its mother.',
    },
    source: {
      citation: 'Prose Edda and Poetic Edda',
      kind: 'definitional',
    },
  },
];
