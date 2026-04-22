/**
 * get_system_info tool implementation.
 *
 * Returns read-only metadata about the host operating system and Node.js
 * runtime. No parameters required; all data is sourced from Node's built-in
 * `os` module and `process` global. Process control operations are explicitly
 * out of scope.
 *
 * Action class: system.read
 */

import { hostname, platform, arch, totalmem, freemem, uptime, release } from 'node:os';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for the get_system_info tool. No inputs required. */
export type GetSystemInfoParams = Record<string, never>;

/** Successful result from the get_system_info tool. */
export interface GetSystemInfoResult {
  /** Operating system platform identifier (e.g. 'linux', 'darwin', 'win32'). */
  platform: string;
  /** CPU architecture (e.g. 'x64', 'arm64'). */
  arch: string;
  /** OS release/kernel version string. */
  os_release: string;
  /** Machine hostname. */
  hostname: string;
  /** Node.js runtime version string (e.g. 'v20.11.0'). */
  node_version: string;
  /** Total system memory in bytes. */
  total_memory: number;
  /** Free system memory in bytes. */
  free_memory: number;
  /** System uptime in seconds. */
  uptime: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns read-only metadata about the host system and Node.js runtime.
 *
 * Explicitly excludes process control — this tool cannot start, stop, signal,
 * or modify any process. It is a pure read of static/current OS state.
 *
 * @returns System information snapshot.
 */
export function getSystemInfo(_params: GetSystemInfoParams = {}): GetSystemInfoResult {
  return {
    platform: platform(),
    arch: arch(),
    os_release: release(),
    hostname: hostname(),
    node_version: process.version,
    total_memory: totalmem(),
    free_memory: freemem(),
    uptime: uptime(),
  };
}
