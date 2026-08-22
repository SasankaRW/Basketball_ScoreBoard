/**
 * Match history — completed games, most recent first, each expandable into
 * its full quarter-by-quarter box score.
 */
import { useEffect, useState } from 'react';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import { subscribeMatches, type MatchRecordDoc } from '../../core/matches.js';
import { subscribeTenant, type Tenant } from '../../core/tenant.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import { IconChevronDown, IconChevronUp } from '../components/icons.js';
import { Alert, Spinner } from '../components/ui.js';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

export function HistoryPage() {
  const session = useSession();
  const firestore = getFirestoreClient();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [matches, setMatches] = useState<MatchRecordDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(
    () => subscribeTenant(firestore, session.tenantId, setTenant),
    [firestore, session.tenantId],
  );

  useEffect(
    () =>
      subscribeMatches(firestore, session.tenantId, setMatches, { limit: 200 }, (e) =>
        setError(e.message),
      ),
    [firestore, session.tenantId],
  );

  return (
    <AppShell tenantName={tenant?.name ?? '…'}>
      <div className="page-head">
        <div>
          <h1>Match history</h1>
          <p>Every finished game, with the full quarter-by-quarter score.</p>
        </div>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {matches === null ? (
        <Spinner label="Loading match history…" />
      ) : matches.length === 0 ? (
        <div className="empty">
          <h2>No matches finished yet</h2>
          <p>
            When an operator finishes a game from its control panel, the final score and box score
            land here.
          </p>
        </div>
      ) : (
        <div className="stack">
          {matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              expanded={expandedId === match.id}
              onToggle={() => setExpandedId((current) => (current === match.id ? null : match.id))}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function MatchCard({
  match,
  expanded,
  onToggle,
}: {
  match: MatchRecordDoc;
  expanded: boolean;
  onToggle: () => void;
}) {
  const homeWon = match.homeScore > match.awayScore;
  const awayWon = match.awayScore > match.homeScore;

  return (
    <div className="card">
      <button
        type="button"
        className="match-card__header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="match-card__meta">
          {formatDate(match.endedAt)} · {match.boardName}
        </div>
        <div className="match-card__matchup">
          <span className={homeWon ? 'match-card__team--win' : undefined}>
            {match.homeTeamName}
          </span>
          <span className="match-card__score">
            {match.homeScore}–{match.awayScore}
          </span>
          <span className={awayWon ? 'match-card__team--win' : undefined}>
            {match.awayTeamName}
          </span>
        </div>
        <span className="match-card__toggle">
          {expanded ? 'Hide box score' : 'Box score'}
          {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </span>
      </button>

      {expanded ? (
        <div className="match-card__box">
          <table className="table">
            <thead>
              <tr>
                <th></th>
                {match.periodScores.map((p) => (
                  <th key={p.period} className="ta-center">
                    {p.period <= 4 ? `Q${p.period}` : `OT${p.period - 4}`}
                  </th>
                ))}
                <th className="ta-center">Final</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{match.homeTeamName}</td>
                {match.periodScores.map((p) => (
                  <td key={p.period} className="ta-center">
                    {p.home}
                  </td>
                ))}
                <td className="ta-center fw-strong">{match.homeScore}</td>
              </tr>
              <tr>
                <td>{match.awayTeamName}</td>
                {match.periodScores.map((p) => (
                  <td key={p.period} className="ta-center">
                    {p.away}
                  </td>
                ))}
                <td className="ta-center fw-strong">{match.awayScore}</td>
              </tr>
            </tbody>
          </table>

          <div className="row match-card__summary">
            <span className="muted">
              Fouls: <strong>{match.homeFouls}</strong> – <strong>{match.awayFouls}</strong>
            </span>
            <span className="muted">
              Timeouts used: <strong>{match.homeTimeoutsUsed}</strong> –{' '}
              <strong>{match.awayTimeoutsUsed}</strong>
            </span>
            <span className="muted">
              Duration: <strong>{formatDuration(match.durationMs)}</strong>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
