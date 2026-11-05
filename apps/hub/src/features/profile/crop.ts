import { maximumPictureSide } from "@xpro/accounts";
import type { PercentCrop } from "react-image-crop";

export async function cropPicture(image: HTMLImageElement, crop: PercentCrop): Promise<File> {
  const percent = 100, x = image.naturalWidth * crop.x / percent, y = image.naturalHeight * crop.y / percent;
  const width = image.naturalWidth * crop.width / percent, height = image.naturalHeight * crop.height / percent;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > image.naturalWidth + 1 || y + height > image.naturalHeight + 1) throw new Error("Invalid crop geometry.");
  const side = Math.max(1, Math.min(maximumPictureSide, Math.floor(Math.min(width, height))));
  const canvas = document.createElement("canvas"); canvas.width = side; canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A picture canvas is unavailable.");
  context.drawImage(image, x, y, width, height, 0, 0, side, side);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Picture encoding failed.")), "image/png"));
  return new File([blob], "profile.png", { type: "image/png" });
}
