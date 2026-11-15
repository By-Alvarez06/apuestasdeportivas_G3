import type { MatchSummary } from '@apuestas/shared';
import styles from '@/app/matches.module.css';

interface MatchTeamsProps {
  homeTeam: Pick<MatchSummary['homeTeam'], 'name' | 'logoUrl'>;
  awayTeam: Pick<MatchSummary['awayTeam'], 'name' | 'logoUrl'>;
  homeScore?: number | null;
  awayScore?: number | null;
}

export function MatchTeams({
  homeTeam,
  awayTeam,
  homeScore = null,
  awayScore = null,
}: MatchTeamsProps) {
  const hasScore = homeScore !== null && awayScore !== null;

  return (
    <div className={styles.fixtureTeams} aria-label={`${homeTeam.name} contra ${awayTeam.name}`}>
      {[
        { team: homeTeam, score: homeScore },
        { team: awayTeam, score: awayScore },
      ].map(({ team, score }) => (
        <div className={styles.fixtureTeam} key={team.name}>
          {team.logoUrl ? (
            <img className={styles.crest} src={team.logoUrl} alt="" />
          ) : (
            <span className={styles.crestFallback} aria-hidden="true">
              {team.name.charAt(0)}
            </span>
          )}
          <span className={styles.teamName}>{team.name}</span>
          {hasScore && <strong className={styles.teamScore}>{score}</strong>}
        </div>
      ))}
    </div>
  );
}
