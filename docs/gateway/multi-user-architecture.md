---
summary: "Target architecture and ownership boundaries for one OpenClaw instance with multiple users"
read_when:
  - Designing user isolation in one OpenClaw gateway instance
  - Implementing ownership checks for sessions memory nodes agents and skills
title: "Multi user architecture"
---

# Multi user architecture

This document defines the target architecture for one OpenClaw gateway instance serving multiple users with strict isolation.

Related docs:

- [Multi user roadmap](/gateway/multi-tenant)
- [Multi user deployment checklist](/gateway/multi-user-deployment)

## Core principles

1. One canonical owner identity per request (`userId`, `principalId`, `role`).
2. Session and memory data are owner partitioned by default.
3. Runtime events fan out only to owner authorized clients unless admin visibility is explicitly allowed.
4. Control plane mutation is admin only.
5. Audit trails record both allow and deny decisions.

## Technical diagram component view

```mermaid
graph TB
  subgraph Clients["User and admin entry points"]
    C1["Channel clients (Telegram, Discord, Slack, Web)"]
    C2["Admin panel"]
    C3["Node agents"]
  end

  subgraph Gateway["OpenClaw gateway single instance"]
    G1["Auth and identity mapper"]
    G2["Authorization and owner policy"]
    G3["Session router and event fanout"]
    G4["Agent and tool runtime"]
    G5["Control plane API (admin only)"]
  end

  subgraph Data["State and storage"]
    D1["Session store (owner partition)"]
    D2["Memory store (owner partition)"]
    D3["Node pairing metadata (ownerUserId)"]
    D4["Skill registry (shared, group_shared, user_private)"]
    D5["Audit logs (allow, deny, config change)"]
  end

  C1 --> G1
  C2 --> G1
  C3 --> G1

  G1 --> G2
  G2 --> G3
  G3 --> G4
  G5 --> G2

  G3 --> D1
  G4 --> D2
  G2 --> D3
  G4 --> D4
  G2 --> D5
  G5 --> D5
```

## Technical diagram request flow

```mermaid
sequenceDiagram
  actor User as User
  participant Channel as Channel client
  participant Gateway as Gateway
  participant Identity as Identity mapper
  participant Policy as Authz and owner policy
  participant Router as Session router
  participant Runtime as Agent runtime
  participant Store as Owner partition store
  participant Audit as Admin audit feed

  User->>Channel: Send request
  Channel->>Gateway: connect + RPC or HTTP call
  Gateway->>Identity: Resolve principal mapping
  Identity-->>Gateway: userId, principalId, role, scopes, alias
  Gateway->>Policy: Authorize method and owner access

  alt Denied
    Policy-->>Gateway: Deny with reason code
    Gateway->>Audit: Record authz.denied
    Gateway-->>Channel: Error response
  else Allowed
    Policy-->>Gateway: Allow
    Gateway->>Router: Resolve owner scoped session key
    Router->>Store: Read and write owner partition
    Router->>Runtime: Run agent or tool
    Runtime-->>Gateway: Result and runtime events
    Gateway->>Audit: Record authz.allow
    Gateway-->>Channel: Response and owner scoped events
  end
```

## Ownership matrix

| Resource                 | Ownership field                              | Default visibility  | Admin override             |
| ------------------------ | -------------------------------------------- | ------------------- | -------------------------- |
| Sessions                 | `ownerUserId`                                | Owner only          | Yes, explicit owner filter |
| Memory entries           | `ownerUserId` partition                      | Owner only          | Yes                        |
| Nodes                    | Pairing metadata `ownerUserId`               | Owner only          | Yes                        |
| Agents                   | `ownerUserId`                                | Owner only          | Yes                        |
| Skills                   | `shared` or `group_shared` or `user_private` | Based on visibility | Yes                        |
| Config and control plane | Admin principal role                         | Hidden from users   | Not required               |
