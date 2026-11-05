import { describe, expect, it } from "vitest";
import { err } from "true-myth/result";
import { pictureFile } from "#test/picture-fixtures";
import { readPictureUpload } from "./picture-input.server";

describe("multipart picture input limits", () => {
  it.each([1_048_576, 1_048_577])("when a file contains %s bytes then the reader enforces the current inclusive limit", async (size) => {
    const bytes = new Uint8Array(size); bytes.set(new Uint8Array(await pictureFile("jpeg").arrayBuffer()));
    const form = new FormData(); form.set("file", new File([bytes], "portrait.jpg", { type: "image/jpeg" }));
    const result = await readPictureUpload(new Request("https://hub.example.test/api/v1/profile-pictures", { method: "POST", body: form }), 1_048_576);
    if (size > 1_048_576) {
      expect(result.toJSON()).toEqual(err({ code: "accounts_picture_too_large" }).toJSON());
    } else {
      if (result.isErr) throw new Error("The boundary file must be accepted.");
      expect({ name: result.value.file.name, type: result.value.file.type, size: result.value.file.size })
        .toEqual({ name: "portrait.jpg", type: "image/jpeg", size });
      expect(new Uint8Array(await result.value.file.arrayBuffer())).toEqual(bytes);
    }
  });

  it("when an internal caller supplies an excessive limit then the reader still enforces the absolute file ceiling", async () => {
    const form = new FormData(); form.set("file", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png"));
    const result = await readPictureUpload(new Request("https://hub.example.test/api/v1/profile-pictures", { method: "POST", body: form }), Number.MAX_SAFE_INTEGER);
    expect(result.toJSON()).toEqual(err({ code: "accounts_picture_too_large" }).toJSON());
  });
});
