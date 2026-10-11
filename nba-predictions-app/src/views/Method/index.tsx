import { ViewHeader } from '../../components/ui';
import { BacktestPart } from './Backtest';
import { FrozenPart, GradingPart, LimitsPart } from './Grading';
import { EloPart, PointsRestPart } from './Models';
import OnThisPage from './OnThisPage';
import { IntroPart, ReadMorePart, SourcesPart } from './Sources';

/**
 * What the two models are, in plain words and with their formulas, how a
 * forecast is frozen and graded, and what has and has not been shown of the
 * models. Nothing here is read from the published files: the view says what
 * pipeline/model/README.md and pipeline/README.md say.
 */
export default function Method() {
  return (
    <>
      <ViewHeader title="How it works">
        The forecasts on this page come from two small statistical models of its own. Here is what they do, with the numbers to check them
        by hand.
      </ViewHeader>
      <OnThisPage />
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <IntroPart className="lg:col-span-2" />
        <EloPart />
        <PointsRestPart />
        <FrozenPart />
        <GradingPart />
        <LimitsPart className="lg:col-span-2" />
        <BacktestPart className="lg:col-span-2" />
        <SourcesPart />
        <ReadMorePart />
      </div>
    </>
  );
}
