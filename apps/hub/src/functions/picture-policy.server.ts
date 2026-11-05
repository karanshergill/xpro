import { parse } from "valibot";
import { pausedPicturePolicy, picturePolicySchema, type PicturePolicy } from "@xpro/accounts";
import { reportUnexpectedError, type RequestContext } from "@xpro/core/server";

export async function readPicturePolicy(services: {
  flags?: Pick<Flagship, "getObjectValue">; loginId: string; context: RequestContext;
}): Promise<PicturePolicy> {
  if (!services.flags) return pausedPicturePolicy;
  try {
    const value = await services.flags.getObjectValue("accounts_picture_policy", pausedPicturePolicy, { targetingKey: services.loginId });
    return parse(picturePolicySchema, value);
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_picture_policy" });
    return pausedPicturePolicy;
  }
}
