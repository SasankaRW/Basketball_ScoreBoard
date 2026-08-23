/**
 * Match history — completed games, most recent first.
 *
 * Each card answers the two questions anyone opens this page with, in that
 * order: *what was the result*, then *how did it get there*. The collapsed card
 * is the result and nothing else; expanding it reveals the box score, the
 * headline stats, and the play-by-play captured while the game was live
 * (src/core/timeline.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { formatGameClock } from '../../core/clock.js';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import { subscribeMatches, type MatchRecordDoc } from '../../core/matches.js';
import type { Side } from '../../core/schema.js';
import { subscribeTenant, type Tenant } from '../../core/tenant.js';
import type { TimelineEvent } from '../../core/timeline.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import {
  IconBall,
  IconChevronDown,
  IconChevronUp,
  IconFlag,
  IconTimeout,
  IconWhistle,
} from '../components/icons.js';
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

/** Q1–Q4 then OT1, OT2… — the same labelling the box score header uses. */
function periodLabel(period: number): string {
  return period <= 4 ? `Q${period}` : `OT${period - 4}`;
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
          <p>Every finished game, with its box score and play-by-play.</p>
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

  const teamClass = (won: boolean, lost: boolean) =>
    ['match-card__team', won ? 'match-card__team--win' : lost ? 'match-card__team--loss' : '']
      .filter(Boolean)
      .join(' ');

  return (
    <div className="card match-card">
      <button
        type="button"
        className="match-card__header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="match-card__meta">
          <span>{formatDate(match.endedAt)}</span>
          <span className="match-card__dot" aria-hidden="true" />
          <span>{match.boardName}</span>
          <span className="match-card__dot" aria-hidden="true" />
          <span>{formatDuration(match.durationMs)}</span>
        </div>

        <div className="match-card__matchup">
          <span className={teamClass(homeWon, awayWon)}>{match.homeTeamName}</span>
          {/*
            One element, text exactly "3–1": tests/e2e/matches.spec.ts asserts
            `getByText('3–1')`, and more importantly a score split across
            elements is a score that can be laid out into nonsense. The flanking
            team names sit outside it by design.
          */}
          <span className="match-card__score">
            {match.homeScore}–{match.awayScore}
          </span>
          <span className={teamClass(awayWon, homeWon)}>{match.awayTeamName}</span>
        </div>

        <span className="match-card__toggle">
          {expanded ? 'Hide box score' : 'Box score'}
          {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </span>
      </button>

      {expanded ? (
        <div className="match-card__detail">
          <BoxScore match={match} />

          <div className="match-card__stats">
            <Stat label="Team fouls" home={match.homeFouls} away={match.awayFouls} />
            <Stat
              label="Timeouts used"
              home={match.homeTimeoutsUsed}
              away={match.awayTimeoutsUsed}
            />
            <Stat label="Periods" home={match.periodsPlayed} />
          </div>

          <Timeline match={match} />
        </div>
      ) : null}
    </div>
  );
}

function BoxScore({ match }: { match: MatchRecordDoc }) {
  return (
    <div className="match-card__scroller">
      <table className="table table--box">
        <thead>
          <tr>
            <th>Team</th>
            {match.periodScores.map((p) => (
              <th key={p.period} className="ta-center">
                {periodLabel(p.period)}
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
            <td className="ta-center match-card__final">{match.homeScore}</td>
          </tr>
          <tr>
            <td>{match.awayTeamName}</td>
            {match.periodScores.map((p) => (
              <td key={p.period} className="ta-center">
                {p.away}
              </td>
            ))}
            <td className="ta-center match-card__final">{match.awayScore}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** A labelled home–away pair, or a single figure when `away` is omitted. */
function Stat({ label, home, away }: { label: string; home: number; away?: number }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">
        {home}
        {away === undefined ? null : <span className="stat__sep">–</span>}
        {away === undefined ? null : away}
      </div>
    </div>
  );
}

const TIMELINE_ICONS = {
  score: IconBall,
  foul: IconWhistle,
  timeout: IconTimeout,
  period: IconFlag,
} as const;

/**
 * Says what happened, without naming the team.
 *
 * The team is carried by the *column* the row lands in, so repeating it in the
 * text would be the third time the same fact is stated in one row. What is left
 * is the part that differs line to line, which is what makes a column scannable.
 *
 * The sign of `delta` carries meaning that must not be normalised away: a
 * negative score delta is an operator correcting a miscount, and a *positive*
 * timeout delta is one being handed back. Saying "Timeout" for both would
 * describe the opposite of what happened half the time.
 */
function describe(event: TimelineEvent): string {
  switch (event.type) {
    case 'score':
      return event.delta >= 0 ? `+${event.delta}` : `−${Math.abs(event.delta)} (correction)`;
    case 'foul':
      return event.delta >= 0 ? 'Foul' : 'Foul removed';
    case 'timeout':
      return event.delta <= 0 ? 'Timeout' : 'Timeout returned';
    case 'period':
      return `Start of ${periodLabel(event.period)}`;
  }
}

/** The icon, team name and description that fill one side of a row. */
function Entry({ event, teamName }: { event: TimelineEvent; teamName: string }) {
  const Icon = TIMELINE_ICONS[event.type];
  return (
    <>
      <span className="timeline__icon">
        <Icon size={14} />
      </span>
      <span className="timeline__team">{teamName}</span>
      <span className="timeline__what">{describe(event)}</span>
    </>
  );
}

/**
 * The play-by-play, laid out head-to-head.
 *
 * Home events sit left of the running score and away events right of it, the
 * way a printed box score reads, so *who* is answered by position before a word
 * is read — the team name and colour then confirm it rather than carrying it
 * alone. A single flat list, which is what this was, forces every line to be
 * read in full to work out which team it belongs to.
 *
 * Period changes break the pattern deliberately: they belong to the game rather
 * than to either team, so they span the row as a divider and mark the score
 * each period ended on.
 */
function Timeline({ match }: { match: MatchRecordDoc }) {
  // Grouped in one pass rather than filtered once per period, and memoised
  // because a long game is a few hundred events and this reruns on every
  // parent render.
  const periods = useMemo(() => {
    const groups: { period: number; events: TimelineEvent[] }[] = [];
    for (const event of match.events) {
      const last = groups[groups.length - 1];
      if (last && last.period === event.period) last.events.push(event);
      else groups.push({ period: event.period, events: [event] });
    }
    return groups;
  }, [match.events]);

  return (
    <section className="timeline">
      <div className="timeline__head">
        <h4 className="timeline__title">Play-by-play</h4>
        {match.events.length > 0 ? (
          <div className="timeline__legend">
            <span className="timeline__legend-team timeline__legend-team--home">
              {match.homeTeamName}
            </span>
            <span className="timeline__legend-team timeline__legend-team--away">
              {match.awayTeamName}
            </span>
          </div>
        ) : null}
      </div>

      {match.events.length === 0 ? (
        <p className="timeline__empty">
          No timeline recorded for this match — play-by-play capture was added after it finished.
        </p>
      ) : (
        <>
          {periods.map((group, index) => (
            <div className="timeline__period" key={`${group.period}-${index}`}>
              <div className="timeline__period-label">{periodLabel(group.period)}</div>
              <ol className="timeline__list">
                {group.events.map((event, i) => (
                  <li
                    className={`timeline__row timeline__row--${event.type} timeline__row--${event.side ?? 'game'}`}
                    key={i}
                  >
                    <span className="timeline__clock">{formatGameClock(event.clockMs)}</span>

                    {/*
                      Source order *is* column order — the grid places these by
                      position, so home / score / away has to be written the way
                      it is read. Emitting the two team cells together and the
                      score after them, as this once did, put the away cell in
                      the score's column and the score in the away column, which
                      is what made every row line up differently.

                      The score stays on one line: `tests/e2e/matches.spec.ts`
                      asserts its text is exactly "2–0", and JSX joins elements
                      split across lines with a space.
                    */}
                    {event.side === null ? (
                      <span className="timeline__cell timeline__cell--full">
                        <Entry event={event} teamName="" />
                      </span>
                    ) : (
                      <>
                        <span className="timeline__cell timeline__cell--home">
                          {event.side === 'home' ? (
                            <Entry event={event} teamName={match.homeTeamName} />
                          ) : null}
                        </span>

                        <span className="timeline__score">
                          <span className={scoreHalfClass(event, 'home')}>{event.home}</span>–
                          <span className={scoreHalfClass(event, 'away')}>{event.away}</span>
                        </span>

                        <span className="timeline__cell timeline__cell--away">
                          {event.side === 'away' ? (
                            <Entry event={event} teamName={match.awayTeamName} />
                          ) : null}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {match.eventsTruncated ? (
            <p className="timeline__empty">
              This game produced more events than a single record can hold — only the first 500 are
              shown.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Highlights the half of the running score that this event actually moved. */
function scoreHalfClass(event: TimelineEvent, side: Side): string {
  const moved = event.type === 'score' && event.side === side;
  return `timeline__score-half${moved ? ` timeline__score-half--moved timeline__score-half--${side}` : ''}`;
}
