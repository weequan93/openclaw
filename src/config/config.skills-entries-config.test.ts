import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("skills entries config schema", () => {
  it("accepts custom fields under config", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        entries: {
          "custom-skill": {
            enabled: true,
            config: {
              url: "https://example.invalid",
              token: "abc123",
            },
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("accepts visibility and ownerUserId fields", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        entries: {
          "private-skill": {
            visibility: "user_private",
            ownerUserId: "11111111-1111-1111-1111-111111111111",
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("accepts group_shared visibility with groupIds", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        entries: {
          "ops-skill": {
            visibility: "group_shared",
            groupIds: ["ops", "finance"],
          },
        },
      },
      gateway: {
        multiUser: {
          identities: {
            "msg:discord:default:123": {
              userId: "11111111-1111-1111-1111-111111111111",
              alias: "Alice",
              groupIds: ["ops"],
            },
          },
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "11111111-1111-1111-1111-111111111111",
                toUserId: "22222222-2222-2222-2222-222222222222",
                resources: ["agents", "sessions"],
              },
            ],
          },
        },
      },
    });

    expect(res.success).toBe(true);
  });

  it("rejects empty ownerUserId", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        entries: {
          "private-skill": {
            visibility: "user_private",
            ownerUserId: "",
          },
        },
      },
    });

    expect(res.success).toBe(false);
  });

  it("rejects unknown top-level fields", () => {
    const res = OpenClawSchema.safeParse({
      skills: {
        entries: {
          "custom-skill": {
            url: "https://example.invalid",
          },
        },
      },
    });

    expect(res.success).toBe(false);
    if (res.success) {
      return;
    }

    expect(
      res.error.issues.some(
        (issue) =>
          issue.path.join(".") === "skills.entries.custom-skill" &&
          issue.message.toLowerCase().includes("unrecognized"),
      ),
    ).toBe(true);
  });
});
