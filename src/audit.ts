import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ExecutionEvent } from "./types.js";

/** Appends ExecutionEvents as newline-delimited JSON to a configurable log file. */
export class JsonlAuditLogger {
  private readonly filePath: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  log(event: ExecutionEvent): void {
    const line = JSON.stringify(event) + "\n";
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, line, { encoding: "utf-8" });
  }

  flush(): Promise<void> {
    return this.pending;
  }
}
