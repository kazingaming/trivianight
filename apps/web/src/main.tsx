import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// Fonts are bundled rather than fetched, so the game looks right offline and
// never flashes a fallback face mid-round.
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';

import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/game.css';

import { App } from './App.js';
import { applyMotionAttribute, useSettings } from './state/settings.js';
import { sfx } from './lib/audio.js';

// Apply persisted preferences before the first paint, and start listening for
// the gesture that unlocks audio. Mobile browsers keep an AudioContext
// suspended until one arrives, and suspend it again whenever the page is
// backgrounded, so the kit watches for both rather than trying once.
const { settings } = useSettings.getState();
sfx.configure(settings.sound, settings.volume);
sfx.install();
applyMotionAttribute();

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
