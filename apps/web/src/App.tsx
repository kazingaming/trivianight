import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

import { Home } from './screens/Home.js';
import { SoloScreen } from './screens/Solo.js';
import { HowToPlay } from './screens/HowToPlay.js';
import { SettingsScreen } from './screens/Settings.js';
import { MultiplayerScreen } from './screens/Multiplayer.js';
import { QuickMatchScreen } from './screens/QuickMatch.js';
import { RoomScreen } from './screens/Room.js';
import { NotFound } from './screens/NotFound.js';
import { AccountScreen, ProfilePicture } from './screens/Account.js';

import { IconMuted, IconSettings, IconSound, Logo, ToastLayer, type Toast } from './components/primitives.js';
import { applyMotionAttribute, useSettings } from './state/settings.js';
import { useRoom } from './state/room.js';
import { useAccount } from './state/account.js';
import { useSystemReducedMotion } from './lib/hooks.js';
import { sfx } from './lib/audio.js';

export function App() {
  const location = useLocation();
  const settings = useSettings((state) => state.settings);
  const update = useSettings((state) => state.update);
  const setSystemReducedMotion = useSettings((state) => state.setSystemReducedMotion);
  const systemReduced = useSystemReducedMotion();

  // Ask once, at startup. Nothing waits on the answer; a guest simply never
  // sees an account control.
  const refreshAccount = useAccount((state) => state.refresh);
  const accountStatus = useAccount((state) => state.status);
  const accountConfig = useAccount((state) => state.config);
  const profile = useAccount((state) => state.profile);
  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((message: string, tone: Toast['tone'] = 'error') => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, []);

  // Surface room errors once, then clear them so they cannot re-fire.
  const roomError = useRoom((state) => state.error);
  const clearError = useRoom((state) => state.clearError);
  useEffect(() => {
    if (!roomError) return;
    pushToast(roomError.message, 'error');
    clearError();
  }, [roomError, clearError, pushToast]);

  useEffect(() => {
    setSystemReducedMotion(systemReduced);
    applyMotionAttribute();
  }, [systemReduced, setSystemReducedMotion]);

  const inGame = location.pathname.startsWith('/solo') || location.pathname.startsWith('/room');

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="topbar">
        <Link to="/" className="topbar__brand" aria-label="Close Enough home">
          <Logo />
          <span>Close Enough</span>
        </Link>

        <div className="topbar__actions">
          {accountStatus === 'signed-in' && profile ? (
            <Link to="/account" className="topbar__account" title={`Signed in as ${profile.username}`}>
              <ProfilePicture profile={profile} size={26} />
              <span className="topbar__account-name">{profile.username}</span>
            </Link>
          ) : accountConfig.available && !inGame ? (
            <Link to="/account" className="btn btn--ghost btn--sm">
              Sign in
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={() => {
              sfx.unlock();
              update({ sound: !settings.sound });
            }}
            aria-label={settings.sound ? 'Mute sound' : 'Unmute sound'}
            aria-pressed={settings.sound}
            title={settings.sound ? 'Sound on' : 'Sound off'}
          >
            {settings.sound ? <IconSound /> : <IconMuted />}
          </button>
          {!inGame ? (
            <Link
              to="/settings"
              className="btn btn--ghost btn--icon"
              aria-label="Settings"
              title="Settings"
            >
              <IconSettings />
            </Link>
          ) : null}
        </div>
      </header>

      <main id="main" className="shell__main">
        {/*
          Enter-only transition. An exit animation here would need
          AnimatePresence mode="wait", which can strand the outgoing screen and
          leave navigation looking broken — not a trade worth making for a fade.
        */}
        <motion.div
          key={routeKey(location.pathname)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/solo" element={<SoloScreen />} />
            <Route path="/how-to-play" element={<HowToPlay />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/account" element={<AccountScreen />} />
            <Route path="/quick/:mode" element={<QuickMatchScreen />} />
            <Route path="/private" element={<MultiplayerScreen />} />
            <Route path="/room/:code" element={<RoomScreen />} />
            {/* Kept so older links and bookmarks still land somewhere sensible. */}
            <Route path="/play/:mode" element={<MultiplayerScreen />} />
            <Route path="/join" element={<MultiplayerScreen />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </motion.div>
      </main>

      <ToastLayer toasts={toasts} />
    </div>
  );
}

/**
 * Transitions should fire between screens, not between rounds of the same
 * game, so a room keeps one key for its whole life.
 */
function routeKey(pathname: string): string {
  if (pathname.startsWith('/room/')) return 'room';
  if (pathname.startsWith('/solo')) return 'solo';
  if (pathname.startsWith('/quick/')) return 'quick';
  if (pathname.startsWith('/private') || pathname.startsWith('/play/') || pathname.startsWith('/join')) {
    return 'multiplayer';
  }
  return pathname;
}
