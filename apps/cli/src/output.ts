export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CliOutput {
  private readonly stdoutChunks: string[] = [];
  private readonly stderrChunks: string[] = [];

  public stdout(value: string): void {
    this.stdoutChunks.push(value.endsWith("\n") ? value : `${value}\n`);
  }

  public stderr(value: string): void {
    this.stderrChunks.push(value.endsWith("\n") ? value : `${value}\n`);
  }

  public json(value: unknown): void {
    this.stdoutChunks.push(`${JSON.stringify(value)}\n`);
  }

  public result(exitCode: number): CliRunResult {
    return {
      exitCode,
      stdout: this.stdoutChunks.join(""),
      stderr: this.stderrChunks.join(""),
    };
  }
}
