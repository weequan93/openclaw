import { describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "./server-methods/types.js";
import {
  __test as authzAllowEventsTest,
  listGatewayAuthzAllowEvents,
} from "./authz-allow-events.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "./authz-denied-events.js";
import { auditGatewayAuthorization, authorizeGatewayMethod } from "./server-authz.js";

function makeClient(overrides?: Partial<GatewayClient["connect"]>): GatewayClient {
  return {
    connId: "conn-1",
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: {
        id: "test-client",
        version: "1.0.0",
        platform: "test",
        mode: "test",
      },
      role: "operator",
      scopes: [],
      ...overrides,
    },
  } as GatewayClient;
}

describe("authorizeGatewayMethod", () => {
  it("denies unknown senders when owner context cannot be resolved", () => {
    const decision = authorizeGatewayMethod({
      method: "health",
      client: null,
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("UNKNOWN_SENDER");
      expect(decision.error.message).toContain("unknown sender identity");
    }
  });

  it("denies missing read scope with explicit reason code", () => {
    const decision = authorizeGatewayMethod({
      method: "health",
      client: makeClient(),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.read");
      expect(
        (decision.error.details as { requiredScope?: string } | undefined)?.requiredScope,
      ).toBe("operator.read");
    }
  });

  it("denies pairing methods without operator.pairing scope", () => {
    const decision = authorizeGatewayMethod({
      method: "node.pair.list",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.pairing");
      expect(
        (decision.error.details as { requiredScope?: string } | undefined)?.requiredScope,
      ).toBe("operator.pairing");
    }
  });

  it("allows pairing methods with operator.pairing scope", () => {
    const methods = [
      "node.pair.request",
      "node.pair.list",
      "node.pair.approve",
      "node.pair.reject",
      "node.pair.verify",
      "device.pair.list",
      "device.pair.approve",
      "device.pair.reject",
      "device.token.rotate",
      "device.token.revoke",
      "node.rename",
    ] as const;
    for (const method of methods) {
      const decision = authorizeGatewayMethod({
        method,
        client: makeClient({
          scopes: ["operator.pairing"],
        }),
      });
      expect(decision.allow).toBe(true);
    }
  });

  it("denies approval methods without operator.approvals scope", () => {
    const decision = authorizeGatewayMethod({
      method: "exec.approval.resolve",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.approvals");
      expect(
        (decision.error.details as { requiredScope?: string } | undefined)?.requiredScope,
      ).toBe("operator.approvals");
    }
  });

  it("allows approval methods with operator.approvals scope", () => {
    const methods = ["exec.approval.request", "exec.approval.resolve"] as const;
    for (const method of methods) {
      const decision = authorizeGatewayMethod({
        method,
        client: makeClient({
          scopes: ["operator.approvals"],
        }),
      });
      expect(decision.allow).toBe(true);
    }
  });

  it("allows approval methods for non-admin principals when operator.approvals is granted", () => {
    const decision = authorizeGatewayMethod({
      method: "exec.approval.resolve",
      client: {
        ...makeClient({
          scopes: ["operator.admin", "operator.approvals"],
        }),
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.approvals"],
        },
      },
    });
    expect(decision.allow).toBe(true);
  });

  it("allows node-role methods for node senders", () => {
    const methods = ["node.invoke.result", "node.event", "skills.bins"] as const;
    for (const method of methods) {
      const decision = authorizeGatewayMethod({
        method,
        client: makeClient({
          role: "node",
        }),
      });
      expect(decision.allow).toBe(true);
    }
  });

  it("denies node-role methods for operator senders", () => {
    const decision = authorizeGatewayMethod({
      method: "node.invoke.result",
      client: makeClient({
        scopes: ["operator.admin"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(decision.error.message).toContain("unauthorized role: operator");
      expect((decision.error.details as { role?: string } | undefined)?.role).toBe("operator");
    }
  });

  it("allows pairing methods for non-admin principals when operator.pairing is granted", () => {
    const decision = authorizeGatewayMethod({
      method: "node.pair.approve",
      client: {
        ...makeClient({
          scopes: ["operator.admin", "operator.pairing"],
        }),
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.pairing"],
        },
      },
    });
    expect(decision.allow).toBe(true);
  });

  it("allows session mutation methods with operator.write scope", () => {
    const patchDecision = authorizeGatewayMethod({
      method: "sessions.patch",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(patchDecision.allow).toBe(true);

    const resetDecision = authorizeGatewayMethod({
      method: "sessions.reset",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(resetDecision.allow).toBe(true);

    const deleteDecision = authorizeGatewayMethod({
      method: "sessions.delete",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(deleteDecision.allow).toBe(true);

    const compactDecision = authorizeGatewayMethod({
      method: "sessions.compact",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(compactDecision.allow).toBe(true);
  });

  it("resolves admin owner role when admin scope is present", () => {
    const decision = authorizeGatewayMethod({
      method: "config.get",
      client: makeClient({
        scopes: ["operator.admin"],
      }),
    });
    expect(decision.allow).toBe(true);
    if (decision.allow) {
      expect(decision.owner.role).toBe("admin");
      expect(decision.owner.sourceRole).toBe("operator");
    }
  });

  it("denies admin methods when admin scope is requested by non-admin principals", () => {
    const decision = authorizeGatewayMethod({
      method: "config.get",
      client: {
        ...makeClient({
          scopes: ["operator.admin", "operator.write"],
        }),
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.write"],
        },
      },
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(decision.error.message).toContain("admin scope requires admin principal role");
    }
  });

  it("allows write methods when non-admin principals include operator.write alongside operator.admin", () => {
    const decision = authorizeGatewayMethod({
      method: "send",
      client: {
        ...makeClient({
          scopes: ["operator.admin", "operator.write"],
        }),
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.write"],
        },
      },
    });
    expect(decision.allow).toBe(true);
  });

  it("uses explicit connect identity mapping when provided", () => {
    const decision = authorizeGatewayMethod({
      method: "health",
      client: makeClient({
        scopes: ["operator.read"],
        identity: {
          userId: "8f165d06-2f6f-4b2e-9b15-315f6d0ca8e8",
          principalId: "msg:telegram:default:12345",
          alias: "alice",
        },
      }),
    });
    expect(decision.allow).toBe(true);
    if (decision.allow) {
      expect(decision.owner.userId).toBe("8f165d06-2f6f-4b2e-9b15-315f6d0ca8e8");
      expect(decision.owner.principalId).toBe("msg:telegram:default:12345");
      expect(decision.owner.alias).toBe("alice");
    }
  });

  it("keeps authz.denied.list admin-only", () => {
    const decision = authorizeGatewayMethod({
      method: "authz.denied.list",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps authz.allow.list admin-only", () => {
    const decision = authorizeGatewayMethod({
      method: "authz.allow.list",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps authz.allow.summary admin-only", () => {
    const decision = authorizeGatewayMethod({
      method: "authz.allow.summary",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps authz.denied.summary admin-only", () => {
    const decision = authorizeGatewayMethod({
      method: "authz.denied.summary",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps config.changes.list admin-only", () => {
    const decision = authorizeGatewayMethod({
      method: "config.changes.list",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps config policy bundle methods admin-only", () => {
    const listDecision = authorizeGatewayMethod({
      method: "config.policyBundles.list",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(listDecision.allow).toBe(false);
    if (!listDecision.allow) {
      expect(listDecision.reasonCode).toBe("SCOPE_MISSING");
      expect(listDecision.error.message).toContain("missing scope: operator.admin");
    }

    const resolveDecision = authorizeGatewayMethod({
      method: "config.policyBundle.resolve",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(resolveDecision.allow).toBe(false);
    if (!resolveDecision.allow) {
      expect(resolveDecision.reasonCode).toBe("SCOPE_MISSING");
      expect(resolveDecision.error.message).toContain("missing scope: operator.admin");
    }

    const applyDecision = authorizeGatewayMethod({
      method: "config.policyBundle.apply",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(applyDecision.allow).toBe(false);
    if (!applyDecision.allow) {
      expect(applyDecision.reasonCode).toBe("SCOPE_MISSING");
      expect(applyDecision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps ownership.gaps admin-only", () => {
    const decision = authorizeGatewayMethod({
      method: "ownership.gaps",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps logs.tail admin-only", () => {
    const decision = authorizeGatewayMethod({
      method: "logs.tail",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("SCOPE_MISSING");
      expect(decision.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("keeps status, presence telemetry, cron, skills, and agent control-plane methods admin-only", () => {
    const methods = [
      "status",
      "system-presence",
      "last-heartbeat",
      "cron.list",
      "cron.status",
      "cron.runs",
      "cron.add",
      "cron.update",
      "cron.remove",
      "cron.run",
      "skills.install",
      "skills.update",
      "agents.create",
      "agents.update",
      "agents.delete",
      "agents.files.list",
      "agents.files.get",
      "agents.files.set",
    ] as const;
    for (const method of methods) {
      const decision = authorizeGatewayMethod({
        method,
        client: makeClient({
          scopes: ["operator.write"],
        }),
      });
      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.reasonCode).toBe("SCOPE_MISSING");
        expect(decision.error.message).toContain("missing scope: operator.admin");
      }
    }
  });

  it("keeps TTS, voicewake, talk mode, wake, and system control methods admin-only", () => {
    const ttsEnable = authorizeGatewayMethod({
      method: "tts.enable",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(ttsEnable.allow).toBe(false);
    if (!ttsEnable.allow) {
      expect(ttsEnable.reasonCode).toBe("SCOPE_MISSING");
      expect(ttsEnable.error.message).toContain("missing scope: operator.admin");
    }

    const ttsSetProvider = authorizeGatewayMethod({
      method: "tts.setProvider",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(ttsSetProvider.allow).toBe(false);
    if (!ttsSetProvider.allow) {
      expect(ttsSetProvider.reasonCode).toBe("SCOPE_MISSING");
      expect(ttsSetProvider.error.message).toContain("missing scope: operator.admin");
    }

    const voicewakeSet = authorizeGatewayMethod({
      method: "voicewake.set",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(voicewakeSet.allow).toBe(false);
    if (!voicewakeSet.allow) {
      expect(voicewakeSet.reasonCode).toBe("SCOPE_MISSING");
      expect(voicewakeSet.error.message).toContain("missing scope: operator.admin");
    }

    const talkMode = authorizeGatewayMethod({
      method: "talk.mode",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(talkMode.allow).toBe(false);
    if (!talkMode.allow) {
      expect(talkMode.reasonCode).toBe("SCOPE_MISSING");
      expect(talkMode.error.message).toContain("missing scope: operator.admin");
    }

    const wake = authorizeGatewayMethod({
      method: "wake",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(wake.allow).toBe(false);
    if (!wake.allow) {
      expect(wake.reasonCode).toBe("SCOPE_MISSING");
      expect(wake.error.message).toContain("missing scope: operator.admin");
    }

    const setHeartbeats = authorizeGatewayMethod({
      method: "set-heartbeats",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(setHeartbeats.allow).toBe(false);
    if (!setHeartbeats.allow) {
      expect(setHeartbeats.reasonCode).toBe("SCOPE_MISSING");
      expect(setHeartbeats.error.message).toContain("missing scope: operator.admin");
    }

    const systemEvent = authorizeGatewayMethod({
      method: "system-event",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(systemEvent.allow).toBe(false);
    if (!systemEvent.allow) {
      expect(systemEvent.reasonCode).toBe("SCOPE_MISSING");
      expect(systemEvent.error.message).toContain("missing scope: operator.admin");
    }

    const channelsLogout = authorizeGatewayMethod({
      method: "channels.logout",
      client: makeClient({
        scopes: ["operator.write"],
      }),
    });
    expect(channelsLogout.allow).toBe(false);
    if (!channelsLogout.allow) {
      expect(channelsLogout.reasonCode).toBe("SCOPE_MISSING");
      expect(channelsLogout.error.message).toContain("missing scope: operator.admin");
    }
  });

  it("denies talk.mode when admin scope is requested by non-admin principals", () => {
    const decision = authorizeGatewayMethod({
      method: "talk.mode",
      client: {
        ...makeClient({
          scopes: ["operator.admin", "operator.write"],
        }),
        owner: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.admin", "operator.write"],
        },
      },
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reasonCode).toBe("ROLE_FORBIDDEN");
      expect(decision.error.message).toContain("admin scope requires admin principal role");
    }
  });

  it("denies system control methods when admin scope is requested by non-admin principals", () => {
    const methods = ["set-heartbeats", "system-event", "channels.logout"] as const;
    for (const method of methods) {
      const decision = authorizeGatewayMethod({
        method,
        client: {
          ...makeClient({
            scopes: ["operator.admin", "operator.write"],
          }),
          owner: {
            userId: "user-a",
            principalId: "msg:discord:default:user-a",
            role: "user",
            sourceRole: "operator",
            scopes: ["operator.admin", "operator.write"],
          },
        },
      });
      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.reasonCode).toBe("ROLE_FORBIDDEN");
        expect(decision.error.message).toContain("admin scope requires admin principal role");
      }
    }
  });

  it("denies cron, skills, and agent mutation methods when admin scope is requested by non-admin principals", () => {
    const methods = [
      "cron.add",
      "cron.update",
      "cron.remove",
      "cron.run",
      "skills.install",
      "skills.update",
      "agents.create",
      "agents.update",
      "agents.delete",
      "agents.files.list",
      "agents.files.get",
      "agents.files.set",
    ] as const;
    for (const method of methods) {
      const decision = authorizeGatewayMethod({
        method,
        client: {
          ...makeClient({
            scopes: ["operator.admin", "operator.write"],
          }),
          owner: {
            userId: "user-a",
            principalId: "msg:discord:default:user-a",
            role: "user",
            sourceRole: "operator",
            scopes: ["operator.admin", "operator.write"],
          },
        },
      });
      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.reasonCode).toBe("ROLE_FORBIDDEN");
        expect(decision.error.message).toContain("admin scope requires admin principal role");
      }
    }
  });
});

describe("auditGatewayAuthorization", () => {
  it("records allow decisions", () => {
    authzAllowEventsTest.clear();
    const warn = vi.fn();
    const debug = vi.fn();
    const decision = authorizeGatewayMethod({
      method: "health",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    auditGatewayAuthorization({
      logger: { warn, debug },
      method: "health",
      requestId: "allow-req-1",
      decision,
      client: {
        ...makeClient({
          scopes: ["operator.read"],
          client: {
            id: "test-client",
            version: "1.0.0",
            platform: "test",
            mode: "test",
          },
        }),
        clientIp: "203.0.113.8",
      },
    });
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    const event = listGatewayAuthzAllowEvents({ limit: 1 })[0];
    expect(event?.requestId).toBe("allow-req-1");
    expect(event?.method).toBe("health");
    expect(event?.clientId).toBe("test-client");
    expect(event?.clientMode).toBe("test");
    expect(event?.sourceIp).toBe("203.0.113.8");
  });

  it("falls back to remoteAddr for allow audit source IP", () => {
    authzAllowEventsTest.clear();
    const warn = vi.fn();
    const debug = vi.fn();
    const decision = authorizeGatewayMethod({
      method: "health",
      client: makeClient({
        scopes: ["operator.read"],
      }),
    });
    auditGatewayAuthorization({
      logger: { warn, debug },
      method: "health",
      requestId: "allow-req-remote-fallback",
      decision,
      client: {
        ...makeClient({
          scopes: ["operator.read"],
          client: {
            id: "test-client",
            version: "1.0.0",
            platform: "test",
            mode: "test",
          },
        }),
        remoteAddr: "127.0.0.1",
      },
    });
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    const event = listGatewayAuthzAllowEvents({ limit: 1 })[0];
    expect(event?.requestId).toBe("allow-req-remote-fallback");
    expect(event?.sourceIp).toBe("127.0.0.1");
  });

  it("logs deny decisions with reason code", () => {
    authzDeniedEventsTest.clear();
    const warn = vi.fn();
    const debug = vi.fn();
    const decision = authorizeGatewayMethod({
      method: "health",
      client: makeClient(),
    });
    auditGatewayAuthorization({
      logger: { warn, debug },
      method: "health",
      requestId: "req-1",
      decision,
      client: {
        ...makeClient({
          client: {
            id: "test-client",
            version: "1.0.0",
            platform: "test",
            mode: "test",
          },
        }),
        clientIp: "203.0.113.7",
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(debug).not.toHaveBeenCalled();
    const event = listGatewayAuthzDenyEvents({ limit: 1 })[0];
    expect(event?.requestId).toBe("req-1");
    expect(event?.clientId).toBe("test-client");
    expect(event?.clientMode).toBe("test");
    expect(event?.sourceIp).toBe("203.0.113.7");
  });

  it("falls back to remoteAddr for deny audit source IP", () => {
    authzDeniedEventsTest.clear();
    const warn = vi.fn();
    const debug = vi.fn();
    const decision = authorizeGatewayMethod({
      method: "health",
      client: makeClient(),
    });
    auditGatewayAuthorization({
      logger: { warn, debug },
      method: "health",
      requestId: "deny-req-remote-fallback",
      decision,
      client: {
        ...makeClient({
          client: {
            id: "test-client",
            version: "1.0.0",
            platform: "test",
            mode: "test",
          },
        }),
        remoteAddr: "127.0.0.1",
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(debug).not.toHaveBeenCalled();
    const event = listGatewayAuthzDenyEvents({ limit: 1 })[0];
    expect(event?.requestId).toBe("deny-req-remote-fallback");
    expect(event?.sourceIp).toBe("127.0.0.1");
  });
});
