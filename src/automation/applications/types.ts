export type ApplicationInfo = {
  name: string;
  path: string;
  bundleId?: string;
};

export type ApplicationResolveStatus =
  | "found"
  | "not_found"
  | "ambiguous"
  | "blocked";

export type ApplicationResolveResult =
  | { status: "found"; app: ApplicationInfo }
  | { status: "not_found"; query: string }
  | { status: "ambiguous"; query: string; candidates: ApplicationInfo[] }
  | {
      status: "blocked";
      query: string;
      app: ApplicationInfo;
      reason: string;
    };

export interface ApplicationDiscovery {
  discoverApplications(): Promise<ApplicationInfo[]>;
  /** Targeted lookup when the cached inventory misses a name. */
  lookupByName?(name: string): Promise<ApplicationInfo[]>;
}

export interface ApplicationOpener {
  open(app: ApplicationInfo): Promise<void>;
  closeByName(name: string): Promise<void>;
}
