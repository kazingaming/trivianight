import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="placeholder">
      <div className="stack center" style={{ gap: 'var(--sp-4)', maxWidth: '38ch' }}>
        <p className="eyebrow">404</p>
        <h1 style={{ fontSize: 'var(--step-3)' }}>Nothing here.</h1>
        <p className="muted">
          Estimate how far off you were, then head back. (Answer: quite far.)
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn btn--primary">
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}
