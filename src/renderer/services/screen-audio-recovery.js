/**
 * @typedef {{action: 'none'} | {action: 'recover' | 'cooldown' | 'limit', reason: string}} RecoveryDecision
 */

/**
 * Creates the policy that decides when the screen share audio capture is
 * rebuilt. An ended track recovers at once; a PipeWire graph problem only
 * when two checks in a row report it, so streams that are still being
 * linked do not trigger a restart.
 * @param {{cooldownMs: number, maxRecoveries: number}} options - Minimum time between recoveries and the most recoveries per share.
 * @returns {{decide: (check: {trackEnded: boolean, problems: string[], now: number}) => RecoveryDecision}}
 */
export function createRecoveryPolicy({ cooldownMs, maxRecoveries }) {
  let previousProblems = new Set();
  let lastRecoveryAt = -Infinity;
  let recoveries = 0;

  /**
   * @param {{trackEnded: boolean, problems: string[], now: number}} check - State seen by the latest health check.
   * @returns {RecoveryDecision}
   */
  function decide({ trackEnded, problems, now }) {
    const persistent = problems.find((problem) => previousProblems.has(problem));
    previousProblems = new Set(problems);
    const reason = trackEnded ? 'track-ended' : persistent;
    if (!reason) {
      return { action: 'none' };
    }
    if (recoveries >= maxRecoveries) {
      return { action: 'limit', reason };
    }
    if (now - lastRecoveryAt < cooldownMs) {
      return { action: 'cooldown', reason };
    }
    recoveries += 1;
    lastRecoveryAt = now;
    previousProblems = new Set();
    return { action: 'recover', reason };
  }

  return { decide };
}
