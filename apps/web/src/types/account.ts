export type Account = {
  configured: boolean;
  providers: string[];
  user: { id: string; email: string } | null;
  github: { login: string } | null;
  privateEnabled: boolean;
  installUrl: string | null;
};

export type WorkspaceSession = { required: boolean; authenticated: boolean };
