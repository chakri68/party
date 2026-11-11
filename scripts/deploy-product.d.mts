export type DeployStep = { cmd: string; args: string[]; env?: Record<string, string> } | { rm: string } | { say: string };
export function deploySteps(dryRun: boolean): DeployStep[];
