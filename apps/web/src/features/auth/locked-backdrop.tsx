/**
 * Honest structural workbench backdrop shown behind the glassmorphic AuthModal
 * during unauthenticated cold visits (never displays fabricated numbers or schedules).
 */
export function LockedWorkbenchBackdrop() {
  return (
    <div className="auth-locked-backdrop" aria-hidden="true">
      <div className="auth-locked-metrics">
        {[0, 1, 2, 3].map((slot) => (
          <div key={slot} className="surface-card auth-locked-metric-card">
            <span className="auth-skel auth-skel-sm" />
            <span className="auth-skel auth-skel-lg" />
            <span className="auth-skel auth-skel-md" />
          </div>
        ))}
      </div>
      <div className="auth-locked-bento">
        <div className="surface-card auth-locked-hero">
          <div className="auth-locked-hero-tags">
            <span />
            <span />
          </div>
          <div className="auth-locked-hero-ring">
            <span />
          </div>
          <div className="auth-locked-hero-actions">
            <span className="is-primary" />
            <span />
          </div>
        </div>
        <div className="auth-locked-side">
          <div className="surface-card auth-locked-side-card">
            <span className="auth-skel auth-skel-md" />
            <span className="auth-skel auth-skel-lg" />
            <span className="auth-skel auth-skel-bar" />
            <span className="auth-skel auth-skel-box" />
          </div>
          <div className="surface-card auth-locked-side-card">
            <span className="auth-skel auth-skel-md" />
            <span className="auth-skel auth-skel-full" />
            <span className="auth-skel auth-skel-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
