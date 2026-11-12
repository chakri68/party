export type DeployStep =
  | { cmd: string; args: string[]; env?: Record<string, string> }
  | { rm: string }
  | { say: string }
  | { secrets: string[]; dryRun: boolean }
  | { billing: string[]; dryRun: boolean };
export function deploySteps(dryRun: boolean): DeployStep[];
export const REQUIRED_SECRETS: string[];
export const BILLING_SECRETS: string[];
export function requiredSecrets(wranglerJsoncText: string): string[];
export function missingSecrets(listOutput: string, required: string[]): string[];
export const BILLING_VARS: string[];
export function billingProblems(wranglerJsoncText: string): string[];
