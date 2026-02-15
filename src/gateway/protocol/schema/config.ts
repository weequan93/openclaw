import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const ConfigGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const ConfigSetParamsSchema = Type.Object(
  {
    raw: NonEmptyString,
    baseHash: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ConfigApplyParamsSchema = Type.Object(
  {
    raw: NonEmptyString,
    baseHash: Type.Optional(NonEmptyString),
    sessionKey: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
    restartDelayMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ConfigPatchParamsSchema = Type.Object(
  {
    raw: NonEmptyString,
    baseHash: Type.Optional(NonEmptyString),
    sessionKey: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
    restartDelayMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ConfigSchemaParamsSchema = Type.Object({}, { additionalProperties: false });

export const ConfigPolicyBundlesListParamsSchema = Type.Object({}, { additionalProperties: false });

export const ConfigPolicyBundleResolveParamsSchema = Type.Object(
  {
    bundleId: Type.Union([
      Type.Literal("single_user"),
      Type.Literal("multi_user_isolated"),
      Type.Literal("strict_admin_control"),
    ]),
  },
  { additionalProperties: false },
);

export const ConfigPolicyBundleApplyParamsSchema = Type.Object(
  {
    bundleId: Type.Union([
      Type.Literal("single_user"),
      Type.Literal("multi_user_isolated"),
      Type.Literal("strict_admin_control"),
    ]),
    baseHash: Type.Optional(NonEmptyString),
    sessionKey: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
    restartDelayMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const NullableString = Type.Union([NonEmptyString, Type.Null()]);

export const ConfigChangesListParamsSchema = Type.Object(
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

export const UpdateRunParamsSchema = Type.Object(
  {
    sessionKey: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
    restartDelayMs: Type.Optional(Type.Integer({ minimum: 0 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const ConfigUiHintSchema = Type.Object(
  {
    label: Type.Optional(Type.String()),
    help: Type.Optional(Type.String()),
    group: Type.Optional(Type.String()),
    order: Type.Optional(Type.Integer()),
    advanced: Type.Optional(Type.Boolean()),
    sensitive: Type.Optional(Type.Boolean()),
    placeholder: Type.Optional(Type.String()),
    itemTemplate: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const ConfigSchemaResponseSchema = Type.Object(
  {
    schema: Type.Unknown(),
    uiHints: Type.Record(Type.String(), ConfigUiHintSchema),
    version: NonEmptyString,
    generatedAt: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ConfigChangeEventSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    requestId: NonEmptyString,
    method: NonEmptyString,
    path: NonEmptyString,
    userId: NullableString,
    userAlias: Type.Optional(NullableString),
    principalId: NullableString,
    actorRole: NullableString,
    sourceRole: NullableString,
    clientId: Type.Optional(NullableString),
    clientMode: Type.Optional(NullableString),
    sourceIp: Type.Optional(NullableString),
    sessionKey: Type.Optional(NullableString),
    note: Type.Optional(NullableString),
    restartDelayMs: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  },
  { additionalProperties: false },
);

export const ConfigChangesListResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    events: Type.Array(ConfigChangeEventSchema),
    nextCursor: NullableString,
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ConfigPolicyBundleSchema = Type.Object(
  {
    id: Type.Union([
      Type.Literal("single_user"),
      Type.Literal("multi_user_isolated"),
      Type.Literal("strict_admin_control"),
    ]),
    title: NonEmptyString,
    description: NonEmptyString,
    patch: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const ConfigPolicyBundlesListResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    bundles: Type.Array(ConfigPolicyBundleSchema),
  },
  { additionalProperties: false },
);

export const ConfigPolicyBundleResolveResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    bundle: ConfigPolicyBundleSchema,
  },
  { additionalProperties: false },
);
