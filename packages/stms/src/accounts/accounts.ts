export type AccountStatus = "stms_active" | "stms_suspended";
export type AccountHolder = { loginId: string; name: string; username: string | null; email: string };
export type AccountSummary = {
  accountId: string; name: string | null; holder: AccountHolder; status: AccountStatus;
  revision: number; createdAt: string;
};
export type AccountPage = { accounts: AccountSummary[]; nextOffset: number | null };
export type AccountDetails = AccountSummary & {
  updatedAt: string; workspace: { workspaceId: string; name: string } | null;
};
