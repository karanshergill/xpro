import { useEffect, useState, type ComponentType } from "react";
import { maximumPictureBytes } from "@xpro/accounts";
import type { Profile, ProfileFailure, ProfilePage } from "../../apps/hub/src/features/profile/profile";

// Only mounted client state is stale. Authentication, reads and writes use the real Hub.
export function ProfilePolicyHarness({ loadProfile, screen: Screen, pending: Pending, error: ErrorScreen }: {
  loadProfile(options: { signal: AbortSignal }): Promise<ProfilePage>;
  screen: ComponentType<{ initial: Profile }>; pending: ComponentType; error: ComponentType<{ failure?: ProfileFailure }>;
}): React.JSX.Element {
  const [page, setPage] = useState<ProfilePage>();
  useEffect(() => {
    const controller = new AbortController();
    void loadProfile({ signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setPage(value); })
      .catch(() => { if (!controller.signal.aborted) setPage({ status: "error", error: { code: "core_unexpected_error" } }); });
    return () => controller.abort();
  }, [loadProfile]);
  if (!page) return <Pending />;
  if (page.status === "error") return <ErrorScreen failure={page.error} />;
  return <Screen initial={{ ...page.profile, picturePolicy: { canUpload: true, maximumBytes: maximumPictureBytes } }} />;
}
