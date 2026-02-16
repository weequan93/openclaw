import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const NullableString = Type.Union([NonEmptyString, Type.Null()]);
const OwnershipBackfillResourceSchema = Type.String({
  enum: ["agents", "sessions", "nodes", "browserProfiles", "memory"],
});

export const AuthzDeniedListParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    cursor: Type.Optional(Type.String({ minLength: 1, pattern: "^[1-9][0-9]*$" })),
    order: Type.Optional(Type.Union([Type.Literal("desc"), Type.Literal("asc")])),
    method: Type.Optional(NonEmptyString),
    reasonCode: Type.Optional(NonEmptyString),
    errorCode: Type.Optional(NonEmptyString),
    userId: Type.Optional(NonEmptyString),
    principalId: Type.Optional(NonEmptyString),
    actorRole: Type.Optional(NonEmptyString),
    sourceRole: Type.Optional(NonEmptyString),
    clientId: Type.Optional(NonEmptyString),
    clientMode: Type.Optional(NonEmptyString),
    sourceIp: Type.Optional(NonEmptyString),
    sinceTs: Type.Optional(Type.Integer({ minimum: 0 })),
    untilTs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const AuthzDeniedSummaryParamsSchema = Type.Object(
  {
    topN: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    alertThreshold: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    method: Type.Optional(NonEmptyString),
    reasonCode: Type.Optional(NonEmptyString),
    errorCode: Type.Optional(NonEmptyString),
    userId: Type.Optional(NonEmptyString),
    principalId: Type.Optional(NonEmptyString),
    actorRole: Type.Optional(NonEmptyString),
    sourceRole: Type.Optional(NonEmptyString),
    clientId: Type.Optional(NonEmptyString),
    clientMode: Type.Optional(NonEmptyString),
    sourceIp: Type.Optional(NonEmptyString),
    sinceTs: Type.Optional(Type.Integer({ minimum: 0 })),
    untilTs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const AuthzAllowListParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    cursor: Type.Optional(Type.String({ minLength: 1, pattern: "^[1-9][0-9]*$" })),
    order: Type.Optional(Type.Union([Type.Literal("desc"), Type.Literal("asc")])),
    method: Type.Optional(NonEmptyString),
    userId: Type.Optional(NonEmptyString),
    principalId: Type.Optional(NonEmptyString),
    actorRole: Type.Optional(NonEmptyString),
    sourceRole: Type.Optional(NonEmptyString),
    clientId: Type.Optional(NonEmptyString),
    clientMode: Type.Optional(NonEmptyString),
    sourceIp: Type.Optional(NonEmptyString),
    sinceTs: Type.Optional(Type.Integer({ minimum: 0 })),
    untilTs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const AuthzAllowSummaryParamsSchema = Type.Object(
  {
    topN: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    alertThreshold: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    method: Type.Optional(NonEmptyString),
    userId: Type.Optional(NonEmptyString),
    principalId: Type.Optional(NonEmptyString),
    actorRole: Type.Optional(NonEmptyString),
    sourceRole: Type.Optional(NonEmptyString),
    clientId: Type.Optional(NonEmptyString),
    clientMode: Type.Optional(NonEmptyString),
    sourceIp: Type.Optional(NonEmptyString),
    sinceTs: Type.Optional(Type.Integer({ minimum: 0 })),
    untilTs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const OwnershipBackfillParamsSchema = Type.Object(
  {
    ownerUserId: NonEmptyString,
    ownerPrincipalId: Type.Optional(NonEmptyString),
    dryRun: Type.Optional(Type.Boolean()),
    resources: Type.Optional(
      Type.Array(OwnershipBackfillResourceSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
    ),
  },
  { additionalProperties: false },
);

export const OwnershipGapsParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    resources: Type.Optional(
      Type.Array(OwnershipBackfillResourceSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
    ),
  },
  { additionalProperties: false },
);

const OwnershipBackfillStatsSchema = Type.Object(
  {
    scanned: Type.Integer({ minimum: 0 }),
    updated: Type.Integer({ minimum: 0 }),
    skipped: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const OwnershipBackfillAgentsResultSchema = Type.Object(
  {
    ...OwnershipBackfillStatsSchema.properties,
    updatedAgentIds: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const OwnershipBackfillBrowserProfilesResultSchema = Type.Object(
  {
    ...OwnershipBackfillStatsSchema.properties,
    updatedProfiles: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const OwnershipBackfillSessionsResultSchema = Type.Object(
  {
    ...OwnershipBackfillStatsSchema.properties,
    storesScanned: Type.Integer({ minimum: 0 }),
    storesUpdated: Type.Integer({ minimum: 0 }),
    updatedStorePaths: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const OwnershipBackfillNodesResultSchema = Type.Object(
  {
    ...OwnershipBackfillStatsSchema.properties,
    updatedNodeIds: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const OwnershipBackfillMemoryResultSchema = Type.Object(
  {
    ...OwnershipBackfillStatsSchema.properties,
    updatedPaths: Type.Array(NonEmptyString),
    unresolvedPaths: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const OwnershipBackfillResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    dryRun: Type.Boolean(),
    ownerUserId: NonEmptyString,
    ownerPrincipalId: Type.Optional(NonEmptyString),
    resources: Type.Object(
      {
        agents: Type.Optional(OwnershipBackfillAgentsResultSchema),
        browserProfiles: Type.Optional(OwnershipBackfillBrowserProfilesResultSchema),
        sessions: Type.Optional(OwnershipBackfillSessionsResultSchema),
        nodes: Type.Optional(OwnershipBackfillNodesResultSchema),
        memory: Type.Optional(OwnershipBackfillMemoryResultSchema),
      },
      { additionalProperties: false },
    ),
    summary: Type.Object(
      {
        resources: Type.Array(OwnershipBackfillResourceSchema),
        scanned: Type.Integer({ minimum: 0 }),
        updated: Type.Integer({ minimum: 0 }),
        skipped: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const OwnershipGapStatsSchema = Type.Object(
  {
    scanned: Type.Integer({ minimum: 0 }),
    missing: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const OwnershipGapsAgentsResultSchema = Type.Object(
  {
    ...OwnershipGapStatsSchema.properties,
    missingAgentIds: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const OwnershipGapsBrowserProfilesResultSchema = Type.Object(
  {
    ...OwnershipGapStatsSchema.properties,
    missingProfiles: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const OwnershipGapsNodesResultSchema = Type.Object(
  {
    ...OwnershipGapStatsSchema.properties,
    missingNodeIds: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const OwnershipGapsSessionSampleSchema = Type.Object(
  {
    storePath: NonEmptyString,
    key: NonEmptyString,
  },
  { additionalProperties: false },
);

const OwnershipGapsSessionsResultSchema = Type.Object(
  {
    ...OwnershipGapStatsSchema.properties,
    storesScanned: Type.Integer({ minimum: 0 }),
    storesWithMissing: Type.Integer({ minimum: 0 }),
    missingSamples: Type.Array(OwnershipGapsSessionSampleSchema),
  },
  { additionalProperties: false },
);

const OwnershipGapsMemoryResultSchema = Type.Object(
  {
    ...OwnershipGapStatsSchema.properties,
    missingPaths: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const OwnershipGapsResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    resources: Type.Array(OwnershipBackfillResourceSchema),
    limit: Type.Integer({ minimum: 1, maximum: 500 }),
    resourcesSummary: Type.Object(
      {
        agents: Type.Optional(OwnershipGapsAgentsResultSchema),
        browserProfiles: Type.Optional(OwnershipGapsBrowserProfilesResultSchema),
        sessions: Type.Optional(OwnershipGapsSessionsResultSchema),
        nodes: Type.Optional(OwnershipGapsNodesResultSchema),
        memory: Type.Optional(OwnershipGapsMemoryResultSchema),
      },
      { additionalProperties: false },
    ),
    summary: Type.Object(
      {
        resources: Type.Array(OwnershipBackfillResourceSchema),
        scanned: Type.Integer({ minimum: 0 }),
        missing: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AuthzDeniedEventSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    requestId: NonEmptyString,
    method: NonEmptyString,
    reasonCode: NonEmptyString,
    errorCode: NonEmptyString,
    errorMessage: NonEmptyString,
    userId: NullableString,
    userAlias: Type.Optional(NullableString),
    principalId: NullableString,
    actorRole: NullableString,
    sourceRole: NullableString,
    clientId: Type.Optional(NullableString),
    clientMode: Type.Optional(NullableString),
    sourceIp: Type.Optional(NullableString),
  },
  { additionalProperties: false },
);

export const AuthzDeniedListResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    events: Type.Array(AuthzDeniedEventSchema),
    nextCursor: NullableString,
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

const AuthzDeniedSummaryBucketSchema = Type.Object(
  {
    key: NonEmptyString,
    count: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const OptionalTimestampSchema = Type.Optional(Type.Integer({ minimum: 0 }));

export const AuthzDeniedSummaryResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    total: Type.Integer({ minimum: 0 }),
    earliestTs: OptionalTimestampSchema,
    latestTs: OptionalTimestampSchema,
    window: Type.Object(
      {
        sinceTs: OptionalTimestampSchema,
        untilTs: OptionalTimestampSchema,
      },
      { additionalProperties: false },
    ),
    byReasonCode: Type.Array(AuthzDeniedSummaryBucketSchema),
    byMethod: Type.Array(AuthzDeniedSummaryBucketSchema),
    byActorRole: Type.Array(AuthzDeniedSummaryBucketSchema),
    bySourceRole: Type.Array(AuthzDeniedSummaryBucketSchema),
    byErrorCode: Type.Array(AuthzDeniedSummaryBucketSchema),
    byPrincipalId: Type.Array(AuthzDeniedSummaryBucketSchema),
    bySourceIp: Type.Optional(Type.Array(AuthzDeniedSummaryBucketSchema)),
    highFrequency: Type.Object(
      {
        threshold: Type.Integer({ minimum: 1, maximum: 500 }),
        principals: Type.Array(AuthzDeniedSummaryBucketSchema),
        sourceIps: Type.Optional(Type.Array(AuthzDeniedSummaryBucketSchema)),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AuthzAllowEventSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    requestId: NonEmptyString,
    method: NonEmptyString,
    userId: NullableString,
    userAlias: Type.Optional(NullableString),
    principalId: NullableString,
    actorRole: NullableString,
    sourceRole: NullableString,
    clientId: Type.Optional(NullableString),
    clientMode: Type.Optional(NullableString),
    sourceIp: Type.Optional(NullableString),
  },
  { additionalProperties: false },
);

export const AuthzAllowListResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    events: Type.Array(AuthzAllowEventSchema),
    nextCursor: NullableString,
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

const AuthzAllowSummaryBucketSchema = Type.Object(
  {
    key: NonEmptyString,
    count: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AuthzAllowSummaryResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    total: Type.Integer({ minimum: 0 }),
    earliestTs: OptionalTimestampSchema,
    latestTs: OptionalTimestampSchema,
    window: Type.Object(
      {
        sinceTs: OptionalTimestampSchema,
        untilTs: OptionalTimestampSchema,
      },
      { additionalProperties: false },
    ),
    byMethod: Type.Array(AuthzAllowSummaryBucketSchema),
    byActorRole: Type.Array(AuthzAllowSummaryBucketSchema),
    bySourceRole: Type.Array(AuthzAllowSummaryBucketSchema),
    byUserId: Type.Array(AuthzAllowSummaryBucketSchema),
    byPrincipalId: Type.Array(AuthzAllowSummaryBucketSchema),
    byClientId: Type.Array(AuthzAllowSummaryBucketSchema),
    byClientMode: Type.Array(AuthzAllowSummaryBucketSchema),
    bySourceIp: Type.Array(AuthzAllowSummaryBucketSchema),
    highFrequency: Type.Object(
      {
        threshold: Type.Integer({ minimum: 1, maximum: 500 }),
        principals: Type.Array(AuthzAllowSummaryBucketSchema),
        sourceIps: Type.Array(AuthzAllowSummaryBucketSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
