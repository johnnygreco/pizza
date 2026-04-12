import type { SettingsManager } from "@mariozechner/pi-coding-agent";

export type Diagnostic = {
  type: "info" | "warning" | "error";
  message: string;
};

export function collectSettingsDiagnostics(
  settingsManager: SettingsManager,
  context: string,
): Diagnostic[] {
  return settingsManager.drainErrors().map(({ scope, error }) => ({
    type: "warning",
    message: `(${context}, ${scope} settings) ${error.message}`,
  }));
}

const DIAGNOSTIC_PREFIX: Record<Diagnostic["type"], string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export function reportDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    process.stderr.write(`${DIAGNOSTIC_PREFIX[diagnostic.type]}: ${diagnostic.message}\n`);
  }
}

export function hasErrorDiagnostics(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.type === "error");
}
