import type { GatewayRequestHandlers } from "./types.js";
import { backfillGatewayOwnership, listGatewayOwnershipGaps } from "../ownership-backfill.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateOwnershipBackfillParams,
  validateOwnershipGapsParams,
} from "../protocol/index.js";

export const ownershipHandlers: GatewayRequestHandlers = {
  "ownership.gaps": async ({ params, respond }) => {
    if (!validateOwnershipGapsParams(params ?? {})) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid ownership.gaps params: ${formatValidationErrors(validateOwnershipGapsParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const raw = params as {
        limit?: number;
        resources?: string[];
      };
      const result = await listGatewayOwnershipGaps({
        ...(typeof raw.limit === "number" ? { limit: raw.limit } : {}),
        ...(Array.isArray(raw.resources) ? { resources: raw.resources } : {}),
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
  "ownership.backfill": async ({ params, respond }) => {
    if (!validateOwnershipBackfillParams(params ?? {})) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid ownership.backfill params: ${formatValidationErrors(validateOwnershipBackfillParams.errors)}`,
        ),
      );
      return;
    }

    try {
      const raw = params as {
        ownerUserId: string;
        ownerPrincipalId?: string;
        dryRun?: boolean;
        resources?: string[];
      };
      const result = await backfillGatewayOwnership({
        ownerUserId: raw.ownerUserId,
        ownerPrincipalId: raw.ownerPrincipalId,
        dryRun: raw.dryRun === true,
        resources: raw.resources,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
