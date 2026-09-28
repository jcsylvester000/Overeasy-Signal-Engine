import { describe, expect, it } from "vitest";
import { sanitizeAnswers, uploadPolicy } from "../privacy";
import { legalScoring } from "../templates/others";
import { hashEmail, hashEmailMicrosoft, normalizeEmailMicrosoft } from "../hash";

describe("upload policy", () => {
  it("uploads with hashed data by default", () => {
    expect(uploadPolicy({ ad_user_data: "granted" }, {})).toMatchObject({ upload: true, hashedUserData: true });
  });
  it("GPC skips the upload by default", () => {
    expect(uploadPolicy({ gpc: true }, {}).upload).toBe(false);
  });
  it("GPC with click_id_only policy uploads without hashes and denies personalization", () => {
    expect(uploadPolicy({ gpc: true, ad_personalization: "granted" }, { optOutPolicy: "click_id_only" })).toMatchObject({ upload: true, hashedUserData: false, adPersonalization: "denied" });
  });
  it("regulated verticals never send hashed contact data", () => {
    expect(uploadPolicy({ ad_user_data: "granted" }, { regulatedVertical: true }).hashedUserData).toBe(false);
  });
  it("ad_user_data denied drops hashes", () => {
    expect(uploadPolicy({ ad_user_data: "denied" }, {}).hashedUserData).toBe(false);
  });
});

describe("answer sanitising", () => {
  it("keeps only model fields and masks sensitive ones", () => {
    const { kept, dropped } = sanitizeAnswers(legalScoring, { case_type: "personal_injury", injury_treated: "yes", ssn: "123", notes: "x" });
    expect(kept).toEqual({ case_type: "personal_injury", injury_treated: "[sensitive]" });
    expect(dropped.sort()).toEqual(["notes", "ssn"]);
  });
});

describe("per-destination email normalisation", () => {
  it("Microsoft strips +tags and dots in the local part; Google does not", () => {
    expect(normalizeEmailMicrosoft(" Jane.Doe+ads@Example.com ")).toBe("janedoe@example.com");
    expect(hashEmailMicrosoft("jane.doe+x@example.com")).toBe(hashEmailMicrosoft("janedoe@example.com"));
    expect(hashEmail("jane.doe@example.com")).not.toBe(hashEmail("janedoe@example.com"));
  });
});
