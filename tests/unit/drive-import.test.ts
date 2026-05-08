import { describe, expect, it } from "vitest";
import { parseDriveShareUrl } from "@/lib/content-pipeline/drive-url";

describe("parseDriveShareUrl", () => {
  it("parses /file/d/<id>/view links", () => {
    expect(
      parseDriveShareUrl("https://drive.google.com/file/d/abc123/view")
    ).toEqual({ kind: "file", id: "abc123" });
  });

  it("parses /file/d/<id>/edit links", () => {
    expect(
      parseDriveShareUrl(
        "https://drive.google.com/file/d/XYZ789_-abc/edit?usp=sharing"
      )
    ).toEqual({ kind: "file", id: "XYZ789_-abc" });
  });

  it("parses /drive/folders/<id> links", () => {
    expect(
      parseDriveShareUrl(
        "https://drive.google.com/drive/folders/folder123abc?usp=drive_link"
      )
    ).toEqual({ kind: "folder", id: "folder123abc" });
  });

  it("parses /open?id=<id> links as files", () => {
    expect(
      parseDriveShareUrl("https://drive.google.com/open?id=oid_xyz")
    ).toEqual({ kind: "file", id: "oid_xyz" });
  });

  it("returns null for non-Drive URLs", () => {
    expect(parseDriveShareUrl("https://dropbox.com/s/abc")).toBeNull();
    expect(parseDriveShareUrl("https://example.com/file/d/abc/view")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(parseDriveShareUrl("not a url")).toBeNull();
  });

  it("returns null for Drive URL with no recognizable id", () => {
    expect(parseDriveShareUrl("https://drive.google.com/")).toBeNull();
  });
});
