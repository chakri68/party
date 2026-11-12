export type DeployStep =
  | { cmd: string; args: string[]; env?: Record<string, string> }
  | { rm: string }
  | { say: string }
  | { secrets: string[]; dryRun: boolean };
export function deploySteps(dryRun: boolean): DeployStep[];
export const REQUIRED_SECRETS: string[];
export function missingSecrets(listOutput: string): string[];
