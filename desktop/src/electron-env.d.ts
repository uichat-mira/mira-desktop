declare global {
  interface Window {
    cloudAccount?: {
      status: () => Promise<{
        status: "signed_out" | "signed_in" | "checking" | "authorizing" | "unavailable" | "rejected" | "setup_failed";
        account: { id: string; username: string } | null;
        hostId: string | null;
        scopes: string[];
        expiresAt: string | null;
        permissionsConfigured: boolean;
        localOwnerBound?: boolean;
        canResetCredentials?: boolean;
        message: string;
      }>;
      signIn: (scopes: string[], localAccessToken: string) => Promise<unknown>;
      cancelSignIn: () => Promise<unknown>;
      retryHostSetup: () => Promise<unknown>;
      resetLocalCredentials: () => Promise<unknown>;
      signOut: () => Promise<unknown>;
      subscribe: (listener: (state: Awaited<ReturnType<NonNullable<Window["cloudAccount"]>["status"]>>) => void) => () => void;
    };
    desktopRuntime?: {
      hostKind: "browser" | "electron";
      platform: string;
      isPackaged: boolean;
      backendUrl: string;
    };
    desktopApi?: {
      platform: string;
      isPackaged: boolean;
      backendUrl: string;
    };
    electronAPI?: {
      invoke: (channel: string, data?: unknown) => Promise<unknown>;
    };
  }
}

export {};
