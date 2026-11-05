import { file } from "valibot";

export const maximumPictureBytes = 2 * 1024 * 1024;
export const maximumPictureSide = 512;
export const uploadPictureEntries = { file: file() };
export const removePictureEntries = {};

export function hasSupportedPictureContent(bytes: Uint8Array): boolean {
  const startsWith = (value: Uint8Array, signature: number[]): boolean => signature.every((byte, index) => value[index] === byte);
  return startsWith(bytes, [0xff, 0xd8, 0xff]) || startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    || (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]));
}
