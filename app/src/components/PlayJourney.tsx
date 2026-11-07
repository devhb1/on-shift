import { useSyncExternalStore } from "react";
import { PLAY_STEPS, getPlayLoop, playStage, subscribePlayLoop } from "../lib/playLoop";
import { useSession } from "../lib/session";

export function PlayJourney({ forceStage }: { forceStage?: number }) {
  const { operator } = useSession();
  const loop = useSyncExternalStore(subscribePlayLoop, getPlayLoop, () => undefined);
  const stage = forceStage ?? playStage(Boolean(operator), loop);
  return (
    <ol className="journey" aria-label="Demo path">
      {PLAY_STEPS.map((label, i) => (
        <li key={label} className={i === stage ? "here" : i < stage ? "done" : ""}>
          <span>{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
