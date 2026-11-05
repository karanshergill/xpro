export type LoginSummary = {
  loginId: string; username: string | null; name: string; email: string;
  phone: string | null; createdAt: string; status: "active" | "suspended" | "archived";
};
export type LoginPage = { logins: LoginSummary[]; nextOffset: number | null };
export type LoginDetails = LoginSummary & { workspace: { workspaceId: string; name: string } | null };
