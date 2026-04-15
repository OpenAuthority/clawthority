import { execSync } from 'node:child_process';

export interface CommandResult {
  success: boolean;
  output: string;
  exitCode: number;
}

function run(command: string, cwd: string): CommandResult {
  try {
    const output = execSync(command, { stdio: 'pipe', cwd }).toString();
    return { success: true, output, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string; status?: number };
    const out = [e.stdout?.toString(), e.stderr?.toString()].filter(Boolean).join('\n');
    return { success: false, output: out || (e.message ?? ''), exitCode: e.status ?? 1 };
  }
}

export const runNpmTest = (cwd: string): CommandResult => run('npm test', cwd);
export const runNpmTestE2e = (cwd: string): CommandResult => run('npm run test:e2e', cwd);
