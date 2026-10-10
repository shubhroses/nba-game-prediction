import { outlookLabel, sportsbooksNote, type CardTeam, type GameCardView, type Outlook } from '../../display/gameCard';
import { formatDate } from '../../utils/formatters';
import TeamLogo from '../TeamLogo';

const NEUTRAL_LABEL = 'bg-gray-100 text-gray-600';

function labelColors(outlook: Outlook): string {
  if (outlook.kind !== 'favorite') return NEUTRAL_LABEL;
  if (outlook.chance >= 70) return 'bg-green-100 text-green-800';
  if (outlook.chance >= 55) return 'bg-yellow-100 text-yellow-800';
  return NEUTRAL_LABEL;
}

function footerColors(outlook: Outlook): string {
  if (outlook.kind !== 'favorite') return 'bg-gray-100 text-gray-700';
  return outlook.side === 'home'
    ? 'bg-blue-50 text-blue-800 border-t border-blue-100'
    : 'bg-purple-50 text-purple-800 border-t border-purple-100';
}

function Team({ team }: { team: CardTeam }) {
  return (
    <div className="flex flex-col items-center w-2/5">
      <div className="mb-3">
        <TeamLogo teamName={team.name} size="lg" />
      </div>
      <div className="text-center">
        <div className="font-semibold text-sm sm:text-base">{team.name}</div>
        {team.chance !== null && (
          <div className="text-gray-600 text-xs sm:text-sm font-mono mt-1">{team.chance}%</div>
        )}
        {team.range && (
          <div className="text-gray-500 text-xs mt-1">
            {team.range.low}% to {team.range.high}%
          </div>
        )}
      </div>
    </div>
  );
}

function CardFooter({ outlook }: { outlook: Outlook }) {
  switch (outlook.kind) {
    case 'favorite':
      return (
        <>
          Favored: <strong>{outlook.team}</strong>, {outlook.chance}% implied
        </>
      );
    case 'toss-up':
      return <>Toss-up: within 2 points of even</>;
    case 'no-line':
      return <>No sportsbook has posted odds on this game yet</>;
  }
}

export default function GameCard({ card }: { card: GameCardView }) {
  const note = sportsbooksNote(card);

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden flex flex-col">
      <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
        <span className="text-gray-600 text-sm font-medium">{formatDate(card.startsAt)}</span>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${labelColors(card.outlook)}`}>
          {outlookLabel(card.outlook)}
        </span>
      </div>

      <div className="p-5 flex-1">
        <div className="flex justify-between items-center mb-4">
          <Team team={card.home} />
          <div className="text-gray-400 font-bold text-lg">VS</div>
          <Team team={card.away} />
        </div>
        {note && <p className="text-center text-gray-500 text-xs">{note}</p>}
      </div>

      <div className={`p-3 text-center ${footerColors(card.outlook)}`}>
        <CardFooter outlook={card.outlook} />
      </div>
    </div>
  );
}
