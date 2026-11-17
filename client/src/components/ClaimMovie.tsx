import { useEffect, useRef, useState } from 'react';
import {
  CONTEST_PENALTY,
  CONTEST_TIME_MS,
  NAME_TIME_MS,
  THUMBS_UP_TO_WIN,
  type Card,
  type GameMode,
  type PendingDeclaration,
  type PlayerState,
} from '@movie-game/shared';
import { CardChip } from './CardChip';

interface ClaimMovieProps {
  /** `naming` = the declarer is typing the title; `contest` = verify a real film;
   *  `vote` = the table thumbs a Create-a-Movie pitch up or down. */
  stage: 'naming' | 'contest' | 'vote';
  /** The active game mode (drives naming/voting behaviour). Defaults off the pending. */
  mode?: GameMode;
  /** Total points at stake before any cast penalty (base + bonus) shown while held. */
  pointsAtStake: number;
  /** Points docked because the combo has no Actor or Actress card. */
  castPenalty?: number;
  /** The pending declaration to verify (contest / vote stages only). */
  pending?: PendingDeclaration;
  players: PlayerState[];
  viewerId: string;
  /** The combo cards being named/voted on (shown for context). */
  cards?: Card[];
  /** Hotseat mode: the acting seat can be switched so another human verifies/votes. */
  hotseat?: boolean;
  /** Hotseat: switch the seat that is currently acting inside the overlay. */
  onActingAsChange?: (playerId: string) => void;
  /** Submitted in the naming stage (title + synopsis). */
  onName?: (title: string, synopsis: string) => void;
  /** Cancels the naming stage with no penalty. */
  onCancelName?: () => void;
  /** A non-declarer raises a contest with an optional proof (Find mode). */
  onContest?: (proof: string) => void;
  /** Any non-declarer resolves the claim (Find mode). */
  onResolve?: (outcome: 'real' | 'fake') => void;
  /** A non-declarer casts a thumbs verdict on a Create-a-Movie pitch. */
  onVote?: (vote: 'up' | 'down') => void;
}

const formatTime = (ms: number): string => `${Math.ceil(ms / 1000)}s`;

/**
 * Real-movie verification (Find) without a quiz: the declarer names a film, then
 * the table gets a short window to contest it. Create-a-Movie replaces that with
 * a freeform Title + Synopsis pitch and, for 4–6 players, a thumbs up/down vote.
 */
