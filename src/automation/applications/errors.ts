export class ApplicationNotFoundError extends Error {
  readonly code = "APPLICATION_NOT_FOUND" as const;
  readonly query: string;

  constructor(query: string) {
    super(`Application "${query}" was not found.`);
    this.name = "ApplicationNotFoundError";
    this.query = query;
  }
}

export class AmbiguousApplicationError extends Error {
  readonly code = "AMBIGUOUS_APPLICATION" as const;
  readonly query: string;
  readonly candidates: string[];

  constructor(query: string, candidates: string[]) {
    const listed = candidates.join(", ");
    super(
      `NEEDS_USER_INPUT: Multiple applications match "${query}": ${listed}. Which one should I open?`,
    );
    this.name = "AmbiguousApplicationError";
    this.query = query;
    this.candidates = candidates;
  }
}

export class SensitiveApplicationError extends Error {
  readonly code = "SENSITIVE_APPLICATION" as const;
  readonly query: string;
  readonly requiresConfirmation = true;

  constructor(query: string, message?: string) {
    super(
      message ??
        `Opening "${query}" is blocked — sensitive system/admin applications require explicit user confirmation`,
    );
    this.name = "SensitiveApplicationError";
    this.query = query;
  }
}

export class UnsafeApplicationQueryError extends Error {
  readonly code = "UNSAFE_APPLICATION_QUERY" as const;

  constructor(query: string) {
    super(`Invalid application name: "${query}"`);
    this.name = "UnsafeApplicationQueryError";
  }
}
