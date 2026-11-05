import { env } from "cloudflare:workers";
import { err } from "true-myth/result";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pictureFile } from "#test/picture-fixtures";
import { processPicture } from "./picture-processing.server";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Cloudflare picture processing", () => {
  it.each(["jpeg", "png", "webp"] as const)(
    "when a real %s image is processed then the local binding produces a square PNG without camera or location metadata", async (format) => {
      const file = pictureFile(format);
      if (format === "jpeg") expect(new TextDecoder().decode(await file.arrayBuffer())).toContain("private-camera-marker");
      const result = await processPicture(file, env.IMAGES);
      if (result.isErr) throw new Error("A supported real image was refused: " + result.error.code);
      expect(result.value.type).toBe("image/png");
      const bytes = new Uint8Array(await result.value.arrayBuffer());
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect({ width: dimensions.getUint32(16), height: dimensions.getUint32(20) }).toEqual({ width: 2, height: 2 });
      expect(pngChunks(bytes)).not.toEqual(expect.arrayContaining(["eXIf", "tEXt", "iTXt", "zTXt"]));
      expect(new TextDecoder().decode(bytes)).not.toContain("private-camera-marker");
      expect(await env.IMAGES.info(result.value.stream())).toEqual({
        format: "image/png", width: 2, height: 2, fileSize: bytes.byteLength,
      });
    },
  );

  it("when the local decoder rejects corrupt data without a documented error code then the failure stays unexpected", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0])], "pretend.jpg", { type: "image/jpeg" });
    // This SDK's low-fidelity decoder returns an uncoded 500; production mapping uses numeric codes.
    await expect(processPicture(file, env.IMAGES)).rejects.toBeInstanceOf(Error);
  });

  it.each([
    { code: 9412, outcome: "accounts_picture_invalid" },
    { code: 9413, outcome: "accounts_picture_invalid" },
    { code: 9520, outcome: "accounts_picture_type_invalid" },
  ])("when Images reports input code $code then it returns the documented named refusal", async ({ code, outcome }) => {
    const images: Pick<ImagesBinding, "info" | "input"> = {
      async info() { throw Object.assign(new Error("private_decoder_failure"), { code }); },
      input: env.IMAGES.input.bind(env.IMAGES),
    };
    expect((await processPicture(pictureFile("png"), images)).toJSON()).toEqual(err({ code: outcome }).toJSON());
  });

  it("when the processor recognizes SVG then it still refuses the unsupported format", async () => {
    const file = new File(["<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2'/></svg>"], "vector.svg");
    expect((await processPicture(file, env.IMAGES)).toJSON()).toEqual(err({ code: "accounts_picture_type_invalid" }).toJSON());
  });

  it("when the image service reports its quota limit then that unexpected failure propagates to the safe request boundary", async () => {
    const images: Pick<ImagesBinding, "info" | "input"> = {
      async info() { throw Object.assign(new Error("private_image_quota_failure"), { code: 9422 }); },
      input: env.IMAGES.input.bind(env.IMAGES),
    };
    await expect(processPicture(pictureFile("png"), images)).rejects.toMatchObject({ code: 9422 });
  });

  it("when the image service stalls then processing stops waiting after ten seconds", async () => {
    vi.useFakeTimers();
    const images: Pick<ImagesBinding, "info" | "input"> = {
      async info() { return await new Promise<ImageInfoResponse>(() => undefined); },
      input: env.IMAGES.input.bind(env.IMAGES),
    };
    const pending = expect(processPicture(pictureFile("png"), images)).rejects.toThrow("Picture processing timed out.");
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
  });
});

function pngChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset);
    if (offset + length + 12 > bytes.byteLength) throw new Error("The processed PNG contains an incomplete chunk.");
    chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)));
    offset += length + 12;
  }
  expect(offset).toBe(bytes.byteLength);
  expect(chunks).toContain("IEND");
  return chunks;
}
