// Tiny synthetic fixtures: JPEG contains camera/GPS metadata; the square PNG has none.
// Generated once with sharp in development; tests and application code do not import it.
const jpeg = "/9j/4QEgRXhpZgAASUkqAAgAAAAIABIBAwABAAAAAQAAABoBBQABAAAAbgAAABsBBQABAAAAdgAAACgBAwABAAAAAgAAADsBAgAWAAAAfgAAABMCAwABAAAAAQAAAGmHBAABAAAAlAAAACWIBAABAAAA4gAAAAAAAAA4YwAA6AMAADhjAADoAwAAcHJpdmF0ZS1jYW1lcmEtbWFya2VyAAYAAJAHAAQAAAAwMjEwAZEHAAQAAAABAgMAAKAHAAQAAAAwMTAwAaADAAEAAAD//wAAAqAEAAEAAAADAAAAA6AEAAEAAAACAAAAAAAAAAIAAQACAAIAAABOAAAAAgAFAAMAAAAAAQAAAAAAAAEAAAABAAAAAgAAAAEAAAADAAAAAQAAAP/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAIAAwMBIgACEQEDEQH/xAAVAAEBAAAAAAAAAAAAAAAAAAAABP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAGB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIwAZSn/2Q==";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWO4FCUHQQxwFgBRpAe94uBlVQAAAABJRU5ErkJggg==";
const webp = "UklGRjwAAABXRUJQVlA4IDAAAADwAQCdASoDAAIAAUAmJaACdLoB+AAETAAA/t+AP/PzO7cX9Vv/sHf0rH0rH69AAAA=";
const square = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4FCV3KUqOAUIBACb2BSnPR/4vAAAAAElFTkSuQmCC";

export function pictureFile(format: "jpeg" | "png" | "webp"): File {
  const encoded = { jpeg, png, webp }[format];
  return new File([decode(encoded)], "portrait." + format, { type: "image/" + format });
}

export function squarePicture(): Blob { return new Blob([decode(square)], { type: "image/png" }); }

function decode(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}
