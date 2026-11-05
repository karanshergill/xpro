import { boolean, integer, maxValue, minValue, number, object, pipe, type InferOutput } from "valibot";
import { maximumPictureBytes } from "./input";

export const picturePolicySchema = object({
  canUpload: boolean(),
  maximumBytes: pipe(number(), integer(), minValue(1), maxValue(maximumPictureBytes)),
});

export type PicturePolicy = Readonly<InferOutput<typeof picturePolicySchema>>;
export const pausedPicturePolicy: PicturePolicy = Object.freeze({ canUpload: false, maximumBytes: maximumPictureBytes });
