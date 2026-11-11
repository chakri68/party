export type DeployStep = { cmd: string; args: string[]; env?: Record<string, string> } | { rm: string };
export function deploySteps(dryRun: boolean): DeployStep[];