export function ClaimMovie({
  stage,
  mode,
  pointsAtStake,
  castPenalty = 0,
  pending,
  players,
  viewerId,
  cards,
  hotseat,
  onActingAsChange,
  onName,
  onCancelName,
  onContest,
  onResolve,
  onVote,
}: ClaimMovieProps) {
  const isCreate = (mode ?? pending?.mode) === 'create';
  // The points actually awarded for a real film, after the no-cast penalty.
  const netAtStake = Math.max(0, pointsAtStake - castPenalty);
  const [timeLeft, setTimeLeft] = useState(stage === 'naming' && !isCreate ? NAME_TIME_MS : CONTEST_TIME_MS);
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [proofDraft, setProofDraft] = useState('');
  const [contesting, setContesting] = useState(false);
  const [showResolution, setShowResolution] = useState(false);
  const finished = useRef(false);
  // Always-current snapshot of the pending declaration (see contest branch).
  const pendingRef = useRef<PendingDeclaration | undefined>(undefined);

  // In vs-AI there is no peer to challenge a human's claim (the AI never
  // contests), so the declarer verifies their own claim on their honor.
  const honorCheck =
    !hotseat &&
    stage === 'contest' &&
    !!pending &&
    pending.playerId === viewerId &&
    pending.contests.length === 0;

  // Reset local state whenever a new declaration enters the stage.
  useEffect(() => {
    setTimeLeft(stage === 'naming' && !isCreate ? NAME_TIME_MS : CONTEST_TIME_MS);
    setTitle('');
    setSynopsis('');
    setProofDraft('');
    setContesting(false);
    setShowResolution(false);
    finished.current = false;
  }, [stage, pending?.id, isCreate]);

  const finish = (): void => {
    if (finished.current) return;
    finished.current = true;
    // Create-a-Movie naming is untimed; never auto-cancel it.
    if (stage === 'naming') {
      if (!isCreate) onCancelName?.();
      return;
    }
    const current = pendingRef.current;
    // A solo (vs-AI) claim is resolved by the declarer, never by a timer.
    if (
      !hotseat &&
      stage === 'contest' &&
      current?.playerId === viewerId &&
      (current?.contests.length ?? 0) === 0
    ) {
      return;
    }
    if (!current) return;
    if (current.contests.length === 0) {
      onResolve?.('real'); // uncontested → award
    } else {
      setShowResolution(true); // contested → let the table rule
    }
  };

  // Countdown for the Find-mode naming + contest stages only.
  useEffect(() => {
    if (isCreate && stage === 'naming') return undefined;
    if (showResolution || honorCheck) return undefined;
    const id = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 100) {
          window.clearInterval(id);
          finish();
          return 0;
        }
        return previous - 100;
      });
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolution, pending?.id, stage, honorCheck, isCreate]);

  if (stage === 'naming') {
    const total = NAME_TIME_MS;
    const showTimer = !isCreate;
    return (
      <div className="trivia-overlay">
        <div className="trivia-card">
          <header className="trivia-card__header">
            <div>
              {isCreate ? (
                <>
                  <h2>Pitch your movie</h2>
                  <p className="muted">
                    Weave these cards into an original film. Give it a title and a short synopsis —
                    there&rsquo;s no timer.
                  </p>
                </>
              ) : (
                <>
                  <h2>Name the movie</h2>
                  <p className="muted">
                    You&rsquo;re claiming a real film worth <strong>{netAtStake}</strong> points
                    {castPenalty > 0 && (
                      <>
                        {' '}
                        (includes a &minus;{castPenalty} no-cast penalty: no Actor or Actress card)
                      </>
                    )}
                    . Type its title &mdash; you have {Math.ceil(NAME_TIME_MS / 1000)}s.
                  </p>
                </>
              )}
            </div>
            {showTimer && <span className="trivia-timer">{formatTime(timeLeft)}</span>}
          </header>

          {showTimer && (
            <div className="trivia-bar">
              <div
                className="trivia-bar__fill"
                style={{ width: `${(timeLeft / total) * 100}%` }}
              />
            </div>
          )}

          {cards && cards.length > 0 && (
            <div className="claim-cards">
              <span className="muted">Your ingredients</span>
              <div className="chip-row chip-row--wrap">
                {cards.map((card) => (
                  <CardChip key={card.id} card={card} />
                ))}
              </div>
            </div>
          )}

          <input
            className="claim-input"
            type="text"
            autoFocus
            placeholder="Title — e.g. The Last Lighthouse"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim()) onName?.(title.trim(), synopsis.trim());
            }}
          />

          {isCreate && (
            <textarea
              className="claim-input claim-textarea"
              rows={3}
              placeholder="Short synopsis — one or two sentences (optional)"
              value={synopsis}
              onChange={(event) => setSynopsis(event.target.value)}
            />
          )}

          <div className="trivia-actions">
            <button type="button" className="btn btn--ghost" onClick={() => onCancelName?.()}>
              Cancel (no penalty)
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!title.trim()}
              onClick={() => onName?.(title.trim(), synopsis.trim())}
            >
              {isCreate ? 'Pitch it' : 'Submit claim'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Create-a-Movie voting stage ---
  if (stage === 'vote') {
    if (!pending) return null;
    // Keep the latest pending available to the (closured) timer, if any.
    pendingRef.current = pending;

    const declarer = players.find((player) => player.id === pending.playerId);
    const isDeclarer = pending.playerId === viewerId;
    const viewer = players.find((player) => player.id === viewerId);
    const votes = pending.votes ?? {};
    const ups = Object.values(votes).filter((value) => value === 'up').length;
    const downs = Object.values(votes).filter((value) => value === 'down').length;
    const myVote = votes[viewerId];
    const remaining = Math.max(0, THUMBS_UP_TO_WIN - ups);

    return (
      <div className="trivia-overlay">
        <div className="trivia-card">
          <header className="trivia-card__header">
            <div>
              <h2>Vote on the pitch</h2>
              <p className="muted">
                Pitched by <strong>{declarer?.name ?? pending.playerId}</strong>. First pitch to{' '}
                <strong>{THUMBS_UP_TO_WIN} 👍</strong> wins. Thumbs-down has no penalty.
              </p>
            </div>
            <span className="trivia-timer trivia-timer--votes">
              👍 {ups}/{THUMBS_UP_TO_WIN}
            </span>
          </header>

          {hotseat && (
            <div className="claim-seats">
              <span className="muted">Acting as:</span>
              {players
                .filter((player) => player.kind === 'human')
                .map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className={`btn btn--small ${player.id === viewerId ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => onActingAsChange?.(player.id)}
                  >
                    {player.name}
                    {player.id === pending.playerId ? ' (pitching)' : ''}
                  </button>
                ))}
            </div>
          )}

          <div className="claim-pitch">
            <h3 className="claim-pitch__title">{pending.claimedTitle || 'Untitled pitch'}</h3>
            {pending.claimedSynopsis && (
              <p className="claim-pitch__synopsis">{pending.claimedSynopsis}</p>
            )}
            <div className="chip-row chip-row--wrap">
              {pending.cards.map((card) => (
                <CardChip key={card.id} card={card} />
              ))}
            </div>
          </div>

          <div className="claim-votes">
            <span className="muted">
              👍 {ups} &middot; 👎 {downs}
              {remaining > 0 && ` · ${remaining} more 👍 to win`}
            </span>

            {isDeclarer ? (
              <p className="claim-vote__waiting">
                This is your pitch — waiting for the table to vote.
              </p>
            ) : myVote ? (
              <p className="claim-vote__waiting">
                You voted {myVote === 'up' ? '👍' : '👎'} — waiting for the others.
              </p>
            ) : (
              <div className="trivia-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => onVote?.('up')}
                >
                  👍 Thumbs up
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => onVote?.('down')}
                >
                  👎 Thumbs down
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!pending) return null;

  // Keep the latest pending available to the (closured) countdown timer.
  pendingRef.current = pending;

  const declarer = players.find((player) => player.id === pending.playerId);
  const isDeclarer = pending.playerId === viewerId;
  const viewer = players.find((player) => player.id === viewerId);
  const contestsLeft = (viewer?.contestsUsed ?? 0) < 3;
  const alreadyContested = pending.contests.some((entry) => entry.playerId === viewerId);
  const resolved = showResolution;

  return (
    <div className="trivia-overlay">
      <div className="trivia-card">
        <header className="trivia-card__header">
          <div>
            <h2>Verify: {pending.claimedTitle || 'Untitled claim'}</h2>
            <p className="muted">
              Claimed by <strong>{declarer?.name ?? pending.playerId}</strong> &middot;{' '}
              <strong>{netAtStake}</strong> points held
              {castPenalty > 0 && (
                <>
                  {' '}
                  (&minus;{castPenalty} no-cast penalty: no Actor or Actress card)
                </>
              )}
              .
            </p>
          </div>
          <span className="trivia-timer">
            {honorCheck ? 'Your call' : ''}
          </span>
        </header>

        {hotseat && (
          <div className="claim-seats">
            <span className="muted">Acting as:</span>
            {players.map((player) => (
              <button
                key={player.id}
                type="button"
                className={`btn btn--small ${player.id === viewerId ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => onActingAsChange?.(player.id)}
              >
                {player.name}
                {player.id === pending.playerId ? ' (declarer)' : ''}
              </button>
            ))}
          </div>
        )}

        {pending.contests.length > 0 && (
          <ul className="claim-contests">
            {pending.contests.map((entry) => {
              const who = players.find((player) => player.id === entry.playerId);
              return (
                <li key={entry.playerId}>
                  <span className="claim-contests__name">{who?.name ?? entry.playerId}</span>{' '}
                  contests: {entry.proof ? `“${entry.proof}”` : 'no proof given'}
                </li>
              );
            })}
          </ul>
        )}

        {!resolved && honorCheck && (
          <div className="claim-honor">
            <p className="claim-honor__prompt">
              No one can challenge this claim in a solo game &mdash; so it&rsquo;s on your honor.
            </p>
            <p className="muted">
              Is <strong>{pending.claimedTitle || 'your claim'}</strong> a real film? Take{' '}
              <strong>{netAtStake}</strong> points only if it is. Faking a title costs{' '}
              <strong>{CONTEST_PENALTY}</strong> points.
            </p>
            <div className="trivia-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onResolve?.('real')}
              >
                Yes, it&rsquo;s real (+{netAtStake})
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => onResolve?.('fake')}
              >
                No, withdraw (&minus;{CONTEST_PENALTY})
              </button>
            </div>
          </div>
        )}

        {!resolved && !honorCheck && (
          <div className="claim-stage">
            {isDeclarer ? (
              <div className="trivia-actions">
                <p className="muted">
                  Waiting for the table to contest your claim&hellip;
                </p>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => onResolve?.('fake')}
                >
                  Withdraw claim (&minus;{CONTEST_PENALTY})
                </button>
              </div>
            ) : alreadyContested ? (
              <p className="muted">You contested this claim. Waiting for a ruling&hellip;</p>
            ) : contestsLeft ? (
              contesting ? (
                <div className="claim-proof">
                  <input
                    className="claim-input"
                    type="text"
                    autoFocus
                    placeholder="Cite the contradiction (optional)"
                    value={proofDraft}
                    onChange={(event) => setProofDraft(event.target.value)}
                  />
                  <div className="trivia-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setContesting(false)}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => {
                        onContest?.(proofDraft.trim());
                        setContesting(false);
                        // A raised contest opens the ruling panel at once instead
                        // of waiting for a countdown to expire.
                        setShowResolution(true);
                      }}
                    >
                      Submit contest
                    </button>
                  </div>
                </div>
              ) : (
                <div className="trivia-actions">
                  <span className="muted">Believe it&rsquo;s fake?</span>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => setContesting(true)}
                  >
                    Contest this claim
                  </button>
                </div>
              )
            ) : (
              <p className="muted">You have no contests left this game.</p>
            )}
          </div>
        )}

        {resolved && (
          <div className="claim-resolution">
            <p className="claim-resolution__prompt">
              A player challenged this claim. Is it a real film?
            </p>
            {isDeclarer ? (
              <p className="muted">Waiting for a ruling&hellip;</p>
            ) : (
              <div className="trivia-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => onResolve?.('real')}
                >
                  Real film (+{netAtStake})
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => onResolve?.('fake')}
                >
                  Fake claim (&minus;{CONTEST_PENALTY} declarer)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
