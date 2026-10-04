import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess =
  require("child_process") as typeof import("node:child_process");

interface ReleaseCredentials {
  isOfficialBuild(env?: NodeJS.ProcessEnv): boolean;
  validateCredentialPair(
    env: NodeJS.ProcessEnv,
    firstName: string,
    secondName: string,
    required?: boolean,
  ): boolean;
}

const { isOfficialBuild, validateCredentialPair } =
  require("../scripts/release-credentials.cjs") as ReleaseCredentials;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("release credential gates", () => {
  it("recognises GitHub tag builds as official", () => {
    expect(isOfficialBuild({ GITHUB_REF_TYPE: "tag" })).toBe(true);
    expect(isOfficialBuild({ GITHUB_REF_TYPE: "branch" })).toBe(false);
    expect(isOfficialBuild({})).toBe(false);
  });

  it("allows an unconfigured local build", () => {
    expect(validateCredentialPair({}, "KEY", "SECRET")).toBe(false);
  });

  it("rejects a partial credential pair", () => {
    expect(() =>
      validateCredentialPair({ KEY: "key" }, "KEY", "SECRET"),
    ).toThrow("KEY and SECRET must be set together");
    expect(() =>
      validateCredentialPair({ SECRET: "secret" }, "KEY", "SECRET"),
    ).toThrow("KEY and SECRET must be set together");
  });

  it("requires a complete pair for an official build", () => {
    expect(() => validateCredentialPair({}, "KEY", "SECRET", true)).toThrow(
      "KEY and SECRET are required for tag builds",
    );
    expect(
      validateCredentialPair(
        { KEY: "key", SECRET: "secret" },
        "KEY",
        "SECRET",
        true,
      ),
    ).toBe(true);
  });
});

describe("release build scripts", () => {
  it("fails Last.fm injection before writing an unconfigured tag build", () => {
    const result = childProcess.spawnSync(
      process.execPath,
      ["scripts/inject-lastfm-credentials.cjs"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REF_TYPE: "tag",
          CASSETTE_LASTFM_API_KEY: "",
          CASSETTE_LASTFM_API_SECRET: "",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "CASSETTE_LASTFM_API_KEY and CASSETTE_LASTFM_API_SECRET are required for tag builds",
    );
  });
});
